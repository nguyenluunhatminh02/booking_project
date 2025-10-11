import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { OutboxProducer } from '../outbox/outbox.producer';
import { PaymentProvider } from '@prisma/client';
import { CreateIntentDto } from './dto/create-intent.dto';
import { RefundDto } from './dto/refund.dto';
import { PaymentProviderAdapter } from './providers/provider.adapter';
import { MockProviderAdapter } from './providers/mock.adapter';
import { StripeLikeHmacAdapter } from './providers/stripelike.adapter';
import { VnpayAdapter } from './providers/vnpay.adapter';
import { safeReturnUrl } from 'src/utils/url-guard';

function pickProvider(name?: string): PaymentProvider {
  const n = (name || process.env.PAYMENT_PROVIDER || 'MOCK').toUpperCase();
  if (n === 'STRIPE') return 'STRIPE';
  if (n === 'VNPAY') return 'VNPAY';
  return 'MOCK';
}

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idem: IdempotencyService,
    private readonly outbox: OutboxProducer,
    private readonly mock: MockProviderAdapter,
    private readonly stripe: StripeLikeHmacAdapter,
    private readonly vnpay: VnpayAdapter,
  ) {}

  private adapter(p: PaymentProvider): PaymentProviderAdapter {
    return p === 'STRIPE'
      ? this.stripe
      : p === 'VNPAY'
        ? this.vnpay
        : this.mock;
  }

  /** Tạo intent (Stripe → clientSecret; VNPay → redirectUrl). Idempotent theo Idempotency-Key. */
  async createIntent(
    userId: string,
    bookingId: string,
    dto: CreateIntentDto,
    idemKey?: string,
  ) {
    const provider = pickProvider(dto.provider);
    const gate = await this.idem.beginOrReuse({
      userId,
      endpoint: 'POST /payments/:bookingId/intent',
      // luôn truyền string: nếu thiếu header thì tự sinh
      key:
        idemKey || `auto:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      payloadForHash: {
        bookingId,
        provider,
        returnUrl: dto.returnUrl ?? null,
        orderInfo: dto.orderInfo ?? null,
      },
      ttlMs: 10 * 60 * 1000,
    });
    if (gate.mode === 'REUSE') return gate.response;
    if (gate.mode === 'IN_PROGRESS')
      throw new ConflictException('Request in progress');
    const idemId = (gate as any).id;

    try {
      const res = await this.prisma.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id: bookingId },
        });
        if (!booking) throw new NotFoundException('Booking not found');
        if (booking.customerId !== userId)
          throw new ForbiddenException('Not your booking');

        const amount = booking.totalPrice ?? 0;
        if (!Number.isInteger(amount) || amount <= 0)
          throw new BadRequestException('Invalid booking amount');

        const ad = this.adapter(provider);
        const created = await ad.createIntent({
          amount,
          currency: process.env.PAYMENT_CURRENCY || 'VND',
          returnUrl: safeReturnUrl(dto.returnUrl) ?? undefined,
          metadata: {
            bookingId,
            ipAddr: dto.clientIp,
            orderInfo: dto.orderInfo,
          },
        });

        const payment = await tx.payment.upsert({
          where: { bookingId },
          create: {
            bookingId,
            provider,
            amount,
            currency: process.env.PAYMENT_CURRENCY || 'VND',
            status: 'PENDING',
            intentId: created.intentId,
            metadata: { returnUrl: dto.returnUrl ?? null },
          },
          update: {
            provider,
            amount,
            currency: process.env.PAYMENT_CURRENCY || 'VND',
            status: 'PENDING',
            intentId: created.intentId,
            metadata: { returnUrl: dto.returnUrl ?? null },
          },
        });

        await this.outbox.emitInTx(tx, 'payment.intent_created', payment.id, {
          paymentId: payment.id,
          bookingId,
          provider,
          amount,
        });

        return {
          paymentId: payment.id,
          provider,
          amount,
          currency: payment.currency,
          intentId: created.intentId,
          clientSecret: created.clientSecret ?? null,
          redirectUrl: created.redirectUrl ?? null,
        };
      });

      await this.idem.completeOK(idemId, res, String(res.paymentId));
      return res;
    } catch (e: any) {
      await this.idem.completeFailed(idemId, {
        message: e?.message ?? 'unknown',
      });
      throw e;
    }
  }

  /** Webhook body (Stripe/Mock). VNPay dùng IPN GET. */
  async handleWebhook(headers: Record<string, any>, rawBody: string) {
    const provider: PaymentProvider = headers['stripe-signature']
      ? 'STRIPE'
      : 'MOCK';
    const ad = this.adapter(provider);
    const evt = await ad.verifyAndNormalizeWebhook(headers, rawBody);

    const dup = await this.prisma.processedWebhook.findUnique({
      where: { id: `${provider}:${evt.eventId}` },
    });
    if (dup) return { ok: true, duplicate: true };

    await this.prisma.$transaction(async (tx) => {
      let payment = null as any;

      if (evt.paymentIdHint)
        payment = await tx.payment.findUnique({
          where: { id: evt.paymentIdHint },
        });
      if (!payment && evt.intentId)
        payment = await tx.payment.findFirst({
          where: { provider, intentId: evt.intentId },
        });
      if (!payment && evt.chargeId)
        payment = await tx.payment.findFirst({
          where: { provider, chargeId: evt.chargeId },
        });
      if (!payment)
        throw new NotFoundException('Payment not found for webhook');

      switch (evt.type) {
        case 'payment_succeeded': {
          if (payment.status !== 'SUCCEEDED' && payment.status !== 'REFUNDED') {
            payment = await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: 'SUCCEEDED',
                chargeId: evt.chargeId ?? payment.chargeId ?? undefined,
              },
            });

            const autoConfirm =
              (process.env.PAYMENT_AUTO_CONFIRM ?? 'true') === 'true';
            const booking = await tx.booking.findUnique({
              where: { id: payment.bookingId },
            });
            if (!booking) throw new NotFoundException('Booking not found');

            if (autoConfirm) {
              if (booking.status !== 'CONFIRMED') {
                await tx.booking.update({
                  where: { id: booking.id },
                  data: {
                    status: 'CONFIRMED',
                    holdExpiresAt: null,
                    reviewDeadlineAt: null,
                  },
                });
                await this.outbox.emitInTx(
                  tx,
                  'booking.confirmed',
                  booking.id,
                  { bookingId: booking.id },
                );
              }
            } else {
              if (booking.status !== 'PAID') {
                await tx.booking.update({
                  where: { id: booking.id },
                  data: { status: 'PAID', holdExpiresAt: null },
                });
                await this.outbox.emitInTx(tx, 'booking.paid', booking.id, {
                  bookingId: booking.id,
                });
              }
            }

            await this.outbox.emitInTx(tx, 'payment.succeeded', payment.id, {
              paymentId: payment.id,
              bookingId: payment.bookingId,
              provider,
              amount: payment.amount,
            });
          }
          break;
        }
        case 'payment_failed': {
          if (payment.status === 'PENDING') {
            await tx.payment.update({
              where: { id: payment.id },
              data: { status: 'FAILED' },
            });
            await this.outbox.emitInTx(tx, 'payment.failed', payment.id, {
              paymentId: payment.id,
              bookingId: payment.bookingId,
              provider,
            });
          }
          break;
        }
        case 'refund_succeeded': {
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: 'REFUNDED' },
          });
          await tx.refund.updateMany({
            where: { paymentId: payment.id, status: 'PENDING' },
            data: { status: 'SUCCEEDED' },
          });
          await this.outbox.emitInTx(tx, 'payment.refunded', payment.id, {
            paymentId: payment.id,
            bookingId: payment.bookingId,
            provider,
          });
          break;
        }
        case 'refund_failed': {
          await tx.refund.updateMany({
            where: { paymentId: payment.id, status: 'PENDING' },
            data: { status: 'FAILED' },
          });
          await this.outbox.emitInTx(tx, 'payment.refund_failed', payment.id, {
            paymentId: payment.id,
            bookingId: payment.bookingId,
            provider,
          });
          break;
        }
      }

      try {
        await tx.processedWebhook.create({
          data: {
            id: `${provider}:${evt.eventId}`,
            provider,
            raw: evt.raw,
          },
        });
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e; // duplicate → bỏ qua
      }
    });

    return { ok: true };
  }

  /** VNPay IPN (GET) */
  async handleVnpayIpn(queryParams: Record<string, any>) {
    const ad = this.adapter('VNPAY');
    if (!ad.verifyAndNormalizeIpn)
      throw new BadRequestException('VNPAY IPN not supported');

    const evt = await ad.verifyAndNormalizeIpn(queryParams);
    const dup = await this.prisma.processedWebhook.findUnique({
      where: { id: `${evt.provider}:${evt.eventId}` },
    });
    if (dup) return { ok: true, duplicate: true };

    await this.prisma.$transaction(async (tx) => {
      let payment = null as any;
      if (evt.intentId)
        payment = await tx.payment.findFirst({
          where: { provider: 'VNPAY', intentId: evt.intentId },
        });
      if (!payment)
        throw new NotFoundException('Payment not found for VNPay IPN');

      switch (evt.type) {
        case 'payment_succeeded': {
          if (payment.status !== 'SUCCEEDED' && payment.status !== 'REFUNDED') {
            await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: 'SUCCEEDED',
                chargeId: evt.chargeId ?? payment.chargeId ?? undefined,
              },
            });

            const autoConfirm =
              (process.env.PAYMENT_AUTO_CONFIRM ?? 'true') === 'true';
            const booking = await tx.booking.findUnique({
              where: { id: payment.bookingId },
            });
            if (!booking) throw new NotFoundException('Booking not found');

            if (autoConfirm) {
              if (booking.status !== 'CONFIRMED') {
                await tx.booking.update({
                  where: { id: booking.id },
                  data: {
                    status: 'CONFIRMED',
                    holdExpiresAt: null,
                    reviewDeadlineAt: null,
                  },
                });
                await this.outbox.emitInTx(
                  tx,
                  'booking.confirmed',
                  booking.id,
                  { bookingId: booking.id },
                );
              }
            } else {
              if (booking.status !== 'PAID') {
                await tx.booking.update({
                  where: { id: booking.id },
                  data: { status: 'PAID', holdExpiresAt: null },
                });
                await this.outbox.emitInTx(tx, 'booking.paid', booking.id, {
                  bookingId: booking.id,
                });
              }
            }

            await this.outbox.emitInTx(tx, 'payment.succeeded', payment.id, {
              paymentId: payment.id,
              bookingId: payment.bookingId,
              provider: 'VNPAY',
              amount: payment.amount,
            });
          }
          break;
        }
        default: {
          if (payment.status === 'PENDING') {
            await tx.payment.update({
              where: { id: payment.id },
              data: { status: 'FAILED' },
            });
            await this.outbox.emitInTx(tx, 'payment.failed', payment.id, {
              paymentId: payment.id,
              bookingId: payment.bookingId,
              provider: 'VNPAY',
            });
          }
        }
      }

      try {
        await tx.processedWebhook.create({
          data: {
            id: `${evt.provider}:${evt.eventId}`,
            provider: 'VNPAY',
            raw: evt.raw,
          },
        });
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
      }
    });

    return { ok: true };
  }

  /** Refund (Stripe/Mock). VNPay mặc định chưa hỗ trợ. */
  async refund(
    userId: string,
    paymentId: string,
    dto: RefundDto,
    idemKey?: string,
  ) {
    const gate = await this.idem.beginOrReuse({
      userId,
      endpoint: 'POST /payments/:id/refund',
      key:
        idemKey || `auto:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      payloadForHash: { paymentId, amount: dto.amount ?? null },
      ttlMs: 10 * 60 * 1000,
    });
    if (gate.mode === 'REUSE') return gate.response;
    if (gate.mode === 'IN_PROGRESS')
      throw new ConflictException('Request in progress');
    const idemId = (gate as any).id;

    try {
      const res = await this.prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { id: paymentId },
        });
        if (!payment) throw new NotFoundException('Payment not found');

        const booking = await tx.booking.findUnique({
          where: { id: payment.bookingId },
        });
        if (!booking) throw new NotFoundException('Booking not found');
        if (booking.customerId !== userId)
          throw new ForbiddenException('Not your booking');

        if (payment.provider === 'VNPAY')
          throw new BadRequestException(
            'VNPay refund not supported by this adapter',
          );
        if (payment.status !== 'SUCCEEDED')
          throw new BadRequestException(
            'Only SUCCEEDED payment can be refunded',
          );

        const amount = dto.amount ?? payment.amount;
        if (!Number.isInteger(amount) || amount <= 0 || amount > payment.amount)
          throw new BadRequestException('Invalid refund amount');

        const refund = await tx.refund.create({
          data: { paymentId: payment.id, amount, status: 'PENDING' },
        });

        const ad = this.adapter(payment.provider);
        const r = await ad.createRefund({
          chargeId: payment.chargeId ?? payment.intentId ?? '',
          amount,
        });

        await this.outbox.emitInTx(tx, 'payment.refund_requested', refund.id, {
          refundId: refund.id,
          paymentId: payment.id,
          bookingId: booking.id,
          amount,
        });

        if (payment.provider === 'MOCK') {
          await tx.refund.update({
            where: { id: refund.id },
            data: { status: 'SUCCEEDED', providerRefundId: r.refundId },
          });
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: 'REFUNDED' },
          });
          const full = amount === payment.amount;
          if (full) {
            await tx.booking.update({
              where: { id: booking.id },
              data: { status: 'REFUNDED' },
            });
            await this.outbox.emitInTx(tx, 'booking.refunded', booking.id, {
              bookingId: booking.id,
            });
          }
          await this.outbox.emitInTx(tx, 'payment.refunded', payment.id, {
            paymentId: payment.id,
            bookingId: booking.id,
            amount,
          });
        }

        return {
          refundId: refund.id,
          status: payment.provider === 'MOCK' ? 'SUCCEEDED' : 'PENDING',
        };
      });

      await this.idem.completeOK(idemId, res, paymentId);
      return res;
    } catch (e: any) {
      await this.idem.completeFailed(idemId, {
        message: e?.message ?? 'unknown',
      });
      throw e;
    }
  }

  async getPayment(id: string) {
    const p = await this.prisma.payment.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Payment not found');
    return p;
  }

  async listByBooking(bookingId: string) {
    return this.prisma.payment.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
