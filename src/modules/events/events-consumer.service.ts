import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Kafka, logLevel, Consumer, EachMessagePayload } from 'kafkajs';
import { PrismaService } from '../../prisma/prisma.service';
import { SagaCoordinator } from '../saga/saga.coordinator';
import { topicName } from '../kafka/topicName';

const RAW_TOPICS =
  process.env.EVENT_TOPICS ??
  [
    'file.uploaded',
    'file.variant_created',
    'inventory.events',
    'booking.events',
    'booking.policy_attached',
    'booking.auto_declined',
    'booking.review_pending',
    'booking.review_approved',
    'booking.review_declined',
    'booking.held',
    'booking.expired',
    'booking.cancelled',
    'booking.refunded',
    'booking.paid',
    'booking.confirmed',
    'payment.intent_created',
    'payment.succeeded',
    'payment.failed',
    'payment.refunded',
    'payment.refund_failed',
    'payment.refund_requested',
    'promotion.reserved',
    'promotion.applied',
    'promotion.released',
    'review.created',
    'review.updated',
    'review.deleted',
    'invoice.emailed',
  ].join(',');

const TOPICS_RAW = RAW_TOPICS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const TOPIC_PREFIX = process.env.KAFKA_TOPIC_PREFIX ?? '';

@Injectable()
export class EventsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsConsumerService.name);
  private kafka?: Kafka;
  private consumer?: Consumer;
  private enabled = process.env.RUN_KAFKA_CONSUMER === '1';

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly coordinator?: SagaCoordinator,
  ) {}

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.log('RUN_KAFKA_CONSUMER != 1 → skip consumer');
      return;
    }

    // Delay để đảm bảo Kafka sẵn sàng
    this.logger.log('Waiting for Kafka to be ready...');
    await new Promise((resolve) => setTimeout(resolve, 10000)); // 10 giây

    const brokers = (process.env.KAFKA_BROKERS || 'localhost:9094')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    this.kafka = new Kafka({
      brokers,
      clientId: process.env.KAFKA_CONSUMER_CLIENT_ID || 'booking-app',
      logLevel: logLevel.INFO,
      // Thêm retry configuration
      retry: {
        initialRetryTime: 100,
        retries: 8,
      },
      connectionTimeout: 10000,
      requestTimeout: 30000,
    });

    // Retry mechanism cho việc khởi tạo consumer
    let retries = 3;
    while (retries > 0) {
      try {
        await this.initializeConsumer();
        break;
      } catch (error) {
        retries--;
        this.logger.error(
          `Consumer initialization failed, retries left: ${retries}`,
          error,
        );
        if (retries === 0) throw error;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  private async initializeConsumer() {
    // ⚠️ Chuẩn hoá tên topic + loại trùng + chống double-prefix
    const topicsFinal = Array.from(
      new Set(TOPICS_RAW.map((t) => topicName(TOPIC_PREFIX, t))),
    );

    console.log('TopicsFinal: ', topicsFinal);

    this.logger.log(`Topics to subscribe: ${topicsFinal.join(', ')}`);
    if (!this.kafka) {
      throw new Error('Kafka instance is not initialized');
    }
    // (khuyến nghị) Preflight: verify topic tồn tại để báo rõ tên nào sai
    const admin = this.kafka.admin();
    try {
      await admin.connect();
      const meta = await admin.fetchTopicMetadata({ topics: topicsFinal });
      const known = new Set(meta.topics.map((t) => t.name));
      const missing = topicsFinal.filter((t) => !known.has(t));
      await admin.disconnect();

      if (missing.length) {
        this.logger.error(`Missing topics: ${missing.join(', ')}`);
        throw new Error(`Kafka topics missing: ${missing.join(', ')}`);
      }

      this.logger.log(`All topics verified: ${topicsFinal.join(', ')}`);
    } catch (error) {
      await admin.disconnect();
      throw error;
    }

    this.consumer = this.kafka.consumer({
      groupId: process.env.KAFKA_CONSUMER_GROUP || 'booking-app-consumer',
      // Thêm consumer configuration
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxWaitTimeInMs: 100,
      retry: {
        initialRetryTime: 100,
        retries: 8,
      },
    });

    this.logger.log(
      `Connecting consumer with group: ${process.env.KAFKA_CONSUMER_GROUP || 'booking-app-consumer'}`,
    );
    await this.consumer.connect();
    this.logger.log('Consumer connected successfully');

    // Subscribe theo danh sách đã chuẩn hoá
    for (const t of topicsFinal) {
      await this.consumer.subscribe({ topic: t, fromBeginning: false });
      this.logger.log(`Subscribed to topic: ${t}`);
    }

    await this.consumer.run({
      autoCommit: true,
      eachMessage: (p) => this.handleMessage(p),
    });

    this.logger.log(
      `Consumer started and running with group: ${process.env.KAFKA_CONSUMER_GROUP || 'booking-app-consumer'}`,
    );
  }

  async onModuleDestroy() {
    if (this.consumer) {
      try {
        await this.consumer.disconnect();
        this.logger.log('Consumer disconnected');
      } catch (error) {
        this.logger.error('Error disconnecting consumer:', error);
      }
    }
  }

  private getHeaderString(h: unknown): string | undefined {
    if (!h) return undefined;
    if (Buffer.isBuffer(h)) return h.toString('utf8');
    if (Array.isArray(h) && Buffer.isBuffer(h[0])) return h[0].toString('utf8');
    if (typeof h === 'string') return h;
    return undefined;
  }

  private async handleMessage({
    topic,
    partition,
    message,
  }: EachMessagePayload) {
    try {
      const text = message.value?.toString('utf8') || '{}';
      const evt = JSON.parse(text) as {
        id?: string;
        topic?: string;
        payload: any;
        v?: number;
      };

      const headerId = this.getHeaderString(message.headers?.['x-event-id']);
      const processedId = headerId || `${topic}:${partition}:${message.offset}`;

      const existed = await this.prisma.processedEvent.findUnique({
        where: { id: processedId },
      });
      if (existed) return;

      const shortTopic = (evt.topic || topic).replace(TOPIC_PREFIX, '');

      if (this.coordinator) {
        await this.coordinator
          .handle({
            topic: shortTopic,
            payload: evt.payload,
            key: message.key?.toString() ?? null,
          })
          .catch((e) =>
            this.logger.error(`coordinator error: ${e?.message || e}`),
          );
      } else {
        this.logger.log(`event ${shortTopic} received (id=${processedId})`);
      }

      await this.prisma.processedEvent.create({ data: { id: processedId } });
    } catch (err: any) {
      this.logger.error(`consume error on ${topic}: ${err?.message || err}`);
    }
  }
}
