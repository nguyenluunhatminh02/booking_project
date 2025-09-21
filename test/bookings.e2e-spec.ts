import {
  INestApplication,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { APP_GUARD } from '@nestjs/core';

import { PropertyService } from '../src/modules/property/property.service';
import { PropertyController } from '../src/modules/property/property.controller';
import { PrismaService } from '../src/prisma/prisma.service';
import { MockPrismaBookings } from './mocks-prisma-bookings';
import { FraudService } from '../src/modules/fraud/fraud.service';
import { IdempotencyService } from '../src/modules/idempotency/idempotency.service';
import { BookingsController } from '../src/modules/booking/bookings.controller';
import { BookingsService } from '../src/modules/booking/bookings.service';
import { addDays, addMinutes } from 'date-fns';

// ───────────────────── Fake Auth: luôn có req.user.id ─────────────────────
class FakeAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    req.user = { id: 'u1' };
    return true;
  }
}

// ───────────────────── Fakes (DI) ─────────────────────
class FakeFraud implements Partial<FraudService> {
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
class FakeIdem implements Partial<IdempotencyService> {
  seq = 1;
  store = new Map<string, any>();
  private keyOf(p: any) {
    const { userId, endpoint, key, payloadForHash } = p;
    return JSON.stringify({ userId, endpoint, key, payloadForHash });
  }
  async beginOrReuse(p: any) {
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

describe('Bookings E2E (happy paths + review + expire)', () => {
  let app: INestApplication;
  let prisma: MockPrismaBookings;
  let propId: string;

  // Giữ ref để tinh chỉnh trong test
  let svc: BookingsService;
  let fraud: FakeFraud;

  beforeAll(async () => {
    prisma = new MockPrismaBookings();

    const moduleRef = await Test.createTestingModule({
      controllers: [PropertyController, BookingsController],
      providers: [
        PropertyService,
        BookingsService,
        { provide: PrismaService, useValue: prisma as any },
        { provide: FraudService, useClass: FakeFraud },
        { provide: IdempotencyService, useClass: FakeIdem },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    // Lấy ref để chỉnh cấu hình & chế độ fraud trong các test
    svc = app.get(BookingsService);
    fraud = app.get(FraudService);

    // Patch config cho ổn định thời gian
    (svc as any).cfg = {
      holdMinutes: 10,
      autoDeclineHigh: false,
      reviewHoldDaysDefault: 2, // cho test REVIEW TTL
    };

    // Seed property cho u1
    const res = await request(app.getHttpServer())
      .post('/properties')
      .send({ title: 'P', address: 'A', amenities: {} })
      .expect(201);
    propId = res.body.id;

    // Seed calendar 3 ngày (2 phòng/ngày)
    await request(app.getHttpServer())
      .post(`/properties/${propId}/calendar`)
      .send({
        items: [
          { date: '2025-12-01', price: 100, remaining: 2 },
          { date: '2025-12-02', price: 120, remaining: 2 },
          { date: '2025-12-03', price: 150, remaining: 2 },
        ],
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  const getRemain = async () => {
    const cal = await request(app.getHttpServer())
      .get(`/properties/${propId}/calendar?from=2025-12-01&to=2025-12-04`)
      .expect(200);
    return cal.body.days.map((d: any) => d.remaining);
  };

  it('POST /bookings/hold (LOW) → 201 + trừ tồn kho', async () => {
    fraud.mode = 'LOW';
    const t0 = new Date();

    const r = await request(app.getHttpServer())
      .post('/bookings/hold')
      .set('Idempotency-Key', 'e2e-key-1')
      .send({
        propertyId: propId,
        checkIn: '2025-12-01',
        checkOut: '2025-12-04',
      })
      .expect(201);

    expect(r.body.status).toBe('HOLD');

    // TTL ~ holdMinutes (best-effort check)
    const b = await (prisma as any).booking.findUnique({
      where: { id: r.body.id },
    });
    const expected = addMinutes(t0, (svc as any).cfg.holdMinutes).getTime();
    const delta = Math.abs(new Date(b.holdExpiresAt).getTime() - expected);
    expect(delta).toBeLessThan(2000);

    expect(await getRemain()).toEqual([1, 1, 1]); // trừ 1 mỗi ngày
  });

  it('POST /bookings/hold (REUSE) cùng key → trả snapshot, inventory không đổi thêm', async () => {
    const r2 = await request(app.getHttpServer())
      .post('/bookings/hold')
      .set('Idempotency-Key', 'e2e-key-1')
      .send({
        propertyId: propId,
        checkIn: '2025-12-01',
        checkOut: '2025-12-04',
      })
      .expect(201);

    expect(r2.body.status).toBeDefined();
    expect(await getRemain()).toEqual([1, 1, 1]); // vẫn 1 1 1
  });

  it('POST /bookings/hold (MEDIUM) → REVIEW + TTL = now + reviewHoldDaysDefault', async () => {
    fraud.mode = 'MEDIUM';
    const t0 = new Date();

    const r = await request(app.getHttpServer())
      .post('/bookings/hold')
      .set('Idempotency-Key', 'e2e-key-review')
      .send({
        propertyId: propId,
        checkIn: '2025-12-01',
        checkOut: '2025-12-04',
      })
      .expect(201);

    expect(r.body.status).toBe('REVIEW');

    const b = await (prisma as any).booking.findUnique({
      where: { id: r.body.id },
    });
    const expected = addDays(
      t0,
      (svc as any).cfg.reviewHoldDaysDefault,
    ).getTime();
    const delta = Math.abs(new Date(b.holdExpiresAt).getTime() - expected);
    expect(delta).toBeLessThan(2000);
  });

  it('POST /bookings/:id/cancel → trả kho', async () => {
    // giữ thêm 1 booking mới (LOW) để đẩy về 0 0 0
    fraud.mode = 'LOW';
    const r = await request(app.getHttpServer())
      .post('/bookings/hold')
      .set('Idempotency-Key', 'e2e-key-2')
      .send({
        propertyId: propId,
        checkIn: '2025-12-01',
        checkOut: '2025-12-04',
      })
      .expect(201);
    const bid = r.body.id;

    // lúc này tồn kho từ [1,1,1] → [0,0,0]
    expect(await getRemain()).toEqual([0, 0, 0]);

    // cancel (controller lấy userId từ req.user)
    await request(app.getHttpServer())
      .post(`/bookings/${bid}/cancel`)
      .send({})
      .expect(201);

    // trả kho → [1,1,1]
    expect(await getRemain()).toEqual([1, 1, 1]);
  });

  it('POST /bookings/expire-holds → cancel các HOLD/REVIEW quá hạn và trả kho', async () => {
    // Tạo 1 booking quá hạn bằng cách thao tác trực tiếp mock:
    const past = new Date(Date.now() - 60_000);
    // @ts-ignore
    const b = await prisma.booking.create({
      data: {
        propertyId: propId,
        customerId: 'u1',
        checkIn: new Date(Date.UTC(2025, 11, 1)),
        checkOut: new Date(Date.UTC(2025, 11, 4)),
        status: 'HOLD',
        holdExpiresAt: past,
        totalPrice: 370,
      },
    });
    // trừ tồn kho như đã hold
    await prisma.availabilityDay.updateMany({
      where: { propertyId: propId, date: new Date(Date.UTC(2025, 11, 1)) },
      data: { remaining: { decrement: 1 } },
    });
    await prisma.availabilityDay.updateMany({
      where: { propertyId: propId, date: new Date(Date.UTC(2025, 11, 2)) },
      data: { remaining: { decrement: 1 } },
    });
    await prisma.availabilityDay.updateMany({
      where: { propertyId: propId, date: new Date(Date.UTC(2025, 11, 3)) },
      data: { remaining: { decrement: 1 } },
    });

    // Trước khi expire: [0,0,0]
    expect(await getRemain()).toEqual([0, 0, 0]);

    // Gọi expire-holds
    await request(app.getHttpServer())
      .post('/bookings/expire-holds')
      .expect(201);

    // đã trả kho → [1,1,1]
    expect(await getRemain()).toEqual([1, 1, 1]);
  });
});
