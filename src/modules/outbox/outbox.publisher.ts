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
import { RedisService } from '../../common/redis.service';
import { topicName } from '../kafka/topicName';
import { AppConfigService } from '../../config/app-config.service';

@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisher.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  private readonly autostart: boolean;
  private readonly pollSec: number;
  private readonly batch: number;
  private readonly topicPrefix: string;
  private readonly lockTtlSec: number;
  private static readonly LOCK_KEY = 'job:outbox:publish';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(OUTBOX_PRODUCER) private readonly producer: KafkaProducerLike,
    private readonly config: AppConfigService,
  ) {
    const outboxCfg = this.config.outbox;
    this.autostart = outboxCfg.autostart;
    this.pollSec = outboxCfg.pollIntervalSec;
    this.batch = outboxCfg.batchSize;
    this.topicPrefix = this.config.kafka.topicPrefix;
    this.lockTtlSec = Math.max(1, outboxCfg.lockTtlSec);
  }

  async onModuleInit() {
    await this.producer.connect();

    if (this.autostart) {
      this.logger.log(
        `OutboxPublisher autostart: every ${this.pollSec}s (batch=${this.batch})`,
      );
      this.timer = setInterval(() => {
        this.tick().catch(() => {});
      }, this.pollSec * 1000);
      (this.timer as any).unref?.();
    } else {
      this.logger.log(`OutboxPublisher ready (autostart=OFF)`);
    }
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.producer?.disconnect?.();
  }

  async tick() {
    const got = await this.redis.set(OutboxPublisher.LOCK_KEY, '1', {
      ttlSec: this.lockTtlSec,
      nx: true,
    });
    if (!got) return;

    // optional: renew TTL
    const renew = setInterval(
      () => {
        try {
          (this.redis as any).expire?.(
            OutboxPublisher.LOCK_KEY,
            this.lockTtlSec,
          );
        } catch {
          /* empty */
        }
      },
      Math.max(1000, (this.lockTtlSec * 1000) / 2),
    );
    (renew as any).unref?.();

    if (this.running) {
      clearInterval(renew);
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

      const groups = new Map<string, typeof rows>();
      for (const r of rows) {
        const finalTopic = topicName(this.topicPrefix, r.topic);
        if (!groups.has(finalTopic)) groups.set(finalTopic, []);
        groups.get(finalTopic)!.push(r);
      }

      for (const [topic, msgs] of groups) {
        const messages = msgs.map((m) => ({
          key: m.eventKey ?? undefined,
          value: JSON.stringify({
            id: m.id,
            topic,
            createdAt: m.createdAt.toISOString(),
            payload: m.payload,
            v: 1,
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

      await this.prisma.outbox.deleteMany({
        where: { id: { in: rows.map((r) => r.id) } },
      });
    } catch (e: any) {
      this.logger.error(`tick error: ${e?.message || e}`);
    } finally {
      this.running = false;
      clearInterval(renew);
      await this.redis.del(OutboxPublisher.LOCK_KEY);
    }
  }
}
