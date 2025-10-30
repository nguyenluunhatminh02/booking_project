// test/mocks-prisma-promotion.ts
import { BadRequestException } from '@nestjs/common';

// ----- Helpers -----
export function testDay(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

// ----- Domain Types (tối giản để test) -----
type PromotionTypeLite = 'PERCENT' | 'FIXED';
type RedemptionStatusLite = 'RESERVED' | 'APPLIED' | 'RELEASED';
type BookingStatusLite =
  | 'HOLD'
  | 'REVIEW'
  | 'CONFIRMED'
  | 'PAID'
  | 'CANCELLED'
  | 'REFUNDED';

type Promotion = {
  id: string;
  code: string;
  type: PromotionTypeLite;
  value: number;
  validFrom: Date | null;
  validTo: Date | null;
  minNights: number | null;
  minTotal: number | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type Booking = {
  id: string;
  customerId: string;
  propertyId?: string | null;
  checkIn: Date;
  checkOut: Date;
  status: BookingStatusLite;
  totalPrice: number;
  promoCode: string | null;
  discountAmount: number;
  appliedPromotionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type Redemption = {
  id: string;
  promotionId: string;
  bookingId: string;
  userId: string;
  code: string;
  amount: number;
  status: RedemptionStatusLite;
  createdAt: Date;
  updatedAt: Date;
};

export class MockPrismaPromotion {
  private _seq = 1;
  private nextId(prefix = 'id') {
    return `${prefix}_${this._seq++}`;
  }

  // In-memory stores
  public promotions: Promotion[] = [];
  public bookings: Booking[] = [];
  public redemptions: Redemption[] = [];

  private clone<T>(x: T): T {
    return x == null ? (x as any) : JSON.parse(JSON.stringify(x));
  }

  // ---------- $transaction / $queryRaw / $executeRawUnsafe ----------
  $transaction = async <T>(arg: any): Promise<T> => {
    if (typeof arg === 'function') return await arg(this);
    if (Array.isArray(arg)) return (await Promise.all(arg)) as unknown as T;
    return arg as T;
  };

  // No-op; service có thể gọi lock: SELECT ... FOR UPDATE
  $queryRaw = async (_strings: TemplateStringsArray, ..._params: any[]) => {
    return [];
  };

  // No-op; service có thể gọi advisory lock: $executeRawUnsafe('SELECT pg_advisory_xact_lock...')
  $executeRawUnsafe = async (..._args: any[]) => {
    return 1;
  };

  // ---------- promotion ----------
  promotion = {
    create: async ({
      data,
    }: {
      data: Partial<Promotion> & {
        code: string;
        type: PromotionTypeLite;
        value: number;
        isActive?: boolean | null;
        validFrom?: Date | null;
        validTo?: Date | null;
        minNights?: number | null;
        minTotal?: number | null;
        usageLimit?: number | null;
      };
    }) => {
      const row: Promotion = {
        id: data.id ?? this.nextId('promo'),
        code: data.code,
        type: data.type,
        value: data.value,
        validFrom: data.validFrom ?? null,
        validTo: data.validTo ?? null,
        minNights: data.minNights ?? null,
        minTotal: data.minTotal ?? null,
        usageLimit: data.usageLimit ?? null,
        usedCount: 0,
        isActive: data.isActive ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.promotions.push(row);
      return this.clone(row);
    },

    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<Promotion>;
    }) => {
      const row = this.promotions.find((p) => p.id === where.id);
      if (!row) throw new BadRequestException('Promotion not found');
      if (data.code !== undefined) row.code = data.code as any;
      if (data.type !== undefined) row.type = data.type as any;
      if (data.value !== undefined) row.value = data.value as any;
      if ('validFrom' in data) row.validFrom = (data as any).validFrom ?? null;
      if ('validTo' in data) row.validTo = (data as any).validTo ?? null;
      if ('minNights' in data) row.minNights = (data as any).minNights ?? null;
      if ('minTotal' in data) row.minTotal = (data as any).minTotal ?? null;
      if ('usageLimit' in data)
        row.usageLimit = (data as any).usageLimit ?? null;
      if ('isActive' in data)
        row.isActive = (data as any).isActive ?? row.isActive;
      // usedCount increment/decrement
      if ((data as any).usedCount?.increment != null) {
        row.usedCount += (data as any).usedCount.increment;
      }
      if ((data as any).usedCount?.decrement != null) {
        row.usedCount = Math.max(
          0,
          row.usedCount - (data as any).usedCount.decrement,
        );
      }
      row.updatedAt = new Date();
      return this.clone(row);
    },

    findMany: async ({
      orderBy,
    }: {
      orderBy?: { createdAt?: 'asc' | 'desc' };
    }) => {
      const res = this.promotions.slice();
      if (orderBy?.createdAt === 'desc') {
        res.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      } else if (orderBy?.createdAt === 'asc') {
        res.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }
      return this.clone(res);
    },

    findUnique: async ({
      where,
    }: {
      where: { id?: string; code?: string };
    }) => {
      let row: Promotion | undefined;
      if (where.id) row = this.promotions.find((p) => p.id === where.id);
      if (!row && where.code)
        row = this.promotions.find((p) => p.code === where.code);
      return this.clone(row as any);
    },

    // confirmOnPaid dùng updateMany để CAS usedCount < usageLimit
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; usedCount?: { lt?: number } };
      data: { usedCount?: { increment?: number; decrement?: number } };
    }) => {
      let targets = this.promotions.filter((p) => p.id === where.id);
      if (where.usedCount?.lt != null) {
        targets = targets.filter(
          (p) => p.usedCount < (where.usedCount!.lt as number),
        );
      }
      for (const p of targets) {
        if (data.usedCount?.increment != null) {
          p.usedCount += data.usedCount.increment;
        }
        if (data.usedCount?.decrement != null) {
          p.usedCount = Math.max(0, p.usedCount - data.usedCount.decrement);
        }
        p.updatedAt = new Date();
      }
      return { count: targets.length };
    },
  };

  // ---------- booking ----------
  booking = {
    create: async ({
      data,
    }: {
      data: Partial<Booking> & {
        customerId: string;
        checkIn: Date;
        checkOut: Date;
        totalPrice: number;
        status?: BookingStatusLite;
      };
    }) => {
      const row: Booking = {
        id: (data as any).id ?? this.nextId('bk'),
        customerId: data.customerId,
        propertyId: (data as any).propertyId ?? null,
        checkIn: new Date(data.checkIn),
        checkOut: new Date(data.checkOut),
        status: data.status ?? 'HOLD',
        totalPrice: data.totalPrice,
        promoCode: data.promoCode ?? null,
        discountAmount: data.discountAmount ?? 0,
        appliedPromotionId: (data as any).appliedPromotionId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.bookings.push(row);
      return this.clone(row);
    },

    findUnique: async ({ where: { id } }: { where: { id: string } }) => {
      const row = this.bookings.find((b) => b.id === id);
      return this.clone(row as any);
    },

    update: async ({
      where: { id },
      data,
    }: {
      where: { id: string };
      data: Partial<Booking>;
    }) => {
      const row = this.bookings.find((b) => b.id === id);
      if (!row) throw new BadRequestException('Booking not found');

      if ('promoCode' in data) row.promoCode = (data as any).promoCode ?? null;
      if ('discountAmount' in data)
        row.discountAmount = (data as any).discountAmount ?? 0;
      if ('appliedPromotionId' in data)
        row.appliedPromotionId = (data as any).appliedPromotionId ?? null;
      if ('status' in data && data.status) row.status = data.status;

      row.updatedAt = new Date();
      return this.clone(row);
    },
  };

  // ---------- promotionRedemption ----------
  promotionRedemption = {
    // Hỗ trợ include: { promotion: true, booking: true }
    findUnique: async ({
      where: { bookingId },
      include,
    }: {
      where: { bookingId: string };
      include?: { promotion?: boolean; booking?: boolean };
    }) => {
      const row = this.redemptions.find((r) => r.bookingId === bookingId);
      if (!row) return this.clone(row as any);
      const ret: any = { ...row };
      if (include?.promotion) {
        ret.promotion =
          this.promotions.find((p) => p.id === row.promotionId) || null;
      }
      if (include?.booking) {
        ret.booking = this.bookings.find((b) => b.id === row.bookingId) || null;
      }
      return this.clone(ret);
    },

    create: async ({
      data,
    }: {
      data: {
        promotionId: string;
        bookingId: string;
        userId: string;
        code: string;
        amount: number;
        status: RedemptionStatusLite;
      };
    }) => {
      if (this.redemptions.some((r) => r.bookingId === data.bookingId)) {
        throw new BadRequestException('Redemption exists for booking');
      }
      const row: Redemption = {
        id: this.nextId('red'),
        promotionId: data.promotionId,
        bookingId: data.bookingId,
        userId: data.userId,
        code: data.code,
        amount: data.amount,
        status: data.status,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.redemptions.push(row);
      return this.clone(row);
    },

    update: async ({
      where: { bookingId },
      data,
    }: {
      where: { bookingId: string };
      data: Partial<Redemption>;
    }) => {
      const row = this.redemptions.find((r) => r.bookingId === bookingId);
      if (!row) throw new BadRequestException('Redemption not found');
      if ('status' in data && data.status) row.status = data.status;
      row.updatedAt = new Date();
      return this.clone(row);
    },
  };
}
