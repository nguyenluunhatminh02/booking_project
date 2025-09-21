import { PromotionService } from './promotion.service';
import {
  MockPrismaPromotion,
  testDay,
} from '../../../test/mocks-prisma-promotion';

describe('PromotionService (unit)', () => {
  let prisma: MockPrismaPromotion;
  let svc: PromotionService;

  const userId = 'u1';

  beforeEach(async () => {
    prisma = new MockPrismaPromotion();
    // seed 2 bookings HOLD
    await prisma.booking.create({
      data: {
        id: 'bk1',
        customerId: userId,
        checkIn: testDay(2025, 12, 1),
        checkOut: testDay(2025, 12, 4),
        status: 'HOLD',
        totalPrice: 3_000_000,
      },
    } as any);
    await prisma.booking.create({
      data: {
        id: 'bk2',
        customerId: userId,
        checkIn: testDay(2025, 12, 1),
        checkOut: testDay(2025, 12, 4),
        status: 'HOLD',
        totalPrice: 3_000_000,
      },
    } as any);

    svc = new PromotionService(prisma as any);
  });

  it('preview: % discount đúng và không side-effects', async () => {
    const promo = await prisma.promotion.create({
      data: {
        code: 'WELCOME10',
        type: 'PERCENT',
        value: 10,
        isActive: true,
      },
    });

    const out = await svc.preview({ bookingId: 'bk1', code: promo.code });
    expect(out.discount).toBe(300_000);
    expect(out.finalPrice).toBe(2_700_000);

    const p = await prisma.promotion.findUnique({ where: { id: promo.id } });
    expect(p?.usedCount).toBe(0);
  });

  it('applyOnHold: tạo redemption RESERVED + set discount vào booking', async () => {
    const promo = await prisma.promotion.create({
      data: { code: 'FIX50', type: 'FIXED', value: 500_000, isActive: true },
    });

    const res = await svc.applyOnHold({
      bookingId: 'bk1',
      userId,
      code: promo.code, // dùng promo đã tạo
    });

    expect(res.discount).toBe(500_000);
    const red = await prisma.promotionRedemption.findUnique({
      where: { bookingId: 'bk1' },
    });
    expect(red?.status).toBe('RESERVED');

    const b1 = await prisma.booking.findUnique({ where: { id: 'bk1' } });
    expect(b1?.promoCode).toBe(promo.code);
    expect(b1?.discountAmount).toBe(500_000);
    // kiểm thêm id khớp luôn cho chắc
    expect(b1?.appliedPromotionId).toBe(promo.id);
  });

  it('confirmOnPaid: first-paid-wins với usageLimit=1', async () => {
    const promo = await prisma.promotion.create({
      data: {
        code: 'LIMIT1',
        type: 'PERCENT',
        value: 20,
        usageLimit: 1,
        isActive: true,
      },
    });

    await svc.applyOnHold({ bookingId: 'bk1', userId, code: promo.code });
    await svc.applyOnHold({ bookingId: 'bk2', userId, code: promo.code });

    // chạy song song để mô phỏng race thực tế
    const [r1, r2] = await Promise.all([
      svc.confirmOnPaid('bk1'),
      svc.confirmOnPaid('bk2'),
    ]);

    // Phải có đúng 1 APPLIED và 1 RELEASED
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual(['APPLIED', 'RELEASED'].sort());

    const released = [r1, r2].find((r) => r.status === 'RELEASED');
    expect(released?.reason).toBe('EXHAUSTED');

    const red1 = await prisma.promotionRedemption.findUnique({
      where: { bookingId: 'bk1' },
    });
    const red2 = await prisma.promotionRedemption.findUnique({
      where: { bookingId: 'bk2' },
    });
    const appliedCount = [red1?.status, red2?.status].filter(
      (s) => s === 'APPLIED',
    ).length;
    expect(appliedCount).toBe(1);

    const p = await prisma.promotion.findUnique({ where: { id: promo.id } });
    expect(p?.usedCount).toBe(1);
  });

  it('releaseOnCancelOrExpire: cause=REFUNDED giảm usedCount nếu đã APPLIED', async () => {
    const promo = await prisma.promotion.create({
      data: {
        code: 'REF',
        type: 'PERCENT',
        value: 50,
        usageLimit: 10,
        isActive: true,
      },
    });

    await svc.applyOnHold({ bookingId: 'bk1', userId, code: 'REF' });
    await svc.confirmOnPaid('bk1'); // -> APPLIED + usedCount=1

    let p = await prisma.promotion.findUnique({ where: { id: promo.id } });
    expect(p?.usedCount).toBe(1);

    await svc.releaseOnCancelOrExpire('bk1', false, 'REFUNDED'); // cause => decrease
    p = await prisma.promotion.findUnique({ where: { id: promo.id } });
    expect(p?.usedCount).toBe(0);

    const b = await prisma.booking.findUnique({ where: { id: 'bk1' } });
    expect(b?.promoCode).toBeNull();
    expect(b?.discountAmount).toBe(0);
    expect(b?.appliedPromotionId).toBeNull();
  });
});
