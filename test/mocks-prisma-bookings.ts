import { BadRequestException } from '@nestjs/common';

type AvailabilityDay = {
  id: string;
  propertyId: string;
  date: Date;
  price: number;
  remaining: number;
  isBlocked: boolean;
};

function key(propertyId: string, d: Date) {
  const dd = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  return `${propertyId}|${dd.toISOString()}`;
}

export class MockPrismaBookings {
  private _idSeq = 1;
  private nextId(p = 'id') {
    return `${p}_${this._idSeq++}`;
  }

  public properties: any[] = [];
  public availability = new Map<string, AvailabilityDay>();
  public bookings: any[] = [];
  public payments: any[] = [];
  public refunds: any[] = [];
  public fraudAssessments: any[] = [];
  public cancelPolicies: any[] = [];
  public outboxEvents: Array<{ topic: string; payload: any; createdAt: Date }> =
    [];

  private clone<T>(x: T): T {
    return x == null ? (x as any) : JSON.parse(JSON.stringify(x));
  }
  public getOutbox() {
    return this.outboxEvents.map((e) => ({
      topic: e.topic,
      payload: this.clone(e.payload),
    }));
  }

  // Helper: tìm record tồn kho theo id (duyệt Map)
  private findAvailabilityById(id: string): AvailabilityDay | undefined {
    for (const v of this.availability.values()) if (v.id === id) return v;
    return undefined;
  }

  // ───────────────────────── $transaction ─────────────────────────
  $transaction = async <T>(arg: any): Promise<T> => {
    if (Array.isArray(arg)) {
      const results = await Promise.all(arg);
      return results as unknown as T;
    }
    if (typeof arg === 'function') {
      // tx chính là "this" để test có thể gọi tx.$executeRaw ...
      return await arg(this);
    }
    return arg as T;
  };

