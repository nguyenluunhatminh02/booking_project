import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, NotiChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxProducer } from '../outbox/outbox.producer';
import { getTemplate } from './templates.registry';

type Tx = Prisma.TransactionClient;

export type SendOptions = {
  channels?: Array<'INAPP' | 'EMAIL' | 'PUSH'>;
  dedupeKey?: string;
  deliverAt?: Date;
  sendNow?: boolean; // nếu true và deliverAt không tương lai -> emit outbox ngay
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxProducer,
  ) {}

  private render(key: string, ctx: any) {
    const t = getTemplate(key);
    return {
      email: t?.renderEmail?.(ctx) ?? undefined,
      inapp: t?.renderInapp?.(ctx) ?? { title: key, body: undefined },
      push: t?.renderPush?.(ctx) ?? undefined,
    };
  }

  private async getPrefsMap(userId: string, key: string) {
    const p = await this.prisma.notiPreference.findUnique({
      where: { userId_key: { userId, key } },
    });
    return {
      inapp: p?.inapp ?? true,
      email: p?.email ?? true,
      push: p?.push ?? true,
    };
  }

  private async emitForChannel(
    tx: Tx,
    notiId: string,
    channel: NotiChannel,
    payload: any,
  ) {
    const topic =
      channel === 'EMAIL'
        ? 'email.send'
        : channel === 'PUSH'
          ? 'push.send'
          : channel === 'WEBHOOK'
            ? 'webhook.dispatch'
            : 'notification.created'; // INAPP
    await this.outbox.emitInTx(tx, topic, notiId, payload);
  }

  /**
   * Gửi/schedule 1 notification theo template key.
   * - Dedupe theo (channel,userId,dedupeKey) nếu cung cấp dedupeKey
   * - Nếu deliverAt ở tương lai: chỉ tạo bản ghi PENDING, scheduler sẽ emit sau
   * - Nếu sendNow và deliverAt<=now: emit outbox ngay (EMAIL/PUSH), INAPP tạo record luôn
   */
  async send(userId: string, key: string, ctx: any, opts: SendOptions = {}) {
    const want = new Set(
      opts.channels?.length ? opts.channels : ['INAPP', 'EMAIL'],
    );
    const prefs = await this.getPrefsMap(userId, key);
    const r = this.render(key, ctx);

    const deliverAfter = opts.deliverAt ? new Date(opts.deliverAt) : null;
    const sendNow =
      !!opts.sendNow && (!deliverAfter || deliverAfter <= new Date());

    return await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!user) throw new NotFoundException('User not found');

      const results: any[] = [];
      const plan: Array<{ ch: NotiChannel; content: any }> = [];
      if (want.has('INAPP') && prefs.inapp)
        plan.push({ ch: 'INAPP', content: r.inapp });
      if (want.has('EMAIL') && prefs.email && r.email && user.email)
        plan.push({ ch: 'EMAIL', content: { ...r.email, to: user.email } });
      if (want.has('PUSH') && prefs.push && r.push)
        plan.push({ ch: 'PUSH', content: r.push });

      for (const it of plan) {
        // Dedupe nếu có dedupeKey
        if (opts.dedupeKey) {
          const dup = await tx.notification
            .findUnique({
              where: {
                channel_userId_dedupeKey: {
                  channel: it.ch,
                  userId,
                  dedupeKey: opts.dedupeKey,
                },
              },
            })
            .catch(() => null);
          if (dup) {
            results.push(dup);
            continue;
          }
        }

        const rec = await tx.notification.create({
          data: {
            userId,
            key,
            channel: it.ch,
            title: it.content?.title ?? it.content?.subject ?? null,
            body:
              it.content?.body ?? it.content?.text ?? it.content?.html ?? null,
            data: it.content ? it.content : undefined,
            dedupeKey: opts.dedupeKey ?? null,
            status: 'PENDING',
            deliverAfter: deliverAfter,
            sentAt: null,
          },
        });

        const dueNow = sendNow && it.ch !== 'INAPP';
        const isInapp = it.ch === 'INAPP';

        if (isInapp) {
          await tx.notification.update({
            where: { id: rec.id },
            data: { status: 'SENT', sentAt: new Date() },
          });
          results.push({ ...rec, status: 'SENT' });
        } else if (dueNow) {
          await this.emitForChannel(tx, rec.id, it.ch, {
            notiId: rec.id,
            userId,
            key,
            channel: it.ch,
            content: it.content,
          });
          await tx.notification.update({
            where: { id: rec.id },
            data: { status: 'SENT', sentAt: new Date() },
          });
          results.push({ ...rec, status: 'SENT' });
        } else {
          results.push(rec); // scheduler sẽ bắn
        }
      }

      return results;
    });
  }

  /** Scheduler gọi (an toàn cho multi-instance) */
  async dispatchDueSafely(limit = 200) {
    const now = new Date();
    const rows = await this.prisma.notification.findMany({
      where: {
        status: 'PENDING',
        sentAt: null,
        channel: { in: ['EMAIL', 'PUSH'] as any },
        OR: [{ deliverAfter: null }, { deliverAfter: { lte: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    if (!rows.length) return { dispatched: 0 };

    let sent = 0;
    for (const n of rows) {
      // claim "mềm": nếu record vẫn PENDING và chưa claim / claim quá hạn
      const claim = await this.prisma.notification.updateMany({
        where: {
          id: n.id,
          status: 'PENDING',
          OR: [
            { processingAt: null },
            { processingAt: { lte: new Date(Date.now() - 60_000) } }, // 60s timeout
          ],
        },
        data: { processingAt: new Date() },
      });
      if (claim.count === 0) continue; // đã có worker khác claim

      try {
        await this.prisma.$transaction(async (tx) => {
          await this.emitForChannel(tx, n.id, n.channel, {
            notiId: n.id,
            userId: n.userId,
            key: n.key,
            channel: n.channel,
            content: n.data as any,
          });
          await tx.notification.update({
            where: { id: n.id },
            data: {
              status: 'SENT',
              sentAt: new Date(),
              processingAt: null,
              lastError: null,
            },
          });
        });
        sent++;
      } catch (e: any) {
        await this.prisma.notification.update({
          where: { id: n.id },
          data: {
            attempts: { increment: 1 },
            lastError: String(e?.message || e),
            processingAt: null,
            // backoff: schedule lại sau 2 phút
            deliverAfter: new Date(Date.now() + 120_000),
          },
        });
      }
    }
    return { dispatched: sent };
  }

  // ===== In-app APIs =====
  async list(
    userId: string,
    q: { limit?: number; cursor?: string; unreadOnly?: boolean },
  ) {
    const limit = Math.min(Math.max(q.limit ?? 20, 1), 100);
    const where: Prisma.NotificationWhereInput = {
      userId,
      channel: 'INAPP',
      ...(q.unreadOnly ? { readAt: null } : {}),
    };

    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: { id: 'desc' },
      cursor: q.cursor ? { id: q.cursor } : undefined,
      skip: q.cursor ? 1 : 0,
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].id : null;
    return { data, nextCursor, hasMore };
  }

  async unreadCount(userId: string) {
    const n = await this.prisma.notification.count({
      where: { userId, channel: 'INAPP', readAt: null },
    });
    return { unread: n };
  }

  async markRead(userId: string, id: string) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n || n.userId !== userId || n.channel !== 'INAPP')
      throw new NotFoundException('Notification not found');
    if (n.readAt) return { ok: true };
    await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date(), status: 'READ' },
    });
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, channel: 'INAPP', readAt: null },
      data: { readAt: new Date(), status: 'READ' },
    });
    return { ok: true };
  }

  // ===== Preferences =====
  async listPrefs(userId: string) {
    return this.prisma.notiPreference.findMany({
      where: { userId },
      orderBy: { key: 'asc' },
    });
  }

  async upsertPref(
    userId: string,
    input: { key: string; email?: boolean; push?: boolean; inapp?: boolean },
  ) {
    if (!input.key) throw new BadRequestException('key required');
    return this.prisma.notiPreference.upsert({
      where: { userId_key: { userId, key: input.key } },
      update: {
        email: input.email ?? undefined,
        push: input.push ?? undefined,
        inapp: input.inapp ?? undefined,
      },
      create: {
        userId,
        key: input.key,
        email: input.email ?? true,
        push: input.push ?? true,
        inapp: input.inapp ?? true,
      },
    });
  }

  // ===== Manage pending/failed =====
  async cancelPending(userId: string, id: string) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n || n.userId !== userId)
      throw new NotFoundException('Notification not found');
    if (n.status !== 'PENDING') return { ok: false, reason: 'not_pending' };
    await this.prisma.notification.update({
      where: { id },
      data: { status: 'CANCELLED', processingAt: null },
    });
    return { ok: true };
  }

  async retryFailed(userId: string, id: string) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n || n.userId !== userId)
      throw new NotFoundException('Notification not found');
    if (n.status !== 'FAILED' && n.status !== 'CANCELLED')
      return { ok: false, reason: 'not_failed' };
    await this.prisma.notification.update({
      where: { id },
      data: { status: 'PENDING', deliverAfter: new Date(), processingAt: null },
    });
    return { ok: true };
  }
}
