import { Injectable, Logger } from '@nestjs/common';
import { PromotionService } from '../promotion/promotion.service';
import { InvoiceService } from '../invoice/invoice.service';

export type EventEnvelope = {
  topic: string;
  key?: string | null;
  payload: any; // JSON từ outbox.publisher
};

@Injectable()
export class SagaCoordinator {
  private readonly logger = new Logger(SagaCoordinator.name);

  constructor(
    private readonly promo: PromotionService,
    private readonly invoice: InvoiceService,
  ) {}

  /**
   * Điều phối các bước cross-module dựa trên event.
   * Ghi chú: các service nghiệp vụ đã idempotent/CAS, nên gọi lặp lại vẫn an toàn.
   */
  async handle(ev: EventEnvelope) {
    const t = ev.topic;

    // --- PAYMENT -> APPLY PROMO -> EMAIL INVOICE ---
    if (t.endsWith('payment.succeeded') || t.endsWith('booking.paid')) {
      const bookingId = ev.payload?.bookingId as string | undefined;
      if (!bookingId) return;

      // 1) Xác nhận promotion (nếu có)
      await this.promo.confirmOnPaid(bookingId).catch((e) => {
        this.logger.error(
          `confirmOnPaid(${bookingId}) fail: ${e?.message || e}`,
        );
      });

      // 2) Gửi invoice qua email
      await this.invoice.emailInvoice(bookingId).catch((e) => {
        this.logger.error(
          `emailInvoice(${bookingId}) fail: ${e?.message || e}`,
        );
      });
      return;
    }

    // --- BOOKING huỷ/hết hạn/hoàn tiền -> RELEASE PROMO ---
    if (t.endsWith('booking.cancelled')) {
      const bookingId = ev.payload?.bookingId as string | undefined;
      if (bookingId) {
        await this.promo
          .releaseOnCancelOrExpire(bookingId, false, 'CANCELLED')
          .catch(() => {});
      }
      return;
    }

    if (t.endsWith('booking.expired')) {
      const bookingId = ev.payload?.bookingId as string | undefined;
      if (bookingId) {
        await this.promo
          .releaseOnCancelOrExpire(bookingId, false, 'EXPIRED')
          .catch(() => {});
      }
      return;
    }

    if (t.endsWith('booking.refunded')) {
      const bookingId = ev.payload?.bookingId as string | undefined;
      if (bookingId) {
        await this.promo
          .releaseOnCancelOrExpire(bookingId, true, 'REFUNDED')
          .catch(() => {});
      }
      return;
    }

    // Tuỳ chọn: log/metrics cho các sự kiện khác
    if (
      t.endsWith('booking.held') ||
      t.endsWith('promotion.reserved') ||
      t.endsWith('booking.review_approved') ||
      t.endsWith('booking.review_declined')
    ) {
      this.logger.debug(`Event ${t}: ${JSON.stringify(ev.payload)}`);
      return;
    }
  }
}
