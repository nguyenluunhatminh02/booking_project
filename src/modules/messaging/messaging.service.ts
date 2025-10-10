import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, MediaType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MuteDto } from './dto/mute.dto';
import { OutboxProducer } from '../outbox/outbox.producer';

type Tx = Prisma.TransactionClient;

function sort2(a: string, b: string) {
  return a < b ? [a, b] : [b, a];
}

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxProducer,
  ) {}

  // ---------- Helpers ----------
  private async participantOrThrow(
    tx: Tx | PrismaService,
    conversationId: string,
    userId: string,
  ) {
    const p = await tx.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: {
        id: true,
        mutedUntil: true,
        archivedAt: true,
        pinnedAt: true,
        lastReadAt: true,
      },
    });
    if (!p) throw new ForbiddenException('Not a participant');
    return p;
  }

  private async assertNotBlocked(
    tx: Tx,
    conversationId: string,
    userId: string,
  ) {
    const others = await tx.conversationParticipant.findMany({
      where: { conversationId, NOT: { userId } },
      select: { userId: true },
    });
    const otherIds = others.map((o) => o.userId);
    if (!otherIds.length) return;

    const block = await tx.userBlock.findFirst({
      where: {
        OR: [
          { userId, blockedUserId: { in: otherIds } }, // mình chặn họ
          { userId: { in: otherIds }, blockedUserId: userId }, // họ chặn mình
        ],
      },
      select: { id: true },
    });
    if (block) throw new ForbiddenException('Messaging is blocked');
  }

  private snapshotForUser(u: { id: string; email: string }) {
    // Thêm displayName/avatar nếu schema có
    return { id: u.id, email: u.email };
  }

  private inferMediaType(
    contentType?: string,
    fallback: 'IMAGE' | 'VIDEO' = 'IMAGE',
  ): 'IMAGE' | 'VIDEO' {
    if (!contentType) return fallback;
    if (contentType.startsWith('video/')) return 'VIDEO';
    if (contentType.startsWith('image/')) return 'IMAGE';
    return fallback;
  }

  // ---------- Conversation creation ----------
  async startDirect(userId: string, targetUserId: string) {
    if (userId === targetUserId)
      throw new BadRequestException('Cannot chat with yourself');
    const [u1, u2] = sort2(userId, targetUserId);
    const key = `DIRECT:${u1}:${u2}`;

    return this.prisma.$transaction(async (tx) => {
      let conv = await tx.conversation.findUnique({ where: { key } });
      if (!conv) {
        conv = await tx.conversation.create({
          data: { type: 'DIRECT', key },
        });

        const users = await tx.user.findMany({
          where: { id: { in: [u1, u2] } },
          select: { id: true, email: true },
        });
        const map = new Map(users.map((v) => [v.id, v]));

        await tx.conversationParticipant.createMany({
          data: [
            {
              conversationId: conv.id,
              userId: u1,
              profileSnapshot: this.snapshotForUser(map.get(u1)!) as any,
            },
            {
              conversationId: conv.id,
              userId: u2,
              profileSnapshot: this.snapshotForUser(map.get(u2)!) as any,
            },
          ],
        });
      } else {
        // đảm bảo user hiện tại là participant
        const exists = await tx.conversationParticipant.findUnique({
          where: { conversationId_userId: { conversationId: conv.id, userId } },
        });
        if (!exists) {
          const u = await tx.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true },
          });
          if (!u) throw new NotFoundException('User not found');
          await tx.conversationParticipant.create({
            data: {
              conversationId: conv.id,
              userId,
              profileSnapshot: this.snapshotForUser(u) as any,
            },
          });
        }
      }
      return conv;
    });
  }

  async startProperty(userId: string, propertyId: string) {
    return this.prisma.$transaction(async (tx) => {
      const prop = await tx.property.findUnique({
        where: { id: propertyId },
        select: { id: true, hostId: true, title: true },
      });
      if (!prop) throw new NotFoundException('Property not found');
      if (prop.hostId === userId)
        throw new BadRequestException(
          'Host cannot start chat as guest for own property',
        );

      const key = `PROPERTY:${prop.id}:${userId}`;
      let conv = await tx.conversation.findUnique({ where: { key } });
      if (!conv) {
        conv = await tx.conversation.create({
          data: { type: 'PROPERTY', key, propertyId },
        });

        const users = await tx.user.findMany({
          where: { id: { in: [userId, prop.hostId] } },
          select: { id: true, email: true },
        });
        const map = new Map(users.map((v) => [v.id, v]));
        await tx.conversationParticipant.createMany({
          data: [
            {
              conversationId: conv.id,
              userId: userId,
              role: 'GUEST',
              profileSnapshot: this.snapshotForUser(map.get(userId)!) as any,
            },
            {
              conversationId: conv.id,
              userId: prop.hostId,
              role: 'HOST',
              profileSnapshot: this.snapshotForUser(
                map.get(prop.hostId)!,
              ) as any,
            },
          ],
        });

        // (tuỳ chọn) Outbox "conversation.created"
        try {
          await this.outbox.emitInTx(
            tx,
            (process.env.KAFKA_TOPIC_PREFIX || '') + 'conversation.created',
            conv.id,
            { conversationId: conv.id, propertyId: prop.id, type: 'PROPERTY' },
          );
        } catch {
          /* empty */
        }
      }
      return conv;
    });
  }

  // ---------- List & detail ----------
  async listConversations(userId: string, limit = 20, cursor?: string | null) {
    const rows = await this.prisma.conversationParticipant.findMany({
      where: { userId },
      include: {
        conversation: {
          include: {
            property: { select: { id: true, title: true, address: true } },
          },
        },
      },
      orderBy: [{ pinnedAt: 'desc' }, { conversation: { updatedAt: 'desc' } }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const convIds = rows.map((r) => r.conversationId);

    // last message per conversation (nhẹ nhàng)
    const lastMsgs = convIds.length
      ? await this.prisma.message.findMany({
          where: { conversationId: { in: convIds } },
          orderBy: { createdAt: 'desc' },
          take: convIds.length * 3,
          select: {
            id: true,
            conversationId: true,
            body: true,
            createdAt: true,
            deletedAt: true,
          },
        })
      : [];
    const lastPerConv = new Map<
      string,
      {
        id: string;
        body: string | null;
        createdAt: Date;
        deletedAt: Date | null;
      }
    >();
    for (const m of lastMsgs) {
      if (!lastPerConv.has(m.conversationId))
        lastPerConv.set(m.conversationId, m as any);
    }

    // unread: 1 query tổng hợp (dùng tên bảng thật theo @@map)
    const unreadCounts = new Map<string, number>();
    if (convIds.length) {
      const convIdsSql = Prisma.sql`ARRAY[${Prisma.join(convIds)}]`;
      const rowsUnread = await this.prisma.$queryRaw<
        { conversationId: string; cnt: bigint }[]
      >(Prisma.sql`
        SELECT m."conversationId", COUNT(*)::bigint AS cnt
          FROM "messages" m
          JOIN "conversation_participants" p
            ON p."conversationId" = m."conversationId"
           AND p."userId" = ${userId}
         WHERE m."conversationId" = ANY(${convIdsSql})
           AND m."deletedAt" IS NULL
           AND m."senderId" <> ${userId}
           AND (p."lastReadAt" IS NULL OR m."createdAt" > p."lastReadAt")
         GROUP BY m."conversationId"
      `);
      for (const r of rowsUnread)
        unreadCounts.set(r.conversationId, Number(r.cnt));
    }

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return {
      data: data.map((r) => ({
        conversationId: r.conversationId,
        type: r.conversation.type,
        property: r.conversation.property
          ? {
              id: r.conversation.property.id,
              title: r.conversation.property.title,
              address: r.conversation.property.address,
            }
          : null,
        pinnedAt: r.pinnedAt,
        archivedAt: r.archivedAt,
        mutedUntil: r.mutedUntil,
        lastReadAt: r.lastReadAt,
        lastMessage: lastPerConv.get(r.conversationId) || null,
        unread: unreadCounts.get(r.conversationId) || 0,
      })),
      hasMore,
      nextCursor,
    };
  }

  async getConversation(userId: string, conversationId: string) {
    const part = await this.participantOrThrow(
      this.prisma,
      conversationId,
      userId,
    );
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        property: { select: { id: true, title: true, address: true } },
        participants: {
          include: { user: { select: { id: true, email: true } } },
        },
      },
    });
    if (!conv) throw new NotFoundException('Conversation not found');

    return {
      ...conv,
      you: {
        mutedUntil: part.mutedUntil,
        archivedAt: part.archivedAt,
        pinnedAt: part.pinnedAt,
        lastReadAt: part.lastReadAt,
      },
      participants: conv.participants.map((p) => ({
        userId: p.userId,
        role: p.role,
        snapshot: p.profileSnapshot,
      })),
    };
  }

  // ---------- Messages ----------
  async listMessages(
    userId: string,
    conversationId: string,
    limit = 30,
    beforeId?: string,
  ) {
    await this.participantOrThrow(this.prisma, conversationId, userId);

    const where: Prisma.MessageWhereInput = { conversationId, deletedAt: null };
    const cursor = beforeId ? { id: beforeId } : undefined;

    const rows = await this.prisma.message.findMany({
      where,
      include: {
        attachments: true,
        sender: { select: { id: true, email: true } },
      },
      orderBy: { id: 'desc' },
      ...(cursor ? { cursor, skip: 1 } : {}),
      take: limit,
    });

    return { data: rows.reverse(), hasMore: rows.length === limit };
  }

  async sendMessage(
    userId: string,
    conversationId: string,
    dto: SendMessageDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.participantOrThrow(tx, conversationId, userId);
      await this.assertNotBlocked(tx, conversationId, userId);

      const hasText = !!(dto.body && dto.body.trim());
      const hasAttachments = !!(dto.attachments && dto.attachments.length > 0);
      if (!hasText && !hasAttachments) {
        throw new BadRequestException('Message must have body or attachments');
      }

      const msg = await tx.message.create({
        data: {
          conversationId,
          senderId: userId,
          body: hasText ? dto.body!.trim() : null,
        },
      });

      if (hasAttachments) {
        const fileIds = Array.from(
          new Set(dto.attachments!.map((a) => a.fileId)),
        );
        const files = await tx.file.findMany({
          where: { id: { in: fileIds } },
          select: {
            id: true,
            url: true,
            bytes: true,
            width: true,
            height: true,
            contentType: true,
            createdById: true,
            malwareStatus: true,
          },
        });
        const map = new Map(files.map((f) => [f.id, f]));

        for (const att of dto.attachments!) {
          const f = map.get(att.fileId);
          if (!f) throw new NotFoundException(`File not found: ${att.fileId}`);

          // ownership
          if (f.createdById && f.createdById !== userId) {
            throw new ForbiddenException(
              'You cannot attach a file you do not own',
            );
          }
          // antivirus gating
          if (f.malwareStatus && f.malwareStatus !== ('CLEAN' as any)) {
            throw new BadRequestException('Attachment failed malware scan');
          }

          const mediaType: MediaType = (att.type ||
            this.inferMediaType(f.contentType ?? undefined)) as MediaType;
          await tx.messageAttachment.create({
            data: {
              messageId: msg.id,
              fileId: f.id,
              mediaType,
              url: f.url,
              bytes: f.bytes ?? null,
              width: f.width ?? null,
              height: f.height ?? null,
              contentType: f.contentType ?? null,
            },
          });
        }
      }

      // bump updatedAt cho Conversation (dùng tên bảng theo @@map)
      await tx.$executeRawUnsafe(
        `UPDATE "conversations" SET "updatedAt" = NOW() WHERE "id" = $1`,
        conversationId,
      );

      // Outbox event: message.created
      try {
        await this.outbox.emitInTx(
          tx,
          (process.env.KAFKA_TOPIC_PREFIX || '') + 'message.created',
          msg.id,
          { messageId: msg.id, conversationId, senderId: userId },
        );
      } catch {
        /* empty */
      }

      return tx.message.findUnique({
        where: { id: msg.id },
        include: { attachments: true },
      });
    });
  }

  async markRead(userId: string, conversationId: string) {
    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: new Date() },
    });
    return { ok: true };
  }

  async deleteMessageSoft(userId: string, messageId: string) {
    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!msg) throw new NotFoundException('Message not found');
    if (msg.senderId !== userId)
      throw new ForbiddenException('Only sender can delete message');
    await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  // ---------- Pin / Archive / Mute ----------
  async pin(userId: string, conversationId: string) {
    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { pinnedAt: new Date() },
    });
    return { ok: true };
  }
  async unpin(userId: string, conversationId: string) {
    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { pinnedAt: null },
    });
    return { ok: true };
  }

  async archive(userId: string, conversationId: string) {
    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { archivedAt: new Date() },
    });
    return { ok: true };
  }
  async unarchive(userId: string, conversationId: string) {
    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { archivedAt: null },
    });
    return { ok: true };
  }

  async mute(userId: string, conversationId: string, dto: MuteDto) {
    const until =
      (dto.minutes ?? 0) > 0
        ? new Date(Date.now() + dto.minutes! * 60_000)
        : null;
    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { mutedUntil: until },
    });
    return { ok: true, mutedUntil: until };
  }

  // ---------- Block / Unblock ----------
  async block(userId: string, targetUserId: string) {
    if (userId === targetUserId)
      throw new BadRequestException('Cannot block yourself');
    await this.prisma.user.findUniqueOrThrow({
      where: { id: targetUserId },
      select: { id: true },
    });
    await this.prisma.userBlock.upsert({
      where: { userId_blockedUserId: { userId, blockedUserId: targetUserId } },
      create: { userId, blockedUserId: targetUserId },
      update: {},
    });
    return { ok: true };
  }
  async unblock(userId: string, targetUserId: string) {
    await this.prisma.userBlock.deleteMany({
      where: { userId, blockedUserId: targetUserId },
    });
    return { ok: true };
  }
  async listBlocked(userId: string) {
    return this.prisma.userBlock.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { blockee: { select: { id: true, email: true } } },
    });
  }

  // ---------- Typing indicator (emit event) ----------
  async typing(userId: string, conversationId: string, isTyping: boolean) {
    await this.participantOrThrow(this.prisma, conversationId, userId);
    // phát outbox để WS/worker gửi realtime
    try {
      await this.outbox.emitInTx(
        this.prisma, // emit ngoài tx cũng OK vì chỉ ghi outbox
        (process.env.KAFKA_TOPIC_PREFIX || '') + 'inbox.typing',
        `${conversationId}:${userId}`,
        { conversationId, userId, isTyping, at: new Date().toISOString() },
      );
    } catch {
      /* empty */
    }
    return { ok: true };
  }

  // ---------- Search inbox ----------
  async search(userId: string, q: string, limit = 20) {
    const parts = await this.prisma.conversationParticipant.findMany({
      where: { userId },
      select: { conversationId: true },
    });
    const convIds = parts.map((p) => p.conversationId);
    if (!convIds.length) return { data: [] };

    const rows = await this.prisma.message.findMany({
      where: {
        conversationId: { in: convIds },
        deletedAt: null,
        body: { contains: q, mode: 'insensitive' },
      },
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        body: true,
        createdAt: true,
        conversation: { select: { type: true, propertyId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, limit)),
    });

    return { data: rows };
  }
}
