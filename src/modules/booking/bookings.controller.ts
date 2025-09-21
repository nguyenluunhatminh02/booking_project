import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseBoolPipe,
  Post,
  Query,
} from '@nestjs/common';
import { IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { BookingsService } from './bookings.service';
import { PrismaService } from '../../prisma/prisma.service';

class HoldDto {
  @IsString()
  @IsNotEmpty()
  propertyId!: string;

  /** yyyy-MM-dd (khuyến nghị) hoặc chuỗi ngày hợp lệ */
  @IsString()
  @IsNotEmpty()
  checkIn!: string;

  /** yyyy-MM-dd (khuyến nghị) hoặc chuỗi ngày hợp lệ */
  @IsString()
  @IsNotEmpty()
  checkOut!: string;
}

class ReviewActionDto {
  @IsString()
  @IsNotEmpty()
  reviewerId!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

class CancelHoldDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;
}

class CancelPaidOrConfirmedDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;
}

class AttachPolicyDto {
  @IsString()
  @IsNotEmpty()
  cancelPolicyId!: string;
}

class SeedBasicDto {
  @IsString()
  @IsNotEmpty()
  hostId!: string;

  /** yyyy-MM-dd */
  @IsString()
  @IsNotEmpty()
  from!: string;

  /** số đêm cần tạo AvailabilityDay */
  @IsString()
  @IsNotEmpty()
  nights!: string;

  /** giá/đêm (VND) */
  @IsString()
  @IsNotEmpty()
  price!: string;

  /** số phòng còn lại mỗi ngày */
  @IsString()
  @IsNotEmpty()
  remaining!: string;

  @IsOptional()
  @IsString()
  title?: string;
}

class ForceStatusDto {
  @IsString()
  @IsNotEmpty()
  status!: 'HOLD' | 'REVIEW' | 'CANCELLED' | 'PAID' | 'CONFIRMED' | 'REFUNDED';

  /** ISO date string để set holdExpiresAt (tuỳ chọn) */
  @IsOptional()
  @IsISO8601()
  holdExpiresAt?: string;
}

