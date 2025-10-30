import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FeatureFlagsService } from '../feature-flag/feature-flags.service';
import { isEnabledForUser } from '../feature-flag/ff-rollout.util';
import { eachDayOfInterval, subDays } from 'date-fns';

type RuleResult = { points: number; reason: string };
export type AssessResult = {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
  skipped: boolean;
};

@Injectable()
export class FraudService {
  constructor(
    private prisma: PrismaService,
    private ff: FeatureFlagsService,
  ) {}

  // ---------- Public API ----------

  /** Đánh giá rủi ro cho đơn (dùng khi HOLD) */
  async assess(
    userId: string,
    amount: number,
    now: Date = new Date(),
  ): Promise<AssessResult> {
    if (!userId) throw new BadRequestException('userId is required');

    // Gating bằng feature flag
    const on = await isEnabledForUser(this.ff, 'fraud_check', userId);
    if (!on) return { score: 0, level: 'LOW', reasons: [], skipped: true };

    const results = await Promise.all([
      this.ruleNewUser(userId, now),
      this.ruleManyHoldsRecently(userId, now),
      this.ruleRecentPaymentFails(userId, now),
      this.ruleHighAmount(amount),
    ]);

    const score = results.reduce((s, r) => s + r.points, 0);
    const level: AssessResult['level'] =
      score >= 60 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
    const reasons = results.filter((r) => r.points > 0).map((r) => r.reason);
    return { score, level, reasons, skipped: false };
  }

  /** Lấy 1 FraudAssessment theo bookingId (kèm booking/user) */
  async getCase(bookingId: string) {
    const fa = await this.prisma.fraudAssessment.findUnique({
      where: { bookingId },
      include: {
        booking: {
          include: {
            property: true,
            customer: { select: { id: true, email: true } },
          },
        },
        reviewer: { select: { id: true, email: true } },
      },
    });
    if (!fa) throw new BadRequestException('FraudAssessment not found');
    return fa;
  }

  /** List cases (mặc định PENDING) */
  async listCases(params: {
    decision?: 'PENDING' | 'APPROVED' | 'REJECTED';
    skip?: number;
    take?: number;
  }) {
    const { decision = 'PENDING', skip = 0, take = 20 } = params ?? {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.fraudAssessment.findMany({
        where: { decision },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          booking: {
            include: {
              property: true,
              customer: { select: { id: true, email: true } },
            },
          },
          reviewer: { select: { id: true, email: true } },
        },
      }),
      this.prisma.fraudAssessment.count({ where: { decision } }),
    ]);
    return { items, total, skip, take };
  }

  /**
   * Quyết định review:
   * - APPROVED: booking REVIEW -> HOLD (giữ holdExpiresAt cũ)
   * - REJECTED: booking REVIEW -> CANCELLED + trả kho
   * - Idempotent theo decision: chỉ xử lý nếu FraudAssessment đang PENDING
   */
  async decide(
    bookingId: string,
    reviewerId: string,
    decision: 'APPROVED' | 'REJECTED',
    note?: string,
  ) {
    if (!bookingId || !reviewerId)
      throw new BadRequestException('bookingId/reviewerId required');
    if (decision !== 'APPROVED' && decision !== 'REJECTED')
      throw new BadRequestException('Invalid decision');

    return this.prisma.$transaction(async (tx) => {
      // 1) Lấy case + booking (và guard state)
      const fa = await tx.fraudAssessment.findUnique({ where: { bookingId } });
      if (!fa) throw new BadRequestException('FraudAssessment not found');
      if (fa.decision !== 'PENDING') {
        // đã quyết định trước đó → trả về hiện trạng (idempotent-ish)
        return tx.fraudAssessment.findUnique({
          where: { bookingId },
          include: {
            booking: {
              include: {
                property: true,
                customer: { select: { id: true, email: true } },
              },
            },
            reviewer: { select: { id: true, email: true } },
          },
        });
      }

      const b = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!b) throw new BadRequestException('Booking not found');
      if (b.status !== 'REVIEW') {
        throw new BadRequestException('Booking is not in REVIEW');
      }

      // 2) Cập nhật quyết định
      await tx.fraudAssessment.update({
        where: { bookingId },
        data: {
          decision,
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          reviewedNote: note ?? null,
        },
      });

      if (decision === 'APPROVED') {
        // REVIEW -> HOLD
        await tx.booking.update({
          where: { id: bookingId },
          data: { status: 'HOLD' },
        });
        await tx.outbox.create({
          data: { topic: 'booking.review_approved', payload: { bookingId } },
        });
      } else {
        // REJECTED → hủy + trả tồn kho dải ngày
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
        await tx.booking.update({
          where: { id: bookingId },
          data: { status: 'CANCELLED' },
        });
        await tx.outbox.create({
          data: { topic: 'booking.review_rejected', payload: { bookingId } },
        });
      }

      // 3) Trả về case đã cập nhật
      return tx.fraudAssessment.findUnique({
        where: { bookingId },
        include: {
          booking: {
            include: {
              property: true,
              customer: { select: { id: true, email: true } },
            },
          },
          reviewer: { select: { id: true, email: true } },
        },
      });
    });
  }

  // ---------- Rules ----------

  private async ruleNewUser(userId: string, now: Date): Promise<RuleResult> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    });
    if (!u) return { points: 0, reason: 'user_missing' };
    const days = (now.getTime() - u.createdAt.getTime()) / 86_400_000;
    return days < 3
      ? { points: 20, reason: 'new_user_lt3d' }
      : { points: 0, reason: 'user_ok' };
  }

  private async ruleManyHoldsRecently(
    userId: string,
    now: Date,
  ): Promise<RuleResult> {
    const threshold = 5;
    const since = subDays(now, 1);
    const recent = await this.prisma.booking.findMany({
      where: { customerId: userId, createdAt: { gte: since } },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: threshold,
    });
    return recent.length >= threshold
      ? { points: 25, reason: 'many_holds_24h' }
      : { points: 0, reason: 'holds_ok' };
  }

  private async ruleRecentPaymentFails(
    userId: string,
    now: Date,
  ): Promise<RuleResult> {
    const since = subDays(now, 7);
    const failed = await this.prisma.payment.findFirst({
      where: {
        status: 'FAILED',
        createdAt: { gte: since },
        booking: { customerId: userId },
      },
      select: { id: true },
    });
    return failed
      ? { points: 30, reason: 'recent_failed_pay' }
      : { points: 0, reason: 'pays_ok' };
  }

  private ruleHighAmount(amount: number): RuleResult {
    return amount >= 10_000_000
      ? { points: 10, reason: 'high_amount_10m' }
      : { points: 0, reason: 'amount_ok' };
  }
}
