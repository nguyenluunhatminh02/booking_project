import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Kafka, logLevel, Consumer, EachMessagePayload } from 'kafkajs';
import { PrismaService } from '../../prisma/prisma.service';
import { SagaCoordinator, EventEnvelope } from './saga.coordinator';

const TOPICS = (
  process.env.EVENT_TOPICS ||
  [
    'dev.booking.held',
    'dev.booking.review_pending',
    'dev.booking.review_approved',
    'dev.booking.review_declined',
    'dev.booking.cancelled',
    'dev.booking.expired',
    'dev.booking.refunded',
    // payment topics để chạy full saga:
    'dev.payment.succeeded',
    'dev.booking.paid',
  ].join(',')
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

@Injectable()
export class EventsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsConsumerService.name);
  private kafka?: Kafka;
  private consumer?: Consumer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly coordinator: SagaCoordinator,
  ) {}

  async onModuleInit() {
    if (process.env.RUN_KAFKA_CONSUMER !== '1') {
      this.logger.log('RUN_KAFKA_CONSUMER != 1 → skip consumer');
      return;
    }

    const brokers = (process.env.KAFKA_BROKERS || 'localhost:9094')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    this.kafka = new Kafka({
      brokers,
      clientId: process.env.KAFKA_CONSUMER_CLIENT_ID || 'booking-app',
      logLevel: logLevel.NOTHING,
    });

    this.consumer = this.kafka.consumer({
      groupId: process.env.KAFKA_CONSUMER_GROUP || 'booking-app-consumer',
    });

    await this.consumer.connect();
    for (const t of TOPICS) {
      await this.consumer.subscribe({ topic: t, fromBeginning: false });
    }

    await this.consumer.run({
      autoCommit: true,
      eachMessage: (p) => this.handleMessage(p),
    });

    this.logger.log(`Consumer connected. Topics: ${TOPICS.join(', ')}`);
  }

  async onModuleDestroy() {
    await this.consumer?.disconnect().catch(() => {});
  }

  private async handleMessage({
    topic,
    partition,
    message,
  }: EachMessagePayload) {
    try {
      // Idempotent theo (topic, partition, offset)
      const processedId = `${topic}:${partition}:${message.offset}`;
      const existed = await this.prisma.processedEvent.findUnique({
        where: { id: processedId },
      });
      if (existed) return;

      const key = message.key?.toString() ?? null;
      const textPayload = message.value?.toString('utf8') || '{}';
      const payload = JSON.parse(textPayload || '{}');

      const envelope: EventEnvelope = { topic, key, payload };
      await this.coordinator
        .handle(envelope)
        .catch((e) =>
          this.logger.error(`coordinator error: ${e?.message || e}`),
        );

      await this.prisma.processedEvent.create({ data: { id: processedId } });
    } catch (err) {
      this.logger.error(`consume error: ${err?.message || err}`);
    }
  }
}