@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly prisma: PrismaService, // dùng cho dev/seed & query phụ trợ
  ) {}

  /**
   * Tạo hold/đưa vào REVIEW (tuỳ FraudService).
   * Header bắt buộc:
   *  - X-User-Id: id người dùng
   *  - Idempotency-Key: khoá idem
   */
  @Post('hold')
  async hold(
    @Headers('x-user-id') userId: string,
    @Headers('idempotency-key') idemKey: string,
    @Body() dto: HoldDto,
  ) {
    if (!userId) throw new BadRequestException('X-User-Id header required');
    if (!idemKey)
      throw new BadRequestException('Idempotency-Key header required');

    return this.bookings.hold(
      userId,
      dto.propertyId,
      dto.checkIn,
      dto.checkOut,
      idemKey,
    );
  }

  /** Duyệt review → CONFIRMED */
  @Post(':bookingId/review/approve')
  async reviewApprove(
    @Param('bookingId') bookingId: string,
    @Body() body: ReviewActionDto,
  ) {
    return this.bookings.reviewApprove(bookingId, body.reviewerId, body.note);
  }

  /** Từ chối review → CANCELLED + trả kho */
  @Post(':bookingId/review/decline')
  async reviewDecline(
    @Param('bookingId') bookingId: string,
    @Body() body: ReviewActionDto,
  ) {
    return this.bookings.reviewDecline(bookingId, body.reviewerId, body.note);
  }

  /** Gắn chính sách huỷ */
  @Post(':bookingId/policy')
  async attachPolicy(
    @Param('bookingId') bookingId: string,
    @Body() body: AttachPolicyDto,
  ) {
    return this.bookings.attachCancelPolicy(bookingId, body.cancelPolicyId);
  }

  /** Xem trước hoàn tiền theo snapshot policy */
  @Get(':bookingId/preview-refund')
  async previewRefund(
    @Param('bookingId') bookingId: string,
    @Query('cancelAt') cancelAt: string,
  ) {
    const d = cancelAt ? new Date(cancelAt) : new Date();
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('cancelAt must be ISO date string');
    }
    return this.bookings.previewRefund(bookingId, d);
  }

  /** Hết hạn các HOLD/REVIEW (quét batch 200) */
  @Post('expire-holds')
  async expireHolds(@Query('now') now?: string) {
    const d = now ? new Date(now) : new Date();
    if (now && Number.isNaN(d.getTime())) {
      throw new BadRequestException('now must be ISO date string');
    }
    return this.bookings.expireHolds(d);
  }

  /** Khách tự huỷ HOLD/REVIEW */
  @Post(':bookingId/cancel')
  async cancelHold(
    @Param('bookingId') bookingId: string,
    @Body() body: CancelHoldDto,
  ) {
    return this.bookings.cancelHold(body.userId, bookingId);
  }

  /** Huỷ PAID/CONFIRMED → REFUNDED (mock) */
  @Post(':bookingId/cancel-paid-or-confirmed')
  async cancelPaidOrConfirmed(
    @Param('bookingId') bookingId: string,
    @Body() body: CancelPaidOrConfirmedDto,
  ) {
    return (this.bookings as any).cancelPaidOrConfirmed(body.userId, bookingId);
  }

  // ========================= DEV ENDPOINTS =========================

  /** DEV: seed property + AvailabilityDay liên tiếp */
  @Post('dev/seed-basic')
  async devSeedBasic(@Body() body: SeedBasicDto) {
    const { hostId, from, nights, price, remaining, title } = body;
    const fromDate = new Date(from);
    if (Number.isNaN(fromDate.getTime())) {
      throw new BadRequestException('from must be yyyy-MM-dd or ISO date');
    }
    const N = parseInt(nights, 10);
    const priceNum = parseInt(price, 10);
    const remainNum = parseInt(remaining, 10);
    if (!Number.isFinite(N) || N <= 0)
      throw new BadRequestException('nights > 0');
    if (!Number.isFinite(priceNum))
      throw new BadRequestException('price invalid');
    if (!Number.isFinite(remainNum))
      throw new BadRequestException('remaining invalid');

    const prop = await this.prisma.property.create({
      data: {
        hostId,
        title: title ?? 'Demo Property',
        address: 'Demo Address',
      },
    });

    // tạo N ngày liên tiếp
    for (let i = 0; i < N; i++) {
      const d = new Date(
        Date.UTC(
          fromDate.getUTCFullYear(),
          fromDate.getUTCMonth(),
          fromDate.getUTCDate() + i,
        ),
      );
      await this.prisma.availabilityDay.upsert({
        where: { propertyId_date: { propertyId: prop.id, date: d } },
        create: {
          propertyId: prop.id,
          date: d,
          price: priceNum,
          remaining: remainNum,
          isBlocked: false,
        },
        update: {},
      });
    }

    const days = await this.prisma.availabilityDay.findMany({
      where: { propertyId: prop.id },
      orderBy: { date: 'asc' },
    });

    return { property: prop, days };
  }

  /** DEV: xem availability trong khoảng */
  @Get('dev/availability')
  async devAvailability(
    @Query('propertyId') propertyId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!propertyId) throw new BadRequestException('propertyId required');
    const fromD = new Date(from);
    const toD = new Date(to);
    if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
      throw new BadRequestException('from/to must be ISO date');
    }
    return this.prisma.availabilityDay.findMany({
      where: { propertyId, date: { gte: fromD, lt: toD } },
      orderBy: { date: 'asc' },
    });
  }

  /** DEV: ép trạng thái booking, tuỳ chọn set holdExpiresAt (để test expire) */
  @Post('dev/force-status/:bookingId')
  async devForceStatus(
    @Param('bookingId') bookingId: string,
    @Body() body: ForceStatusDto,
  ) {
    const data: any = { status: body.status };
    if (body.holdExpiresAt) data.holdExpiresAt = new Date(body.holdExpiresAt);
    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data,
    });
    return updated;
  }
}
