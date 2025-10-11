import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxProducer } from '../outbox/outbox.producer';
import { PromotionService } from '../promotion/promotion.service';
import { InvoiceService } from '../invoice/invoice.service';
import { ThumbnailService } from '../file/thumbnail.service';
import { AntivirusService } from '../file/antivirus.service';

export type EventEnvelope = {
  topic: string;
  payload: any;
  key?: string | null;
};

@Injectable()
export class SagaCoordinator {
  private readonly logger = new Logger(SagaCoordinator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxProducer,
    private readonly thumbs: ThumbnailService,
    private readonly av: AntivirusService,
    @Optional() private readonly promo?: PromotionService,
    @Optional() private readonly invoice?: InvoiceService,
  ) {}

  async handle(evt: EventEnvelope) {
    switch (evt.topic) {
      // ===== FILE PIPELINE =====
      case 'dev.file.uploaded':
        return this.onFileUploaded(evt.payload);
      case 'dev.file.scanned':
        return this.onFileScanned(evt.payload);
      case 'dev.file.variant_created':
        return; // optional

      // ===== BOOKING LIFECYCLE =====
      case 'booking.auto_declined':
        return this.onBookingAutoDeclined(evt.payload);
      case 'booking.held':
        return this.onBookingHeld(evt.payload);
      case 'booking.review_pending':
        return this.onBookingReviewPending(evt.payload);
      case 'booking.review_approved':
        return this.onBookingReviewApproved(evt.payload);
      case 'booking.review_declined':
        return this.onBookingReviewDeclined(evt.payload);
      case 'booking.cancelled':
        return this.onBookingCancelled(evt.payload);
      case 'booking.expired':
        return this.onBookingExpired(evt.payload);
      case 'booking.refunded':
        return this.onBookingRefunded(evt.payload);
      case 'booking.paid':
        return this.onBookingPaid(evt.payload);
      case 'booking.confirmed':
        return this.onBookingConfirmed(evt.payload);
      case 'booking.policy_attached':
        return this.onBookingPolicyAttached(evt.payload);

      // ===== PAYMENT bridge =====
      case 'payment.succeeded':
        return this.onPaymentSucceeded(evt.payload);
      default:
        return;
    }
  }

  // ---------- BOOKING ----------
  private async onBookingAutoDeclined({ bookingId }: any) {
    if (!bookingId) return;
    await this.promo
      ?.releaseOnCancelOrExpire(bookingId, false, 'AUTO_DECLINED')
      .catch(() => {});
    this.logger.warn(`🚫 booking.auto_declined bookingId=${bookingId}`);
  }

  private onBookingHeld({ bookingId }: any) {
    if (!bookingId) return;
    this.logger.log(`📦 booking.held bookingId=${bookingId}`);
  }

  private onBookingReviewPending({ bookingId }: any) {
    if (!bookingId) return;
    this.logger.log(`🕵️ booking.review_pending bookingId=${bookingId}`);
  }

  private async onBookingReviewApproved({ bookingId }: any) {
    if (!bookingId) return;
    await this.invoice?.emailInvoice(bookingId).catch(() => {});
    this.logger.log(`✅ booking.review_approved bookingId=${bookingId}`);
  }

  private async onBookingReviewDeclined({ bookingId }: any) {
    if (!bookingId) return;
    await this.promo
      ?.releaseOnCancelOrExpire(bookingId, false, 'REVIEW_DECLINED')
      .catch(() => {});
    this.logger.warn(`❌ booking.review_declined bookingId=${bookingId}`);
  }

  private async onBookingCancelled({ bookingId }: any) {
    if (!bookingId) return;
    await this.promo
      ?.releaseOnCancelOrExpire(bookingId, false, 'CANCELLED')
      .catch(() => {});
  }

  private async onBookingExpired({ bookingId }: any) {
    if (!bookingId) return;
    await this.promo
      ?.releaseOnCancelOrExpire(bookingId, false, 'EXPIRED')
      .catch(() => {});
  }

  private async onBookingRefunded({ bookingId }: any) {
    if (!bookingId) return;
    await this.promo
      ?.releaseOnCancelOrExpire(bookingId, false, 'REFUNDED')
      .catch(() => {});
  }

  private async onBookingPaid({ bookingId }: any) {
    if (!bookingId) return;
    await this.promo?.confirmOnPaid(bookingId).catch(() => {});
    await this.invoice?.emailInvoice(bookingId).catch(() => {});
  }

  private onBookingConfirmed({ bookingId }: any) {
    if (!bookingId) return;
    this.logger.log(`🎉 booking.confirmed bookingId=${bookingId}`);
  }

  private onBookingPolicyAttached({ bookingId, cancelPolicyId }: any) {
    if (!bookingId || !cancelPolicyId) return;
    this.logger.log(
      `📎 booking.policy_attached bookingId=${bookingId} policy=${cancelPolicyId}`,
    );
  }

  // ---------- PAYMENT bridge ----------
  private async onPaymentSucceeded({ bookingId }: any) {
    if (!bookingId) return;
    await this.outbox.emit(
      'booking.paid',
      { bookingId },
      `booking.paid:${bookingId}`,
    );
  }

  // ---------- FILE ----------
  private async onFileUploaded({ fileId }: any) {
    if (!fileId) return;
    const f = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!f) return;

    // Quét AV
    const res = await this.av.scanMinioObject(f.key);

    if (res.status === 'CLEAN') {
      await this.prisma.file.update({
        where: { id: fileId },
        data: {
          malwareStatus: 'CLEAN',
          malwareSignature: null,
          scannedAt: new Date(),
        },
      });
      await this.outbox.emit(
        'dev.file.scanned',
        { fileId, status: 'CLEAN' },
        `dev.file.scanned:${fileId}`,
      );
      return;
    }

    if (res.status === 'INFECTED') {
      await this.prisma.file.update({
        where: { id: fileId },
        data: {
          malwareStatus: 'INFECTED',
          malwareSignature: res.signature ?? 'unknown',
          scannedAt: new Date(),
        },
      });
      await this.outbox.emit(
        'devfile.scanned',
        { fileId, status: 'INFECTED', signature: res.signature },
        `dev.file.scanned:${fileId}`,
      );
      await this.outbox.emit(
        'file.quarantined',
        { fileId },
        `file.quarantined:${fileId}`,
      );
      return;
    }

    // ERROR
    await this.prisma.file.update({
      where: { id: fileId },
      data: {
        malwareStatus: 'ERROR',
        malwareSignature: res.message ?? null,
        scannedAt: new Date(),
      },
    });
    await this.outbox.emit(
      'dev.file.scanned',
      { fileId, status: 'ERROR', message: res.message },
      `dev.file.scanned:${fileId}`,
    );
  }

  private async onFileScanned({ fileId, status }: any) {
    if (!fileId) return;
    if (status !== 'CLEAN') return; // chỉ tạo thumbnail khi sạch

    await this.thumbs.generate(fileId);
    await this.outbox.emit(
      'file.variant_created',
      { fileId },
      `variant:${fileId}`,
    );
  }
}