  // ───────────────────────── $queryRaw (template tag) ─────────────────────────
  // Chỉ cần cho AvailabilityDay range; FOR UPDATE bị bỏ qua (không cần cho mock)
  $queryRaw = async (strings: TemplateStringsArray, ...params: any[]) => {
    // Với các query kiểu:
    // SELECT * FROM "AvailabilityDay"
    // WHERE "propertyId" = ${propertyId}
    //   AND "date" >= ${from}
    //   AND "date" <  ${to}
    // ORDER BY "date" ASC
    // FOR UPDATE
    const [propertyId, from, to] = params;
    const fromD = new Date(from);
    const toD = new Date(to);
    const res = [...this.availability.values()]
      .filter(
        (d) => d.propertyId === propertyId && d.date >= fromD && d.date < toD,
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    return this.clone(res);
  };

  // ───────────────────────── $executeRaw / $executeRawUnsafe ─────────────────────────
  // Hỗ trợ cả template-tag lẫn string. Bắt mọi biến thể spacing/casing, kể cả LEAST(...).
  $executeRaw = async (queryOrTpl: any, ...vals: any[]) => {
    const toSql = (q: any) =>
      typeof q === 'string' ? q : Array.isArray(q) ? q.join('') : String(q);

    const sqlRaw = toSql(queryOrTpl);
    const sql = sqlRaw.replace(/\s+/g, ' ').trim().toLowerCase();

    // id được bind qua ${...} (trong service là ${a.id})
    // Với template tag, id sẽ ở vals[0]; với string + params (unsafe), cũng là vals[0].
    const id = vals?.[0];

    // Chỉ quan tâm UPDATE ... AvailabilityDay ... SET ... remaining ...
    const isUpdateAvailability =
      /update\s+["']?availabilityday["']?/.test(sql) &&
      /\sset\s+/.test(sql) &&
      /remaining/.test(sql);

    if (!isUpdateAvailability) {
      // Không phải câu ta cần mô phỏng → coi như 1 row OK
      return 1;
    }

    // Nhận diện cộng kho: có dấu + 1 ở vế SET (bao gồm cả LEAST(... + 1, ...))
    const isIncrement = /set[^;]*remaining[^;]*\+[^;]*1/.test(sql);
    // Nhận diện trừ kho: có dấu - 1 ở vế SET
    const isDecrement = /set[^;]*remaining[^;]*-[^;]*1/.test(sql);

    if (isIncrement) {
      // Trả kho: +1 theo id
      const ret = await this.availabilityDay.updateMany({
        where: { id },
        data: { remaining: { increment: 1 } },
      });
      return ret.count; // 0 hoặc 1
    }

    if (isDecrement) {
      // Trừ kho: chỉ khi >0 & !isBlocked
      const row = this.findAvailabilityById(id);
      if (!row || row.isBlocked || row.remaining <= 0) return 0;
      const ret = await this.availabilityDay.updateMany({
        where: { id },
        data: { remaining: { decrement: 1 } },
      });
      return ret.count;
    }

    // Mặc định: OK
    return 1;
  };

  $executeRawUnsafe = this.$executeRaw;

  // ───────────────────────── Property ─────────────────────────
  property = {
    create: async ({ data }: any) => {
      const row = {
        id: this.nextId('prop'),
        hostId: data.hostId,
        title: data.title,
        address: data.address,
        description: data.description ?? null,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        amenities: data.amenities ?? {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.properties.push(row);
      return this.clone(row);
    },
    findUnique: async ({ where: { id } }: any) => {
      const row = this.properties.find((p) => p.id === id);
      return this.clone(row);
    },
  };

  // ───────────────────────── AvailabilityDay ─────────────────────────
  availabilityDay = {
    upsert: async ({ where, create, update }: any) => {
      let row: AvailabilityDay | undefined;
      if (where?.propertyId_date) {
        const { propertyId, date } = where.propertyId_date;
        const k = key(propertyId, new Date(date));
        row = this.availability.get(k);
        if (!row) {
          if (create.price == null)
            throw new BadRequestException('price required on create');
          row = {
            id: this.nextId('ad'),
            propertyId: create.propertyId,
            date: new Date(create.date),
            price: create.price,
            remaining: create.remaining ?? 0,
            isBlocked: !!create.isBlocked,
          };
          this.availability.set(k, row);
        } else {
          if (update.price !== undefined) row.price = update.price;
          if (update.remaining !== undefined) row.remaining = update.remaining;
          if (update.isBlocked !== undefined) row.isBlocked = update.isBlocked;
          this.availability.set(k, row);
        }
      }
      return this.clone(row!);
    },

    findMany: async ({ where, orderBy }: any) => {
      let res = [...this.availability.values()];

      // BỔ SUNG: filter theo id
      if (where?.id) {
        res = res.filter((d) => d.id === where.id);
      }

      if (where?.propertyId)
        res = res.filter((d) => d.propertyId === where.propertyId);

      if (where?.date) {
        const gte = where.date?.gte != null ? new Date(where.date.gte) : null;
        const lt = where.date?.lt != null ? new Date(where.date.lt) : null;
        const eq =
          where.date?.equals != null
            ? new Date(where.date.equals)
            : where.date instanceof Date
              ? where.date
              : null;

        if (eq) {
          res = res.filter((d) => d.date.getTime() === eq.getTime());
        } else {
          if (gte) res = res.filter((d) => d.date >= gte);
          if (lt) res = res.filter((d) => d.date < lt);
        }
      }

      if (orderBy?.date === 'asc')
        res.sort((a, b) => a.date.getTime() - b.date.getTime());
      if (orderBy?.date === 'desc')
        res.sort((a, b) => b.date.getTime() - a.date.getTime());

      return this.clone(res);
    },

    updateMany: async ({ where, data }: any) => {
      let matches: AvailabilityDay[] = [];

      if (where?.id) {
        matches = [...this.availability.values()].filter(
          (d) => d.id === where.id,
        );
      } else if (where?.propertyId && where?.date) {
        // hỗ trợ Date hoặc { equals: Date }
        const dateVal =
          where.date instanceof Date
            ? where.date
            : (where.date?.equals ?? where.date);
        const k = key(where.propertyId, new Date(dateVal));
        const row = this.availability.get(k);
        if (row) matches = [row];
      }

      if (where?.isBlocked !== undefined) {
        matches = matches.filter((m) => m.isBlocked === where.isBlocked);
      }
      if (where?.remaining?.gt !== undefined) {
        matches = matches.filter((m) => m.remaining > where.remaining.gt);
      }
      if (!matches.length) return { count: 0 };

      for (const m of matches) {
        if (data?.remaining?.decrement !== undefined) {
          m.remaining = Math.max(0, m.remaining - data.remaining.decrement);
        } else if (data?.remaining?.increment !== undefined) {
          m.remaining += data.remaining.increment;
        } else if (typeof data?.remaining === 'number') {
          m.remaining = data.remaining;
        }
        if (typeof data?.isBlocked === 'boolean') m.isBlocked = data.isBlocked;
        if (typeof data?.price === 'number') m.price = data.price;

        this.availability.set(key(m.propertyId, m.date), m);
      }

      return { count: matches.length };
    },
  };

  // ───────────────────────── Booking ─────────────────────────
  booking = {
    create: async ({ data }: any) => {
      const row = {
        id: this.nextId('bk'),
        propertyId: data.propertyId,
        customerId: data.customerId,
        checkIn: new Date(data.checkIn),
        checkOut: new Date(data.checkOut),
        status: data.status ?? 'HOLD',
        totalPrice: data.totalPrice ?? 0,
        promoCode: data.promoCode ?? null,
        holdExpiresAt: data.holdExpiresAt ? new Date(data.holdExpiresAt) : null,
        discountAmount: data.discountAmount ?? 0,
        appliedPromotionId: data.appliedPromotionId ?? null,
        cancelPolicyId: data.cancelPolicyId ?? null,
        cancelPolicySnapshot: data.cancelPolicySnapshot ?? null,
        reviewDeadlineAt: data.reviewDeadlineAt
          ? new Date(data.reviewDeadlineAt)
          : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.bookings.push(row);
      return this.clone(row);
    },

    findUnique: async ({ where: { id } }: any) => {
      const row = this.bookings.find((b) => b.id === id);
      return this.clone(row);
    },

    findMany: async ({ where, orderBy, take }: any) => {
      let res = this.bookings.slice();
      if (where?.status?.in) {
        const set = new Set(where.status.in);
        res = res.filter((b) => set.has(b.status));
      }
      if (where?.holdExpiresAt?.lt) {
        const lt = new Date(where.holdExpiresAt.lt);
        res = res.filter((b) => b.holdExpiresAt && b.holdExpiresAt < lt);
      }
      if (orderBy?.holdExpiresAt === 'asc') {
        res.sort(
          (a, b) =>
            (a.holdExpiresAt?.getTime() ?? 0) -
            (b.holdExpiresAt?.getTime() ?? 0),
        );
      }
      if (typeof take === 'number') res = res.slice(0, take);
      return this.clone(res);
    },

    update: async ({ where: { id }, data }: any) => {
      const row = this.bookings.find((b) => b.id === id);
      if (!row) return null;
      Object.assign(row, {
        status: data.status ?? row.status,
        cancelPolicyId: data.cancelPolicyId ?? row.cancelPolicyId,
        cancelPolicySnapshot:
          data.cancelPolicySnapshot ?? row.cancelPolicySnapshot,
        reviewDeadlineAt: data.reviewDeadlineAt ?? row.reviewDeadlineAt,
        updatedAt: new Date(),
      });
      return this.clone(row);
    },

    updateMany: async ({ where, data }: any) => {
      let res = this.bookings.slice();
      if (where?.id) res = res.filter((b) => b.id === where.id);
      if (where?.status?.in) {
        const set = new Set(where.status.in);
        res = res.filter((b) => set.has(b.status));
      }
      if (where?.holdExpiresAt?.lt) {
        const lt = new Date(where.holdExpiresAt.lt);
        res = res.filter((b) => b.holdExpiresAt && b.holdExpiresAt < lt);
      }

      let count = 0;
      for (const b of res) {
        if (data?.status !== undefined) b.status = data.status;
        if (data?.holdExpiresAt !== undefined)
          b.holdExpiresAt = new Date(data.holdExpiresAt);
        b.updatedAt = new Date();
        count++;
      }
      return { count };
    },
  };

  // ───────────────────────── Payment (tối giản) ─────────────────────────
  payment = {
    create: async ({ data }: any) => {
      const row = {
        id: this.nextId('pay'),
        bookingId: data.bookingId,
        amount: data.amount,
        provider: data.provider,
        status: data.status ?? 'PENDING',
        externalId: data.externalId,
        refundAmount: data.refundAmount ?? null,
        refundExternalId: data.refundExternalId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.payments.push(row);
      return this.clone(row);
    },

    findMany: async ({ where }: any) => {
      let res = this.payments.slice();
      if (where?.bookingId)
        res = res.filter((p) => p.bookingId === where.bookingId);
      return this.clone(res);
    },

    updateMany: async ({ where, data }: any) => {
      let res = this.payments.slice();
      if (where?.bookingId)
        res = res.filter((p) => p.bookingId === where.bookingId);
      if (where?.status) res = res.filter((p) => p.status === where.status);
      let count = 0;
      for (const p of res) {
        if (data?.status !== undefined) p.status = data.status;
        if (data?.refundAmount !== undefined)
          p.refundAmount = data.refundAmount;
        if (data?.refundExternalId !== undefined)
          p.refundExternalId = data.refundExternalId;
        p.updatedAt = new Date();
        count++;
      }
      return { count };
    },
    update: async ({ where: { id }, data }: any) => {
      const row = this.payments.find((p) => p.id === id);
      if (!row) return null;
      if (data?.status !== undefined) row.status = data.status;
      if (data?.refundAmount !== undefined)
        row.refundAmount = data.refundAmount;
      if (data?.refundExternalId !== undefined)
        row.refundExternalId = data.refundExternalId;
      row.updatedAt = new Date();
      return this.clone(row);
    },
  };

  // ───────────────────────── Refund (tối giản) ─────────────────────────
  refund = {
    create: async ({ data }: any) => {
      const row = {
        id: this.nextId('ref'),
        paymentId: data.paymentId,
        amount: data.amount,
        status: data.status ?? 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.refunds.push(row);
      return this.clone(row);
    },
    findMany: async ({ where }: any) => {
      let res = this.refunds.slice();
      if (where?.paymentId)
        res = res.filter((r) => r.paymentId === where.paymentId);
      return this.clone(res);
    },
  };

  // ───────────────────────── FraudAssessment ─────────────────────────
  fraudAssessment = {
    findUnique: async ({ where: { bookingId } }: any) => {
      const row = this.fraudAssessments.find((f) => f.bookingId === bookingId);
      return this.clone(row);
    },
    upsert: async ({ where: { bookingId }, create, update }: any) => {
      let row = this.fraudAssessments.find((f) => f.bookingId === bookingId);
      if (!row) {
        row = {
          id: this.nextId('fa'),
          bookingId,
          userId: create.userId,
          score: create.score,
          level: create.level,
          decision: create.decision ?? 'PENDING',
          reasons: create.reasons ?? [],
          reviewedById: null,
          reviewedAt: null,
          reviewedNote: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.fraudAssessments.push(row);
      } else {
        row.score = update.score ?? row.score;
        row.level = update.level ?? row.level;
        row.decision = update.decision ?? row.decision;
        row.reasons = update.reasons ?? row.reasons;
        row.reviewedById = update.reviewedById ?? row.reviewedById;
        row.reviewedAt = update.reviewedAt ?? row.reviewedAt;
        row.reviewedNote = update.reviewedNote ?? row.reviewedNote;
        row.updatedAt = new Date();
      }
      return this.clone(row);
    },
    update: async ({ where: { bookingId }, data }: any) => {
      const row = this.fraudAssessments.find((f) => f.bookingId === bookingId);
      if (!row) return null;
      Object.assign(row, {
        decision: data.decision ?? row.decision,
        reviewedById: data.reviewedById ?? row.reviewedById,
        reviewedAt: data.reviewedAt ?? row.reviewedAt,
        reviewedNote: data.reviewedNote ?? row.reviewedNote,
        updatedAt: new Date(),
      });
      return this.clone(row);
    },
  };

  // ───────────────────────── CancelPolicy ─────────────────────────
  cancelPolicy = {
    create: async ({ data }: any) => {
      const row = {
        id: this.nextId('cp'),
        name: data.name,
        isActive: data.isActive ?? true,
        rules: this.clone(data.rules ?? []),
        checkInHour: data.checkInHour ?? null,
        cutoffHour: data.cutoffHour ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.cancelPolicies.push(row);
      return this.clone(row);
    },
    findUnique: async ({ where: { id } }: any) => {
      const row = this.cancelPolicies.find((p) => p.id === id);
      return this.clone(row);
    },
  };

  // ───────────────────────── Outbox ─────────────────────────
  outbox = {
    create: async ({ data }: any) => {
      const row = {
        id: this.nextId('evt'),
        topic: data.topic,
        payload: this.clone(data.payload ?? {}),
        createdAt: new Date(),
      };
      this.outboxEvents.push(row);
      return this.clone(row);
    },
  };
}
