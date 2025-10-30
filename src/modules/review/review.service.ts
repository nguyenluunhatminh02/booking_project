import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReviewStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { OutboxProducer } from '../outbox/outbox.producer';
import { ContentModerationService } from './content-moderation.service';

type Tx = Prisma.TransactionClient;

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idem: IdempotencyService,
    private readonly outbox: OutboxProducer,
    private readonly moderation: ContentModerationService,
  ) {}

  /** Guard: đúng booking của user & đã check-out */
  private async assertBookingUsable(tx: Tx, bookingId: string, userId: string) {
    const b = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        propertyId: true,
        customerId: true,
        checkOut: true,
        status: true,
      },
    });
    if (!b) throw new NotFoundException('Booking not found');
    if (b.customerId !== userId) {
      throw new ForbiddenException('Not your booking');
    }

    // Chỉ cho review sau check-out
    const now = new Date();
    if (b.checkOut > now) {
      throw new BadRequestException('Review only after check-out');
    }

    // (tuỳ chọn) Yêu cầu booking đã PAID/CONFIRMED/REFUNDED
    const okStatuses = new Set(['PAID', 'CONFIRMED', 'REFUNDED']);
    if (b.status && !okStatuses.has(b.status as any)) {
      // Nếu bạn không muốn hạn chế theo status thì có thể bỏ khối này
      // throw new BadRequestException('Booking not eligible for review');
    }

    return b;
  }

  /** Tính lại aggregate rating cho Property (an toàn khi concurrent) */
  private async recalcPropertyAggregates(tx: Tx, propertyId: string) {
    const agg = await tx.review.aggregate({
      where: { propertyId, status: ReviewStatus.ACTIVE },
      _count: { id: true },
      _avg: { rating: true },
    });
    const count = agg._count.id ?? 0;
    const avg = agg._avg.rating ?? 0;
    await tx.property.update({
      where: { id: propertyId },
      data: {
        ratingCount: count,
        ratingAvg: count > 0 ? avg : 0,
        ratingUpdatedAt: new Date(),
      },
    });
  }

  /** Create (idempotent nếu có Idempotency-Key) */
  async create(userId: string, dto: CreateReviewDto, idemKey?: string) {
    // Chặn rating ngoài biên trong trường hợp DTO không validate
    if (dto.rating < 1 || dto.rating > 5) {
      throw new BadRequestException('rating must be 1..5');
    }

    const run = async (tx: Tx) => {
      const booking = await this.assertBookingUsable(tx, dto.bookingId, userId);

      // 1 booking = 1 review
      const existed = await tx.review.findUnique({
        where: { bookingId: dto.bookingId },
      });
      if (existed && existed.status !== ReviewStatus.DELETED) {
        throw new ConflictException('Review already exists for this booking');
      }

      const safeBody = dto.body
        ? this.moderation.processOrThrow(dto.body).body
        : null;

      let reviewId: string;
      if (existed && existed.status === ReviewStatus.DELETED) {
        // Revive row cũ để giữ unique bookingId
        const revived = await tx.review.update({
          where: { id: existed.id },
          data: {
            rating: dto.rating,
            body: safeBody,
            status: ReviewStatus.ACTIVE,
            authorId: userId,
            propertyId: booking.propertyId,
          },
        });
        reviewId = revived.id;
      } else {
        const created = await tx.review.create({
          data: {
            bookingId: booking.id,
            propertyId: booking.propertyId,
            authorId: userId,
            rating: dto.rating,
            body: safeBody,
            status: ReviewStatus.ACTIVE,
          },
        });
        reviewId = created.id;
      }

      await this.recalcPropertyAggregates(tx, booking.propertyId);

      await this.outbox.emitInTx(tx, 'review.created', reviewId, {
        reviewId,
        bookingId: booking.id,
        propertyId: booking.propertyId,
        authorId: userId,
        rating: dto.rating,
      });

      return {
        id: reviewId,
        propertyId: booking.propertyId,
        rating: dto.rating,
        body: safeBody,
      };
    };

    if (idemKey) {
      const gate = await this.idem.beginOrReuse({
        userId,
        endpoint: 'POST /reviews',
        key: idemKey,
        payloadForHash: {
          bookingId: dto.bookingId,
          rating: dto.rating,
          body: dto.body ?? null,
        },
        ttlMs: 10 * 60 * 1000,
      });
      if (gate.mode === 'REUSE') return gate.response;
      if (gate.mode === 'IN_PROGRESS') {
        throw new ConflictException('Request in progress');
      }
      const idemId = (gate as any).id;
      try {
        const res = await this.prisma.$transaction((tx) => run(tx));
        await this.idem.completeOK(idemId, res, String((res as any).id));
        return res;
      } catch (e: any) {
        await this.idem.completeFailed(idemId, {
          message: e?.message ?? 'unknown',
        });
        throw e;
      }
    }

    return this.prisma.$transaction((tx) => run(tx));
  }

  /** List theo property – chỉ ACTIVE, keyset đơn giản theo id */
  async listByProperty(propertyId: string, cursor?: string, limit = 20) {
    const where: Prisma.ReviewWhereInput = {
      propertyId,
      status: ReviewStatus.ACTIVE,
    };
    const take = Math.min(Math.max(limit, 1), 100);

    const items = await this.prisma.review.findMany({
      where,
      orderBy: { id: 'asc' }, // gọn, ổn định
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      take: take + 1,
      include: {
        // Hạn chế PII: chỉ trả về id tác giả (nếu FE không cần email)
        author: { select: { id: true } },
      },
    });

    const hasMore = items.length > take;
    const data = hasMore ? items.slice(0, take) : items;
    const nextCursor = hasMore ? data[data.length - 1].id : null;
    return { data, nextCursor, hasMore };
  }

  /** Update (author-only) */
  async update(
    userId: string,
    id: string,
    dto: UpdateReviewDto,
    idemKey?: string,
  ) {
    const target = await this.prisma.review.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Review not found');
    if (target.authorId !== userId) {
      throw new ForbiddenException('Not your review');
    }
    if (target.status === ReviewStatus.DELETED) {
      throw new BadRequestException('Review is deleted');
    }
    if (dto.rating != null && (dto.rating < 1 || dto.rating > 5)) {
      throw new BadRequestException('rating must be 1..5');
    }

    const run = async (tx: Tx) => {
      const prev = await tx.review.findUnique({ where: { id } });
      if (!prev) throw new NotFoundException('Review not found');

      const newRating = dto.rating ?? prev.rating;
      const newBody = dto.body ?? prev.body ?? null;
      const safeBody = newBody
        ? this.moderation.processOrThrow(newBody).body
        : null;

      const updated = await tx.review.update({
        where: { id },
        data: { rating: newRating, body: safeBody },
      });

      if (newRating !== prev.rating) {
        await this.recalcPropertyAggregates(tx, prev.propertyId);
      }

      await this.outbox.emitInTx(tx, 'review.updated', updated.id, {
        reviewId: updated.id,
        propertyId: updated.propertyId,
        rating: updated.rating,
      });

      return updated;
    };

    if (idemKey) {
      const gate = await this.idem.beginOrReuse({
        userId,
        endpoint: 'PATCH /reviews/:id',
        key: idemKey,
        payloadForHash: {
          id,
          rating: dto.rating ?? null,
          body: dto.body ?? null,
        },
        ttlMs: 10 * 60 * 1000,
      });
      if (gate.mode === 'REUSE') return gate.response;
      if (gate.mode === 'IN_PROGRESS') {
        throw new ConflictException('Request in progress');
      }
      const idemId = (gate as any).id;
      try {
        const res = await this.prisma.$transaction((tx) => run(tx));
        await this.idem.completeOK(idemId, res, id);
        return res;
      } catch (e: any) {
        await this.idem.completeFailed(idemId, {
          message: e?.message ?? 'unknown',
        });
        throw e;
      }
    }

    return this.prisma.$transaction((tx) => run(tx));
  }

  /** Soft delete (author-only) */
  async remove(userId: string, id: string, idemKey?: string) {
    const target = await this.prisma.review.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Review not found');
    if (target.authorId !== userId) {
      throw new ForbiddenException('Not your review');
    }
    if (target.status === ReviewStatus.DELETED) {
      return { ok: true };
    }

    const run = async (tx: Tx) => {
      const prev = await tx.review.update({
        where: { id },
        data: { status: ReviewStatus.DELETED },
      });

      await this.recalcPropertyAggregates(tx, prev.propertyId);

      await this.outbox.emitInTx(tx, 'review.deleted', prev.id, {
        reviewId: prev.id,
        propertyId: prev.propertyId,
      });

      return { ok: true };
    };

    if (idemKey) {
      const gate = await this.idem.beginOrReuse({
        userId,
        endpoint: 'DELETE /reviews/:id',
        key: idemKey,
        payloadForHash: { id },
        ttlMs: 10 * 60 * 1000,
      });
      if (gate.mode === 'REUSE') return gate.response;
      if (gate.mode === 'IN_PROGRESS') {
        throw new ConflictException('Request in progress');
      }
      const idemId = (gate as any).id;
      try {
        const res = await this.prisma.$transaction((tx) => run(tx));
        await this.idem.completeOK(idemId, res, id);
        return res;
      } catch (e: any) {
        await this.idem.completeFailed(idemId, {
          message: e?.message ?? 'unknown',
        });
        throw e;
      }
    }

    return this.prisma.$transaction((tx) => run(tx));
  }
}
