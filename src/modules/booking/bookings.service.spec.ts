import { ForbiddenException } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { MockPrismaBookings } from '../../../test/mocks-prisma-bookings';
import { addDays, addMinutes } from 'date-fns';

// ─────────── Fakes ───────────
class FakeFraud {
  mode: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
  async assess(_userId: string, _amount: number) {
    return {
      skipped: false,
      level: this.mode,
      score: this.mode === 'LOW' ? 10 : this.mode === 'MEDIUM' ? 60 : 90,
      reasons: [],
    };
  }
}

type BeginResp =
  | { mode: 'NEW'; id: string }
  | { mode: 'REUSE'; response: any }
  | { mode: 'IN_PROGRESS' };

class FakeIdem {
  seq = 1;
  store = new Map<
    string,
    { id: string; response?: any; inProgress: boolean }
  >();
  private keyOf(p: any) {
    const { userId, endpoint, key, payloadForHash } = p;
    return JSON.stringify({ userId, endpoint, key, payloadForHash });
  }
  async beginOrReuse(p: any): Promise<BeginResp> {
    const k = this.keyOf(p);
    const cur = this.store.get(k);
    if (cur?.response) return { mode: 'REUSE', response: cur.response };
    if (cur?.inProgress) return { mode: 'IN_PROGRESS' };
    const id = `idem_${this.seq++}`;
    this.store.set(k, { id, inProgress: true });
    return { mode: 'NEW', id };
  }
  async completeOK(id: string, response: any) {
    for (const [k, v] of this.store) {
      if (v.id === id) this.store.set(k, { ...v, response, inProgress: false });
    }
  }
  async completeFailed(id: string) {
    for (const [k, v] of this.store) {
      if (v.id === id) this.store.set(k, { ...v, inProgress: false });
    }
  }
}

