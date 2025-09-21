import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PromotionType, RedemptionStatus } from '@prisma/client';
import { differenceInCalendarDays, isAfter, isBefore } from 'date-fns';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PromotionService {
  constructor(private prisma: PrismaService) {}

  // =============== Admin CRUD ===============
  async create(dto: {
    code: string;
    type: PromotionType;
    value: number;
    validFrom?: string | null;
    validTo?: string | null;
    minNights?: number | null;
    minTotal?: number | null;
    usageLimit?: number | null;
    isActive?: boolean | null;
  }) {
    if (dto.type === 'PERCENT' && (dto.value < 1 || dto.value > 100)) {
      throw new BadRequestException('value percent phải 1..100');
    }
    const validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    const validTo = dto.validTo ? new Date(dto.validTo) : null;

    return this.prisma.promotion.create({
      data: {
        code: dto.code,
        type: dto.type,
        value: dto.value,
        validFrom,
        validTo,
        minNights: dto.minNights ?? null,
        minTotal: dto.minTotal ?? null,
        usageLimit: dto.usageLimit ?? null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(
    id: string,
    dto: Partial<{
      code: string;
      type: PromotionType;
      value: number;
      validFrom?: string | null;
      validTo?: string | null;
      minNights?: number | null;
      minTotal?: number | null;
      usageLimit?: number | null;
      isActive?: boolean | null;
    }>,
  ) {
    if (
      dto.type === 'PERCENT' &&
      dto.value != null &&
      (dto.value < 1 || dto.value > 100)
    ) {
      throw new BadRequestException('value percent phải 1..100');
    }

    const data: any = { ...dto };
    if ('validFrom' in dto)
      data.validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    if ('validTo' in dto)
      data.validTo = dto.validTo ? new Date(dto.validTo) : null;

    return this.prisma.promotion.update({
      where: { id },
      data,
    });
  }

  async findAll() {
    return this.prisma.promotion.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    const p = await this.prisma.promotion.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Promotion not found');
    return p;
  }

  async byCode(code: string) {
    return this.prisma.promotion.findUnique({ where: { code } });
  }

  // =============== Preview (no side effects) ===============
  async preview(input: { bookingId: string; code: string }) {
    const { bookingId, code } = input;

    const [b, p] = await Promise.all([
      this.prisma.booking.findUnique({ where: { id: bookingId } }),
      this.prisma.promotion.findUnique({ where: { code } }),
    ]);
    if (!b) throw new NotFoundException('Booking not found');
    if (!p || !p.isActive) throw new BadRequestException('Mã không hợp lệ');

    const now = new Date();
    if (p.validFrom && isBefore(now, p.validFrom))
      throw new BadRequestException('Mã chưa hiệu lực');
    if (p.validTo && isAfter(now, p.validTo))
      throw new BadRequestException('Mã đã hết hạn');

    const nights = Math.max(1, differenceInCalendarDays(b.checkOut, b.checkIn));
    if (p.minNights && nights < p.minNights)
      throw new BadRequestException('Chưa đạt số đêm tối thiểu');
    if (p.minTotal && b.totalPrice < p.minTotal)
      throw new BadRequestException('Chưa đạt giá trị tối thiểu');

    let discount =
      p.type === 'PERCENT'
        ? Math.floor((b.totalPrice * p.value) / 100)
        : p.value;
    if (discount > b.totalPrice) discount = b.totalPrice;

    return { discount, finalPrice: b.totalPrice - discount, nights };
  }

  // =============== Apply / Confirm / Release ===============

  /**
   * Áp mã khi HOLD/REVIEW:
   * - Lock row promotion theo code (FOR UPDATE)
   * - Validate hiệu lực + min rules + owner + status
   * - Tạo redemption(RESERVED) + set discount vào booking
   */
  async applyOnHold(input: {
    bookingId: string;
    userId: string;
    code: string;
  }) {
    const { bookingId, userId, code } = input;

    return this.prisma.$transaction(async (tx) => {
      // Row-level lock (tránh race trên cùng code/rule)
      await tx.$queryRaw`SELECT id FROM "Promotion" WHERE code = ${code} FOR UPDATE`;

      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          customerId: true,
          checkIn: true,
          checkOut: true,
          totalPrice: true,
          promoCode: true,
          status: true,
        },
      });
      if (!booking) throw new NotFoundException('Booking not found');
      if (booking.customerId !== userId)
        throw new BadRequestException('Not booking owner');
      if (!['HOLD', 'REVIEW'].includes(booking.status as any))
        throw new BadRequestException('Booking not in HOLD/REVIEW');
      if (booking.promoCode)
        throw new BadRequestException('Booking đã áp promotion');

      const p = await tx.promotion.findUnique({ where: { code } });
      if (!p || !p.isActive) throw new BadRequestException('Mã không hợp lệ');

      const now = new Date();
      if (p.validFrom && isBefore(now, p.validFrom))
        throw new BadRequestException('Mã chưa hiệu lực');
      if (p.validTo && isAfter(now, p.validTo))
        throw new BadRequestException('Mã đã hết hạn');

      const nights = Math.max(
        1,
        differenceInCalendarDays(booking.checkOut, booking.checkIn),
      );
      if (p.minNights && nights < p.minNights)
        throw new BadRequestException('Chưa đạt số đêm tối thiểu');
      if (p.minTotal && booking.totalPrice < p.minTotal)
        throw new BadRequestException('Chưa đạt giá trị tối thiểu');

      let discount =
        p.type === 'PERCENT'
          ? Math.floor((booking.totalPrice * p.value) / 100)
          : p.value;
      if (discount > booking.totalPrice) discount = booking.totalPrice;

      const existed = await tx.promotionRedemption.findUnique({
        where: { bookingId },
      });
      if (existed) throw new BadRequestException('Booking đã có promotion');

      await tx.promotionRedemption.create({
        data: {
          promotionId: p.id,
          bookingId,
          userId,
          code: p.code,
          amount: discount,
          status: RedemptionStatus.RESERVED,
        },
      });

      await tx.booking.update({
        where: { id: bookingId },
        data: {
          promoCode: p.code,
          discountAmount: discount,
          appliedPromotionId: p.id,
        },
      });

      return { discount, finalPrice: booking.totalPrice - discount, nights };
    });
  }

  /**
   * Khi thanh toán thành công:
   * - Lock row promotion theo id
   * - CAS: tăng usedCount chỉ khi còn slot (usageLimit)
   * - Đặt redemption → APPLIED; nếu hết slot thì RELEASED
   */
  async confirmOnPaid(bookingId: string) {
    return this.prisma.$transaction(async (tx) => {
      const red = await tx.promotionRedemption.findUnique({
        where: { bookingId },
        include: {
          promotion: { select: { id: true, code: true, usageLimit: true } },
        },
      });
      if (!red || red.status !== RedemptionStatus.RESERVED) {
        return { skipped: true };
      }

      // Lock promotion row
      await tx.$queryRaw`SELECT id FROM "Promotion" WHERE id = ${red.promotion.id} FOR UPDATE`;

      if (red.promotion.usageLimit != null) {
        const ok = await tx.promotion.updateMany({
          where: {
            id: red.promotion.id,
            usedCount: { lt: red.promotion.usageLimit },
          },
          data: { usedCount: { increment: 1 } },
        });
        if (ok.count !== 1) {
          await tx.promotionRedemption.update({
            where: { bookingId },
            data: { status: RedemptionStatus.RELEASED },
          });
          return { status: 'RELEASED', reason: 'EXHAUSTED' as const };
        }
      } else {
        await tx.promotion.update({
          where: { id: red.promotion.id },
          data: { usedCount: { increment: 1 } },
        });
      }

      await tx.promotionRedemption.update({
        where: { bookingId },
        data: { status: RedemptionStatus.APPLIED },
      });

      return { status: 'APPLIED' as const };
    });
  }

  /**
   * Khi booking CANCELLED/EXPIRED/REFUNDED → RELEASED
   * - decreaseUsage=true hoặc cause='REFUNDED' → nếu trước đó APPLIED thì giảm usedCount
   */
  async releaseOnCancelOrExpire(
    bookingId: string,
    decreaseUsage = false,
    cause?: 'CANCELLED' | 'EXPIRED' | 'REFUNDED',
  ) {
    return this.prisma.$transaction(async (tx) => {
      const red = await tx.promotionRedemption.findUnique({
        where: { bookingId },
      });
      if (!red || red.status === RedemptionStatus.RELEASED) {
        return { released: false };
      }

      const shouldDecrease = decreaseUsage || cause === 'REFUNDED';

      await tx.promotionRedemption.update({
        where: { bookingId },
        data: { status: RedemptionStatus.RELEASED },
      });

      if (shouldDecrease && red.status === RedemptionStatus.APPLIED) {
        await tx.promotion.update({
          where: { id: red.promotionId },
          data: { usedCount: { decrement: 1 } },
        });
      }

      await tx.booking.update({
        where: { id: bookingId },
        data: { promoCode: null, discountAmount: 0, appliedPromotionId: null },
      });

      return {
        released: true,
        decreasedUsage:
          shouldDecrease && red.status === RedemptionStatus.APPLIED,
        cause: cause ?? null,
      };
    });
  }
}
