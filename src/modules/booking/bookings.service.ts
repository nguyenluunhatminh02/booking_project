import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { addMinutes, eachDayOfInterval, subDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import env from '../../config/env.validation';
import { FraudService } from '../fraud/fraud.service';
import { IdempotencyService } from '../idempotency/idempotency.service';

const TZ = process.env.INVENTORY_TZ || 'Asia/Ho_Chi_Minh';
const MS_PER_DAY = 86_400_000;
const MAX_NIGHTS = 30; // giới hạn tối đa số đêm cho 1 hold

/** Chuẩn hoá 'YYYY-MM-DD' (theo TZ) hoặc ISO → bucket UTC 00:00 của TZ */
function toUtcBucket(input: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    // 'YYYY-MM-DD' -> 00:00 theo TZ -> UTC
    return fromZonedTime(`${input} 00:00:00`, TZ);
  }
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');
  const ymd = formatInTimeZone(d, TZ, 'yyyy-MM-dd');
  return fromZonedTime(`${ymd} 00:00:00`, TZ);
}

@Injectable()
export class BookingsService {
  private cfg = env();
  constructor(
    private prisma: PrismaService,
    private fraud: FraudService,
    private idem: IdempotencyService, // Stripe-style registry
  ) {}

  /**
   * Tạo HOLD (hoặc REVIEW nếu cần) — Stripe-style idempotency:
   * - BẮT BUỘC header `Idempotency-Key` (truyền vào idemKey).
   * - beginOrReuse(): nếu có snapshot → trả luôn; nếu đang xử lý → 409.
   * - Sau khi xong: completeOK()/completeFailed() để lưu snapshot.
   */
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
    if (!idemKey) {
      throw new BadRequestException('Idempotency-Key header required');
    }

    const checkIn = toUtcBucket(checkInInput);
    const checkOut = toUtcBucket(checkOutInput);
    const nights = Math.round(
      (checkOut.getTime() - checkIn.getTime()) / MS_PER_DAY,
    );
    if (nights <= 0) throw new BadRequestException('Invalid date range');
    if (nights > MAX_NIGHTS) {
      throw new BadRequestException(`Too many nights (>${MAX_NIGHTS})`);
    }

    // Gate idempotency theo (user, endpoint, key) + hash payload
    const endpoint = 'POST /bookings/hold';
    const payloadForHash = {
      userId,
      propertyId,
      checkIn: checkIn.toISOString(),
      checkOut: checkOut.toISOString(),
    };
    const ttlMs = (this.cfg.holdMinutes + 30) * 60 * 1000; // holdMinutes + buffer

    const gate = await this.idem.beginOrReuse({
      userId,
      endpoint,
      key: idemKey,
      payloadForHash,
      ttlMs,
    });

    if (gate.mode === 'REUSE') return gate.response; // trả snapshot lần đầu
    if (gate.mode === 'IN_PROGRESS')
      throw new ConflictException('Request in progress');

    const idemId = gate.id;

    try {
      const { booking, fa, wantReview } = await this.prisma.$transaction(
        async (tx) => {
          // 1) Khóa tồn kho dải ngày [checkIn, checkOut)
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

          // 2) Tính tiền
          const totalPrice = avs.reduce((s, a) => s + a.price, 0);

          // 3) Fraud assess
          const fa = await this.fraud.assess(userId, totalPrice);
          const wantReview =
            !fa.skipped && (fa.level === 'MEDIUM' || fa.level === 'HIGH');

          // 4) Trừ tồn kho từng ngày (điều kiện chống race)
          for (const a of avs) {
            const { count } = await tx.availabilityDay.updateMany({
              where: { id: a.id, isBlocked: false, remaining: { gt: 0 } },
              data: { remaining: { decrement: 1 } },
            });
            if (count !== 1) {
              throw new BadRequestException('Race condition on inventory');
            }
          }

          // 5) Tạo booking
          const booking = await tx.booking.create({
            data: {
              propertyId,
              customerId: userId,
              checkIn,
              checkOut,
              status: wantReview ? 'REVIEW' : 'HOLD',
              holdExpiresAt: addMinutes(new Date(), this.cfg.holdMinutes),
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

          // 7) Outbox trong transaction
          await tx.outbox.create({
            data: { topic: 'booking.held', payload: { bookingId: booking.id } },
          });
          if (wantReview) {
            await tx.outbox.create({
              data: {
                topic: 'booking.review_pending',
                payload: { bookingId: booking.id },
              },
            });
          }

          return { booking, fa, wantReview };
        },
        // Optional: { isolationLevel: 'Serializable' }
      );

      const response = {
        id: booking.id,
        status: booking.status as 'HOLD' | 'REVIEW',
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

  /** Dọn HOLD/REVIEW hết hạn và trả kho — tránh double-increment khi multi worker */
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
          // 1) Chuyển trạng thái có điều kiện (guard) – nếu đã xử lý nơi khác, bỏ qua
          const { count } = await tx.booking.updateMany({
            where: {
              id: b.id,
              status: { in: ['HOLD', 'REVIEW'] },
              holdExpiresAt: { lt: now },
            },
            data: { status: 'CANCELLED' },
          });
          if (count === 0) return;

          // 2) Trả kho đúng số ngày đã giữ
          const days = eachDayOfInterval({
            start: b.checkIn,
            end: subDays(b.checkOut, 1),
          });
          for (const d of days) {
            await tx.availabilityDay.updateMany({
              where: { propertyId: b.propertyId, date: d },
              data: { remaining: { increment: 1 } },
            });
          }

          // 3) Outbox
          await tx.outbox.create({
            data: { topic: 'booking.expired', payload: { bookingId: b.id } },
          });
        });
      }

      total += batch.length;
    }

    return { expired: total };
  }

  /** Khách tự huỷ HOLD/REVIEW, trả kho và phát outbox — chống race với expire/paid */
  async cancelHold(userId: string, bookingId: string) {
    const b = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!b) throw new BadRequestException('Booking not found');
    if (b.customerId !== userId) throw new ForbiddenException();

    const updated = await this.prisma.$transaction(async (tx) => {
      // Guard chuyển trạng thái có điều kiện để tránh double-increment
      const { count } = await tx.booking.updateMany({
        where: { id: b.id, status: { in: ['HOLD', 'REVIEW'] } },
        data: { status: 'CANCELLED' },
      });
      if (count === 0) throw new BadRequestException('Already processed');

      const days = eachDayOfInterval({
        start: b.checkIn,
        end: subDays(b.checkOut, 1),
      });
      for (const d of days) {
        await tx.availabilityDay.updateMany({
          where: { propertyId: b.propertyId, date: d },
          data: { remaining: { increment: 1 } },
        });
      }

      const ret = await tx.booking.findUnique({ where: { id: b.id } });

      await tx.outbox.create({
        data: { topic: 'booking.cancelled', payload: { bookingId } },
      });

      return ret!;
    });

    return updated;
  }
}
