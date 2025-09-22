// outbox.publisher.ts
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OUTBOX_PRODUCER } from './outbox.tokens';
import type { KafkaProducerLike } from './types';
import { RedisService } from 'src/common/redis.service';

@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisher.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  private readonly autostart = (process.env.OUTBOX_AUTOSTART || '0') === '1';
  private readonly pollSec = Number(process.env.OUTBOX_POLL_SEC || 5);
  private readonly batch = Number(process.env.OUTBOX_BATCH || 200);
  private readonly topicPrefix = process.env.KAFKA_TOPIC_PREFIX || '';
  private static readonly LOCK_KEY = 'job:outbox:publish';
  private static readonly LOCK_TTL_SEC = Math.max(
    1,
    Number(process.env.OUTBOX_LOCK_TTL_SEC || 10),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(OUTBOX_PRODUCER) private readonly producer: KafkaProducerLike,
  ) {}

  async onModuleInit() {
    await this.producer.connect();

    if (this.autostart) {
      this.logger.log(
        `Autostart polling every ${this.pollSec}s (batch=${this.batch})`,
      );
      this.timer = setInterval(() => {
        this.tick().catch(() => {});
      }, this.pollSec * 1000);
      // để Jest/process có thể thoát gọn
      (this.timer as any).unref?.();
    } else {
      this.logger.log(`OutboxPublisher ready (autostart=OFF)`);
    }
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.producer?.disconnect?.();
  }

  /** 1 vòng publish (có thể gọi thủ công từ controller) */
  async tick() {
    // Khoá phân tán để nhiều pod không cùng chạy
    const got = await this.redis.set(OutboxPublisher.LOCK_KEY, '1', {
      ttlSec: OutboxPublisher.LOCK_TTL_SEC,
      nx: true,
    });
    if (!got) return;

    if (this.running) {
      await this.redis.del(OutboxPublisher.LOCK_KEY);
      return;
    }
    this.running = true;

    try {
      const rows = await this.prisma.outbox.findMany({
        orderBy: { createdAt: 'asc' },
        take: this.batch,
      });
      if (!rows.length) return;

      // group theo topic
      const groups = new Map<string, typeof rows>();
      for (const r of rows) {
        const t = `${this.topicPrefix}${r.topic}`;
        if (!groups.has(t)) groups.set(t, []);
        groups.get(t)!.push(r);
      }

      // publish từng nhóm
      for (const [topic, msgs] of groups) {
        const messages = msgs.map((m) => ({
          key: m.eventKey ?? undefined,
          value: JSON.stringify({
            id: m.id,
            topic: topic,
            createdAt: m.createdAt.toISOString(),
            payload: m.payload,
            v: 1, // schema version
          }),
          headers: {
            'x-event-id': m.id,
            'x-topic': topic,
            'x-created-at': m.createdAt.toISOString(),
            'x-schema-ver': '1',
          },
        }));
        await this.producer.send(topic, messages);
      }

      // xoá sau khi publish (at-least-once; consumer phải idempotent theo x-event-id)
      await this.prisma.outbox.deleteMany({
        where: { id: { in: rows.map((r) => r.id) } },
      });
    } catch (e: any) {
      this.logger.error(`tick error: ${e?.message || e}`);
    } finally {
      this.running = false;
      await this.redis.del(OutboxPublisher.LOCK_KEY);
    }
  }
}
