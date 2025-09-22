import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Kafka, logLevel, Consumer, EachMessagePayload } from 'kafkajs';
import { PrismaService } from '../../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
// (tuỳ bạn muốn gắn thêm)
import { PromotionService } from '../promotion/promotion.service';
import { InvoiceService } from '../invoice/invoice.service';

type EventEnvelope = {
  id: string;
  topic: string; // có thể đã bao gồm prefix
  createdAt: string;
  payload: any; // business payload
  v: number;
};

const RAW_TOPICS =
  process.env.EVENT_TOPICS ??
  [
    'booking.held',
    'booking.review_pending',
    'booking.review_approved',
    'booking.review_declined',
    'booking.cancelled',
    'booking.expired',
    'booking.refunded',
    // nếu có, thêm: 'booking.paid','booking.confirmed'
  ].join(',');

const TOPICS = RAW_TOPICS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const TOPIC_PREFIX = process.env.KAFKA_TOPIC_PREFIX ?? ''; // ví dụ 'dev.'

@Injectable()
export class EventsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsConsumerService.name);
  private kafka?: Kafka;
  private consumer?: Consumer;
  private enabled = process.env.RUN_KAFKA_CONSUMER === '1';

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    // có thể inject để chạy hậu quả nghiệp vụ
    private readonly promo: PromotionService,
    private readonly invoice: InvoiceService,
  ) {}

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.log('RUN_KAFKA_CONSUMER != 1 → skip consumer');
      return;
    }

    const brokers = (process.env.KAFKA_BROKERS || 'localhost:9094')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    this.kafka = new Kafka({
      brokers,
      clientId: process.env.KAFKA_CLIENT_ID || 'booking-app',
      logLevel: logLevel.NOTHING,
    });

    this.consumer = this.kafka.consumer({
      groupId: process.env.KAFKA_GROUP_ID || 'booking-app-consumer',
    });

    await this.consumer.connect();

    // subscribe theo prefix
    for (const t of TOPICS) {
      const full = `${TOPIC_PREFIX}${t}`;
      await this.consumer.subscribe({ topic: full, fromBeginning: false });
    }

    await this.consumer.run({
      // at-least-once: để mặc định autoCommit (commit theo interval/threshold)
      eachMessage: async (payload) => this.handleMessage(payload),
    });

    this.logger.log(
      `Consumer connected. Topics: ${TOPICS.map((t) => TOPIC_PREFIX + t).join(', ')}`,
    );
  }

  async onModuleDestroy() {
    await this.consumer?.disconnect().catch(() => {});
  }

  private getHeaderString(h: unknown): string | undefined {
    if (!h) return undefined;
    if (Buffer.isBuffer(h)) return h.toString('utf8');
    if (Array.isArray(h) && Buffer.isBuffer(h[0])) return h[0].toString('utf8');
    if (typeof h === 'string') return h;
    return undefined;
  }

  private async handleMessage({ topic, message }: EachMessagePayload) {
    try {
      const text = message.value?.toString('utf8') || '{}';
      const evt = JSON.parse(text) as EventEnvelope;

      // Lấy eventId ưu tiên từ header, fallback evt.id
      const eventId =
        this.getHeaderString(message.headers?.['x-event-id']) || evt.id;

      if (!eventId) {
        this.logger.warn(`skip message without eventId on topic=${topic}`);
        return;
      }

      // Idempotent: bỏ nếu đã xử lý
      const existed = await this.prisma.processedEvent.findUnique({
        where: { id: eventId },
      });
      if (existed) return;

      // Bỏ prefix để router ngắn
      const shortTopic = (evt.topic || topic).replace(TOPIC_PREFIX, '');

      await this.dispatch(shortTopic, evt);

      // Đánh dấu đã xử lý
      await this.prisma.processedEvent.create({
        data: { id: eventId }, // có thể thêm topic/processedAt nếu schema cho phép
      });
    } catch (err: any) {
      this.logger.error(`consume error on ${topic}: ${err?.message || err}`);
      // có thể emit DLQ tại đây
    }
  }

  // Router gọn — dễ test
  private async dispatch(shortTopic: string, evt: EventEnvelope) {
    const data = evt.payload || {};

    switch (shortTopic) {
      case 'booking.held': {
        // demo notify
        const to = process.env.DEMO_NOTIFY_TO || '';
        if (to) {
          await this.mailer
            .send({
              to,
              subject: `Booking held: ${data.bookingId}`,
              html: `<p>Booking <b>${data.bookingId}</b> was held. Proceed to payment.</p>`,
              category: 'booking_notifications',
            })
            .catch(() => {});
        }
        this.logger.log(`📦 booking.held bookingId=${data.bookingId}`);
        break;
      }

      case 'booking.expired': {
        this.logger.warn(`⏰ booking.expired bookingId=${data.bookingId}`);
        // Promotion release khi expire (nếu muốn chạy tại consumer)
        await this.promo
          .releaseOnCancelOrExpire(data.bookingId, false, 'EXPIRED')
          .catch(() => {});
        break;
      }

      case 'booking.cancelled': {
        await this.promo
          .releaseOnCancelOrExpire(data.bookingId, false, 'CANCELLED')
          .catch(() => {});
        break;
      }

      case 'booking.refunded': {
        await this.promo
          .releaseOnCancelOrExpire(data.bookingId, false, 'REFUNDED')
          .catch(() => {});
        break;
      }

      // (tuỳ bạn có phát những event này không)
      case 'booking.paid':
      case 'booking.confirmed': {
        await this.promo.confirmOnPaid(data.bookingId).catch(() => {});
        await this.invoice.emailInvoice(data.bookingId).catch(() => {});
        break;
      }

      default:
        // no-op
        break;
    }
  }
}
