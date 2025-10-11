import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  addDays,
  addMinutes,
  differenceInCalendarDays,
  eachDayOfInterval,
  subDays,
} from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { FraudService } from '../fraud/fraud.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { OutboxProducer } from '../outbox/outbox.producer';
import { AppConfigService } from '../../config/app-config.service';

const TZ = process.env.INVENTORY_TZ || 'Asia/Ho_Chi_Minh';
const MS_PER_DAY = 86_400_000;
const MAX_NIGHTS = 30;

type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
type BookingStatus =
  | 'HOLD'
  | 'REVIEW'
  | 'CANCELLED'
  | 'PAID'
  | 'CONFIRMED'
  | 'REFUNDED';
type CancelRule = { beforeDays: number; refundPercent: number };

// Helpers
function toUtcBucket(input: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return fromZonedTime(`${input} 00:00:00`, TZ);
  }
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');
  const ymd = formatInTimeZone(d, TZ, 'yyyy-MM-dd');
  return fromZonedTime(`${ymd} 00:00:00`, TZ);
}

function refundPercentByRules(daysBefore: number, rules: CancelRule[]): number {
  for (const r of rules) if (daysBefore >= r.beforeDays) return r.refundPercent;
  return 0;
}

@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private fraud: FraudService,
    private idem: IdempotencyService,
    private outbox: OutboxProducer,
    private config: AppConfigService,
  ) {}

  async hold(
    userId: string,
    propertyId: string,
    checkInInput: string,
    checkOutInput: string,
    idemKey?: string,
  ) {
    if (!userId || !propertyId || !checkInInput || !checkOutInput) {
      throw new BadRequestException('Missing required input');
    }
    if (!idemKey)
      throw new BadRequestException('Idempotency-Key header required');

    const checkIn = toUtcBucket(checkInInput);
    const checkOut = toUtcBucket(checkOutInput);
    const nights = Math.round(
      (checkOut.getTime() - checkIn.getTime()) / MS_PER_DAY,
    );
    if (nights <= 0) throw new BadRequestException('Invalid date range');
    if (nights > MAX_NIGHTS)
      throw new BadRequestException(`Too many nights (>${MAX_NIGHTS})`);

    const endpoint = 'POST /bookings/hold';
    const payloadForHash = {
      userId,
      propertyId,
      checkIn: checkIn.toISOString(),
      checkOut: checkOut.toISOString(),
    };
    const holdMinutes = this.config.bookingHoldMinutes;
    const ttlMs = (holdMinutes + 30) * 60 * 1000;

    const gate = await this.idem.beginOrReuse({
      userId,
      endpoint,
      key: idemKey,
      payloadForHash,
      ttlMs,
    });
    if (gate.mode === 'REUSE') return gate.response;
    if (gate.mode === 'IN_PROGRESS')
      throw new ConflictException('Request in progress');
    const idemId = (gate as any).id;

    try {
      const transactionResult = await this.prisma.$transaction(async (tx) => {
        // 1) Lock inventory days
        const avs = await tx.$queryRaw<any[]>`
            SELECT * FROM "AvailabilityDay"
            WHERE "propertyId" = ${propertyId}
              AND "date" >= ${checkIn}
              AND "date" <  ${checkOut}
            ORDER BY "date" ASC
            FOR UPDATE
          `;
        const daysRange = eachDayOfInterval({
          start: checkIn,
          end: subDays(checkOut, 1),
        });
        if (
          avs.length !== daysRange.length ||
          avs.some((d) => d.isBlocked || d.remaining <= 0)
        ) {
          throw new BadRequestException('Not available');
        }

        // 2) Pricing
        const totalPrice = avs.reduce((s, a) => s + a.price, 0);

        // 3) Fraud
        const fa = await this.fraud.assess(userId, totalPrice);
        const level = fa.level as RiskLevel;
        const wantReview =
          !fa.skipped && (level === 'MEDIUM' || level === 'HIGH');

        // 3.1) Auto-decline HIGH (optional)
        const autoDeclineHigh = this.config.autoDeclineHighRisk;
        if (level === 'HIGH' && autoDeclineHigh) {
          const booking = await tx.booking.create({
            data: {
              propertyId,
              customerId: userId,
              checkIn,
              checkOut,
              status: 'CANCELLED',
              holdExpiresAt: null,
              totalPrice,
            },
          });
          await tx.fraudAssessment.upsert({
            where: { bookingId: booking.id },
            update: {
              score: fa.score,
              level: fa.level as any,
              reasons: fa.reasons as any,
              decision: 'AUTO_DECLINED',
            },
            create: {
              bookingId: booking.id,
              userId,
              score: fa.score,
              level: fa.level as any,
              decision: 'AUTO_DECLINED',
              reasons: fa.reasons as any,
            },
          });

          await this.outbox.emitInTx(
            tx,
            'booking.auto_declined',
            `booking.auto_declined:${booking.id}`,
            { bookingId: booking.id },
          );

          return { booking, fa, wantReview: false as const };
        }

        // 4) Decrement inventory by id
        for (const a of avs) {
          const affected = await tx.$executeRaw`
              UPDATE "AvailabilityDay"
                 SET "remaining" = "remaining" - 1
               WHERE "id" = ${a.id}
                 AND "isBlocked" = false
                 AND "remaining" > 0
            `;
          if (Number(affected) !== 1) {
            throw new BadRequestException('Race condition on inventory');
          }
        }

        // 5) Booking
        const reviewDays = this.config.reviewHoldDays;
        const holdExpiry = wantReview
          ? addDays(new Date(), reviewDays)
          : addMinutes(new Date(), holdMinutes);

        const status: BookingStatus = wantReview ? 'REVIEW' : 'HOLD';
        const booking = await tx.booking.create({
          data: {
            propertyId,
            customerId: userId,
            checkIn,
            checkOut,
            status,
            holdExpiresAt: holdExpiry,
            reviewDeadlineAt: wantReview ? holdExpiry : null,
            totalPrice,
          },
        });

        // 6) FraudAssessment nếu REVIEW
        if (wantReview) {
          await tx.fraudAssessment.upsert({
            where: { bookingId: booking.id },
            update: {
              score: fa.score,
              level: fa.level as any,
              reasons: fa.reasons as any,
              decision: 'PENDING',
            },
            create: {
              bookingId: booking.id,
              userId,
              score: fa.score,
              level: fa.level as any,
              decision: 'PENDING',
              reasons: fa.reasons as any,
            },
          });
        }

        // 7) Outbox
        await this.outbox.emitInTx(
          tx,
          'booking.held',
          `booking.held:${booking.id}`,
          {
            bookingId: booking.id,
          },
        );
        if (wantReview) {
          await this.outbox.emitInTx(
            tx,
            'booking.review_pending',
            `booking.review_pending:${booking.id}`,
            { bookingId: booking.id },
          );
        }

        return { booking, fa, wantReview };
      });

      const { booking, fa } = transactionResult;

      const response = {
        id: booking.id,
        status: booking.status as 'HOLD' | 'REVIEW' | 'CANCELLED',
        totalPrice: booking.totalPrice,
        holdExpiresAt: booking.holdExpiresAt,
        fraud: fa,
      };
      await this.idem.completeOK(idemId, response, booking.id);
      return response;
    } catch (err) {
      await this.idem.completeFailed(idemId, {
        message: err?.message ?? 'unknown',
      });
      throw err;
    }
  }

  // Aliases để khớp test cũ
  async approveReview(reviewerId: string, bookingId: string, note?: string) {
    return this.reviewApprove(bookingId, reviewerId, note);
  }
  async declineReview(reviewerId: string, bookingId: string, note?: string) {
    return this.reviewDecline(bookingId, reviewerId, note);
  }

  /** REVIEW -> CONFIRMED */
  async reviewApprove(bookingId: string, reviewerId: string, note?: string) {
    return await this.prisma.$transaction(async (tx) => {
      const b = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!b) throw new BadRequestException('Booking not found');
      if (b.status !== 'REVIEW')
        throw new BadRequestException('Booking not in REVIEW');

      await tx.fraudAssessment.update({
        where: { bookingId },
        data: {
          decision: 'APPROVED',
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          reviewedNote: note ?? null,
        },
      });

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'CONFIRMED',
          reviewDeadlineAt: null,
          holdExpiresAt: null,
        },
      });

      await this.outbox.emitInTx(
        tx,
        'booking.review_approved',
        `booking.review_approved:${bookingId}`,
        {
          bookingId,
        },
      );

      return updated;
    });
  }

  /** REVIEW -> CANCELLED + trả kho (theo id) */
  async reviewDecline(bookingId: string, reviewerId: string, note?: string) {
    return await this.prisma.$transaction(async (tx) => {
      const b = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!b) throw new BadRequestException('Booking not found');
      if (b.status !== 'REVIEW')
        throw new BadRequestException('Booking not in REVIEW');

      // Lock inventory range
      const avs = await tx.$queryRaw<any[]>`
        SELECT *
        FROM "AvailabilityDay"
        WHERE "propertyId" = ${b.propertyId}
          AND "date" >= ${b.checkIn}
          AND "date" <  ${b.checkOut}
        ORDER BY "date" ASC
        FOR UPDATE
      `;

      // Return inventory: +1
      for (const a of avs) {
        const affected = await tx.$executeRaw`
          UPDATE "AvailabilityDay"
             SET "remaining" = "remaining" + 1
           WHERE "id" = ${a.id}
        `;
        if (Number(affected) !== 1) {
          throw new ConflictException('Inventory return failed');
        }
      }

      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'CANCELLED' },
      });

      await tx.fraudAssessment.update({
        where: { bookingId },
        data: {
          decision: 'REJECTED',
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          reviewedNote: note ?? null,
        },
      });

      await this.outbox.emitInTx(
        tx,
        'booking.review_declined',
        `booking.review_declined:${bookingId}`,
        {
          bookingId,
        },
      );

      return { ok: true };
    });
  }

  /** Attach policy snapshot */
  async attachCancelPolicy(bookingId: string, cancelPolicyId: string) {
    return await this.prisma.$transaction(async (tx) => {
      const b = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!b) throw new BadRequestException('Booking not found');

      const p = await tx.cancelPolicy.findUnique({
        where: { id: cancelPolicyId },
      });
      if (!p || !p.isActive)
        throw new BadRequestException('Cancel policy not found or inactive');

      const snapshot = {
        name: p.name,
        rules: p.rules as CancelRule[],
        checkInHour: p.checkInHour ?? null,
        cutoffHour: p.cutoffHour ?? null,
      };

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { cancelPolicyId, cancelPolicySnapshot: snapshot as any },
      });

      await this.outbox.emitInTx(
        tx,
        'booking.policy_attached',
        `booking.policy_attached:${bookingId}`,
        {
          bookingId,
          cancelPolicyId,
        },
      );

      return updated;
    });
  }

  /** Preview refund theo snapshot */
  async previewRefund(bookingId: string, cancelAt: Date) {
    const b = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!b) throw new BadRequestException('Booking not found');

    const snap = (b as any).cancelPolicySnapshot as {
      rules: CancelRule[];
      checkInHour?: number | null;
    } | null;

    if (!snap?.rules?.length) return { percent: 0, refundAmount: 0 };

    const checkInYmd = formatInTimeZone(b.checkIn, TZ, 'yyyy-MM-dd');
    const checkInAtTz = fromZonedTime(`${checkInYmd} 00:00:00`, TZ);
    const cancelYmd = formatInTimeZone(cancelAt, TZ, 'yyyy-MM-dd');
    const cancelAtTz = fromZonedTime(`${cancelYmd} 00:00:00`, TZ);

    const daysBefore = differenceInCalendarDays(checkInAtTz, cancelAtTz);
    const rulesSorted = [...snap.rules].sort(
      (a, b) => b.beforeDays - a.beforeDays,
    );
    const percent = refundPercentByRules(daysBefore, rulesSorted);
    const amount = Math.floor((b.totalPrice * percent) / 100);

    return { percent, refundAmount: amount };
  }

  /** Expire HOLD/REVIEW + trả kho (theo id) */
  async expireHolds(now = new Date()) {
    let total = 0;

    while (true) {
      const batch = await this.prisma.booking.findMany({
        where: {
          status: { in: ['HOLD', 'REVIEW'] },
          holdExpiresAt: { lt: now },
        },
        orderBy: { holdExpiresAt: 'asc' },
        take: 200,
      });
      if (!batch.length) break;

      for (const b of batch) {
        await this.prisma.$transaction(async (tx) => {
          const { count } = await tx.booking.updateMany({
            where: {
              id: b.id,
              status: { in: ['HOLD', 'REVIEW'] },
              holdExpiresAt: { lt: now },
            },
            data: { status: 'CANCELLED' },
          });
          if (count === 0) return;

          const avs = await tx.$queryRaw<any[]>`
            SELECT *
            FROM "AvailabilityDay"
            WHERE "propertyId" = ${b.propertyId}
              AND "date" >= ${b.checkIn}
              AND "date" <  ${b.checkOut}
            ORDER BY "date" ASC
            FOR UPDATE
          `;
          for (const a of avs) {
            await tx.$executeRaw`
              UPDATE "AvailabilityDay"
                 SET "remaining" = "remaining" + 1
               WHERE "id" = ${a.id}
            `;
          }

          await this.outbox.emitInTx(
            tx,
            'booking.expired',
            `booking.expired:${b.id}`,
            {
              bookingId: b.id,
            },
          );
        });
      }

      total += batch.length;
    }

    return { expired: total };
  }

  /** Khách tự huỷ HOLD/REVIEW + trả kho (theo id) */
  async cancelHold(userId: string, bookingId: string) {
    const b = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!b) throw new BadRequestException('Booking not found');
    if (b.customerId !== userId) throw new ForbiddenException();

    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.booking.updateMany({
        where: { id: b.id, status: { in: ['HOLD', 'REVIEW'] } },
        data: { status: 'CANCELLED' },
      });
      if (count === 0) throw new BadRequestException('Already processed');

      const avs = await tx.$queryRaw<any[]>`
        SELECT *
        FROM "AvailabilityDay"
        WHERE "propertyId" = ${b.propertyId}
          AND "date" >= ${b.checkIn}
          AND "date" <  ${b.checkOut}
        ORDER BY "date" ASC
        FOR UPDATE
      `;
      for (const a of avs) {
        await tx.$executeRaw`
          UPDATE "AvailabilityDay"
             SET "remaining" = "remaining" + 1
           WHERE "id" = ${a.id}
        `;
      }

      const ret = await tx.booking.findUnique({ where: { id: b.id } });

      await this.outbox.emitInTx(
        tx,
        'booking.cancelled',
        `booking.cancelled:${bookingId}`,
        {
          bookingId,
        },
      );

      return ret!;
    });

    return updated;
  }

  /** Huỷ PAID/CONFIRMED → REFUNDED (mock) */
  async cancelPaidOrConfirmed(userId: string, bookingId: string) {
    return await this.prisma.$transaction(async (tx) => {
      const b = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!b) throw new BadRequestException('Booking not found');
      if (b.customerId !== userId) throw new ForbiddenException();
      if (b.status !== 'PAID' && b.status !== 'CONFIRMED') {
        throw new BadRequestException('Not cancellable in current status');
      }

      // --- Compute refund by snapshot rules (same logic as previewRefund) ---
      const snap = (b as any).cancelPolicySnapshot as {
        rules?: CancelRule[];
      } | null;
      let refundPercent = 0;
      let refundAmount = 0;
      if (snap?.rules?.length) {
        const checkInYmd = formatInTimeZone(b.checkIn, TZ, 'yyyy-MM-dd');
        const checkInAtTz = fromZonedTime(`${checkInYmd} 00:00:00`, TZ);
        const now = new Date();
        const cancelYmd = formatInTimeZone(now, TZ, 'yyyy-MM-dd');
        const cancelAtTz = fromZonedTime(`${cancelYmd} 00:00:00`, TZ);
        const daysBefore = differenceInCalendarDays(checkInAtTz, cancelAtTz);
        const rulesSorted = [...snap.rules].sort(
          (a, b) => b.beforeDays - a.beforeDays,
        );
        refundPercent = refundPercentByRules(daysBefore, rulesSorted);
        refundAmount = Math.floor((b.totalPrice * refundPercent) / 100);
      }

      // --- Create Refund records + mark Payment REFUNDED ---
      const pays = await tx.payment.findMany({
        where: { bookingId, status: 'SUCCEEDED' },
      });
      for (const p of pays) {
        await tx.refund.create({
          data: { paymentId: p.id, amount: refundAmount, status: 'SUCCEEDED' },
        });
        await tx.payment.update({
          where: { id: p.id },
          data: { status: 'REFUNDED' },
        });
      }

      // --- Return inventory (by day ids) ---
      const avs = await tx.$queryRaw<any[]>`
        SELECT *
        FROM "AvailabilityDay"
        WHERE "propertyId" = ${b.propertyId}
          AND "date" >= ${b.checkIn}
          AND "date" <  ${b.checkOut}
        ORDER BY "date" ASC
        FOR UPDATE
      `;
      for (const a of avs) {
        await tx.$executeRaw`
          UPDATE "AvailabilityDay"
             SET "remaining" = "remaining" + 1
           WHERE "id" = ${a.id}
        `;
      }

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'REFUNDED' },
      });

      await this.outbox.emitInTx(
        tx,
        'booking.refunded',
        `booking.refunded:${bookingId}`,
        {
          bookingId,
        },
      );

      return updated;
    });
  }
}