// ─────────── helpers ───────────
function day(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

// ─────────── Robust shim cho $executeRaw / $executeRawUnsafe ───────────
// Bắt mọi cú pháp trừ kho:  SET ... remaining ... - 1
// Bắt mọi cú pháp cộng kho: SET ... remaining ... + 1   (kể cả LEAST(...))
// Không phụ thuộc dấu ngoặc kép, khoảng trắng, hay casing.
function installExecuteRawShims(prisma: any) {
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

  const exec = async (queryOrTpl: any, ...vals: any[]) => {
    const sqlRaw =
      typeof queryOrTpl === 'string'
        ? queryOrTpl
        : Array.isArray(queryOrTpl)
          ? queryOrTpl.join('')
          : String(queryOrTpl);
    const sql = normalize(sqlRaw);

    // id được bind từ template `${a.id}`
    const id = vals?.[0];

    // Nhận diện UPDATE "AvailabilityDay" ... SET ... remaining ...
    const isUpdateAvailability =
      /update\s+["']?availabilityday["']?/.test(sql) &&
      /\sset\s+/.test(sql) &&
      /remaining/.test(sql);

    if (isUpdateAvailability) {
      // Trả kho: có dấu + 1 ở vế SET
      const isIncrement = /set[^;]*remaining[^;]*\+[^;]*1/.test(sql);
      // Trừ kho: có dấu - 1 ở vế SET
      const isDecrement = /set[^;]*remaining[^;]*-[^;]*1/.test(sql);

      if (isIncrement) {
        // +1 remaining
        await prisma.availabilityDay.updateMany({
          where: { id },
          data: { remaining: { increment: 1 } },
        });
        return 1;
      }
      if (isDecrement) {
        // -1 remaining (chỉ khi > 0 và không bị block)
        const rows = await prisma.availabilityDay.findMany({ where: { id } });
        if (!rows?.length) return 0;
        const a = rows[0];
        if (a.isBlocked || a.remaining <= 0) return 0;

        await prisma.availabilityDay.updateMany({
          where: { id },
          data: { remaining: { decrement: 1 } },
        });
        return 1;
      }
    }

    // Fallback: coi như OK để không cản flow khác
    return 1;
  };

  // Gắn vào prisma gốc
  prisma.$executeRaw = exec;
  prisma.$executeRawUnsafe = exec;

  // Bọc $transaction để shim cả "tx" trong callback
  const origTx = prisma.$transaction?.bind(prisma);
  if (origTx) {
    prisma.$transaction = async (cb: any) => {
      return await origTx(async (tx: any) => {
        tx.$executeRaw = exec;
        tx.$executeRawUnsafe = exec;
        return cb(tx);
      });
    };
  }
}

// ─────────── Tests ───────────
describe('BookingsService (wantReview + refund)', () => {
  let prisma: MockPrismaBookings;
  let fraud: FakeFraud;
  let idem: FakeIdem;
  let svc: BookingsService;

  const userId = 'u1';
  let propertyId: string;

  beforeEach(async () => {
    prisma = new MockPrismaBookings();
    installExecuteRawShims(prisma as any);

    fraud = new FakeFraud();
    idem = new FakeIdem();

    // @ts-ignore
    svc = new BookingsService(prisma as any, fraud as any, idem as any);
    // patch config để test ổn định
    (svc as any).cfg = {
      holdMinutes: 10,
      autoDeclineHigh: false,
      reviewHoldDaysDefault: 1,
    };

    // seed property + 3 ngày (2 phòng/ngày)
    const prop = await prisma.property.create({
      data: { hostId: userId, title: 'P', address: 'A' },
    });
    propertyId = prop.id;

    for (const [d, p] of [
      [day(2025, 12, 1), 3_000_000],
      [day(2025, 12, 2), 3_000_000],
      [day(2025, 12, 3), 3_000_000],
    ] as any) {
      await prisma.availabilityDay.upsert({
        where: { propertyId_date: { propertyId, date: d } },
        create: {
          propertyId,
          date: d,
          price: p,
          remaining: 2,
          isBlocked: false,
        },
        update: {},
      });
    }
  });

  it('MEDIUM: holdExpiresAt = now + reviewHoldDaysDefault & reviewDeadlineAt khớp', async () => {
    fraud.mode = 'MEDIUM';
    (svc as any).cfg.reviewHoldDaysDefault = 2;
    const t0 = new Date();

    const r = await svc.hold(
      userId,
      propertyId,
      '2025-12-01',
      '2025-12-04',
      'kReviewTTL',
    );
    const b = await prisma.booking.findUnique({ where: { id: r.id } });

    expect(b?.status).toBe('REVIEW');
    const expected = addDays(t0, 2).getTime();
    const delta = Math.abs(new Date(b!.holdExpiresAt).getTime() - expected);
    expect(delta).toBeLessThan(2000); // +/- 2s
    expect(
      b!.reviewDeadlineAt && new Date(b!.reviewDeadlineAt).toISOString(),
    ).toBe(new Date(b!.holdExpiresAt).toISOString());
  });

  it('LOW: holdExpiresAt = now + holdMinutes', async () => {
    fraud.mode = 'LOW';
    (svc as any).cfg.holdMinutes = 10;
    const t0 = new Date();

    const r = await svc.hold(
      userId,
      propertyId,
      '2025-12-01',
      '2025-12-04',
      'kHoldTTL',
    );
    const b = await prisma.booking.findUnique({ where: { id: r.id } });

    expect(b?.status).toBe('HOLD');
    const expected = addMinutes(t0, 10).getTime();
    const delta = Math.abs(new Date(b!.holdExpiresAt).getTime() - expected);
    expect(delta).toBeLessThan(2000);
  });

  it('LOW → HOLD, trừ tồn kho, outbox booking.held', async () => {
    fraud.mode = 'LOW';

    const res = await svc.hold(
      userId,
      propertyId,
      '2025-12-01',
      '2025-12-04',
      'k1',
    );
    expect(res.status).toBe('HOLD');
    expect(res.totalPrice).toBe(9_000_000);

    const after = await prisma.availabilityDay.findMany({
      where: {
        propertyId,
        date: { gte: day(2025, 12, 1), lt: day(2025, 12, 4) },
      },
      orderBy: { date: 'asc' },
    });
    expect(after.map((a) => a.remaining)).toEqual([1, 1, 1]);

    const topics = prisma.getOutbox().map((o) => o.topic);
    expect(topics).toEqual(['booking.held']);
  });

  it('MEDIUM → REVIEW + outbox review_pending + held', async () => {
    fraud.mode = 'MEDIUM';
    const res = await svc.hold(
      userId,
      propertyId,
      '2025-12-01',
      '2025-12-04',
      'k2',
    );
    expect(res.status).toBe('REVIEW');

    const topics = prisma.getOutbox().map((o) => o.topic);
    expect(new Set(topics)).toEqual(
      new Set(['booking.held', 'booking.review_pending']),
    );
  });

  it('HIGH + autoDeclineHigh=true → CANCELLED, inventory không bị trừ, chỉ outbox auto_declined', async () => {
    fraud.mode = 'HIGH';
    (svc as any).cfg.autoDeclineHigh = true;

    const res = await svc.hold(
      userId,
      propertyId,
      '2025-12-01',
      '2025-12-04',
      'kAD',
    );
    expect(res.status).toBe('CANCELLED');

    const after = await prisma.availabilityDay.findMany({
      where: {
        propertyId,
        date: { gte: day(2025, 12, 1), lt: day(2025, 12, 4) },
      },
      orderBy: { date: 'asc' },
    });
    expect(after.map((a) => a.remaining)).toEqual([2, 2, 2]);

    const topics = prisma.getOutbox().map((o) => o.topic);
    expect(new Set(topics)).toEqual(new Set(['booking.auto_declined']));
  });

  it('approveReview → CONFIRMED + outbox review_approved', async () => {
    fraud.mode = 'MEDIUM';
    const r = await svc.hold(
      userId,
      propertyId,
      '2025-12-01',
      '2025-12-04',
      'kApprove',
    );
    expect(r.status).toBe('REVIEW');

    await svc.approveReview('rev1', r.id, 'ok');
    const b = await prisma.booking.findUnique({ where: { id: r.id } });
    expect(b?.status).toBe('CONFIRMED');

    const topics = prisma.getOutbox().map((o) => o.topic);
    expect(topics.includes('booking.review_approved')).toBe(true);
  });

  it('declineReview → CANCELLED + inventory back + outbox review_declined', async () => {
    fraud.mode = 'MEDIUM';
    const r = await svc.hold(
      userId,
      propertyId,
      '2025-12-01',
      '2025-12-04',
      'kDecline',
    );
    expect(r.status).toBe('REVIEW');

    await svc.declineReview('rev1', r.id, 'mismatch');
    const b = await prisma.booking.findUnique({ where: { id: r.id } });
    expect(b?.status).toBe('CANCELLED');

    const after = await prisma.availabilityDay.findMany({
      where: {
        propertyId,
        date: { gte: day(2025, 12, 1), lt: day(2025, 12, 4) },
      },
      orderBy: { date: 'asc' },
    });
    expect(after.map((a) => a.remaining)).toEqual([2, 2, 2]);

    const topics = prisma.getOutbox().map((o) => o.topic);
    expect(topics.includes('booking.review_declined')).toBe(true);
  });

  it('idempotency REUSE: gọi lại cùng key không phát thêm outbox', async () => {
    const before = prisma.getOutbox().length;
    const r1 = await svc.hold(
      userId,
      propertyId,
      '2025-12-01',
      '2025-12-04',
      'kSame',
    );
    const mid = prisma.getOutbox().length;
    const r2 = await svc.hold(
      userId,
      propertyId,
      '2025-12-01',
      '2025-12-04',
      'kSame',
    );
    const after = prisma.getOutbox().length;

    expect(r2).toEqual(r1);
    expect(after).toBe(mid);
    expect(before).toBeLessThan(after);
  });

  it('expireHolds: chuyển HOLD quá hạn → CANCELLED và trả tồn kho', async () => {
    // tạo hold quá hạn (đã trừ tồn kho)
    await prisma.booking.create({
      data: {
        propertyId,
        customerId: userId,
        checkIn: day(2025, 12, 1),
        checkOut: day(2025, 12, 4),
        status: 'HOLD',
        holdExpiresAt: new Date(Date.now() - 60_000),
        totalPrice: 9_000_000,
      },
    });
    await prisma.availabilityDay.updateMany({
      where: { propertyId, date: day(2025, 12, 1) },
      data: { remaining: { decrement: 1 } },
    });
    await prisma.availabilityDay.updateMany({
      where: { propertyId, date: day(2025, 12, 2) },
      data: { remaining: { decrement: 1 } },
    });
    await prisma.availabilityDay.updateMany({
      where: { propertyId, date: day(2025, 12, 3) },
      data: { remaining: { decrement: 1 } },
    });

    const out = await svc.expireHolds(new Date());
    expect(out.expired).toBeGreaterThanOrEqual(1);

    const back = await prisma.availabilityDay.findMany({
      where: {
        propertyId,
        date: { gte: day(2025, 12, 1), lt: day(2025, 12, 4) },
      },
      orderBy: { date: 'asc' },
    });
    expect(back.map((a) => a.remaining)).toEqual([2, 2, 2]);

    const topics = prisma.getOutbox().map((o) => o.topic);
    expect(topics.includes('booking.expired')).toBe(true);
  });

  it('cancelHold: sai user → Forbidden', async () => {
    const r = await svc.hold(
      userId,
      propertyId,
      '2025-12-01',
      '2025-12-04',
      'k5',
    );
    await expect(svc.cancelHold('other', r.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('cancelHold: đúng user → CANCELLED và trả kho', async () => {
    const r = await svc.hold(
      userId,
      propertyId,
      '2025-12-01',
      '2025-12-04',
      'k6',
    );
    const ret = await svc.cancelHold(userId, r.id);
    expect(ret?.status).toBe('CANCELLED');

    const after = await prisma.availabilityDay.findMany({
      where: {
        propertyId,
        date: { gte: day(2025, 12, 1), lt: day(2025, 12, 4) },
      },
      orderBy: { date: 'asc' },
    });
    expect(after.map((a) => a.remaining)).toEqual([2, 2, 2]);
  });

  it('attachCancelPolicy + previewRefund (10 ngày → 50%)', async () => {
    const b = await prisma.booking.create({
      data: {
        propertyId,
        customerId: userId,
        checkIn: day(2025, 12, 15),
        checkOut: day(2025, 12, 18),
        status: 'CONFIRMED',
        totalPrice: 6_000_000,
      },
    });
    const pol = await prisma.cancelPolicy.create({
      data: {
        name: 'Flexible',
        isActive: true,
        rules: [
          { beforeDays: 14, refundPercent: 100 },
          { beforeDays: 7, refundPercent: 50 },
          { beforeDays: 2, refundPercent: 20 },
        ],
      },
    });

    await svc.attachCancelPolicy(b.id, pol.id);

    // 2025-12-05 → cách 10 ngày → rule 7 → 50%
    const pr = await svc.previewRefund(b.id, new Date(Date.UTC(2025, 11, 5)));
    expect(pr.percent).toBe(50);
    expect(pr.refundAmount).toBe(3_000_000);
  });

  it('cancelPaidOrConfirmed: REFUNDED + trả kho + payment cập nhật', async () => {
    const b = await prisma.booking.create({
      data: {
        propertyId,
        customerId: userId,
        checkIn: day(2025, 12, 1),
        checkOut: day(2025, 12, 4),
        status: 'CONFIRMED',
        totalPrice: 9_000_000,
      },
    });
    await prisma.payment.create({
      data: {
        bookingId: b.id,
        amount: 9_000_000,
        provider: 'MOCK',
        status: 'SUCCEEDED',
        externalId: 'x1',
      },
    });
    await prisma.booking.update({
      where: { id: b.id },
      data: { cancelPolicySnapshot: [{ beforeDays: 7, refundPercent: 50 }] },
    });

    const ret = await (svc as any).cancelPaidOrConfirmed(userId, b.id);
    expect(ret.status).toBe('REFUNDED');

    const afterB = await prisma.booking.findUnique({ where: { id: b.id } });
    expect(afterB?.status).toBe('REFUNDED');

    const pay = await prisma.payment.findMany({ where: { bookingId: b.id } });
    expect(pay[0].status).toBe('REFUNDED');
  });
});
