import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';

import { PromotionController } from '../src/modules/promotion/promotion.controller';
import { PromotionService } from '../src/modules/promotion/promotion.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { MockPrismaPromotion, testDay } from './mocks-prisma-promotion';

describe('Promotion E2E', () => {
  let app: INestApplication;
  let prisma: MockPrismaPromotion;
  let promoId: string;
  const userId = 'u1';

  beforeAll(async () => {
    prisma = new MockPrismaPromotion();

    // Seed booking HOLD
    await prisma.booking.create({
      data: {
        id: 'bkE2E',
        customerId: userId,
        checkIn: testDay(2025, 12, 1),
        checkOut: testDay(2025, 12, 4),
        status: 'HOLD',
        totalPrice: 3_000_000,
      },
    } as any);

    const moduleRef = await Test.createTestingModule({
      controllers: [PromotionController],
      providers: [
        PromotionService,
        { provide: PrismaService, useValue: prisma as any },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /promotions -> create', async () => {
    const res = await request(app.getHttpServer())
      .post('/promotions')
      .send({
        code: 'WELCOME10',
        type: 'PERCENT',
        value: 10,
        isActive: true,
      })
      .expect(201);

    promoId = res.body.id;
    expect(res.body.code).toBe('WELCOME10');
  });

  it('GET /promotions/preview -> no side effects', async () => {
    const _result = await request(app.getHttpServer())
      .get(`/promotions/preview?bookingId=bkE2E&code=WELCOME10`)
      .expect(200);

    expect(r.body.discount).toBe(300_000);
    const p = await prisma.promotion.findUnique({ where: { id: promoId } });
    expect(p?.usedCount).toBe(0);
  });

  it('POST /promotions/apply-on-hold -> RESERVED & set discount on booking', async () => {
    const _result = await request(app.getHttpServer())
      .post('/promotions/apply-on-hold')
      .send({ bookingId: 'bkE2E', userId, code: 'WELCOME10' })
      .expect(201);

    expect(r.body.discount).toBe(300_000);
    const red = await prisma.promotionRedemption.findUnique({
      where: { bookingId: 'bkE2E' },
    });
    expect(red?.status).toBe('RESERVED');
  });

  it('POST /promotions/confirm-on-paid -> APPLIED', async () => {
    const _result = await request(app.getHttpServer())
      .post('/promotions/confirm-on-paid')
      .send({ bookingId: 'bkE2E' })
      .expect(201);

    const red = await prisma.promotionRedemption.findUnique({
      where: { bookingId: 'bkE2E' },
    });
    expect(red?.status).toBe('APPLIED');

    const p = await prisma.promotion.findUnique({ where: { id: promoId } });
    expect(p?.usedCount).toBe(1);
  });

  it('POST /promotions/release (REFUNDED) -> decrease usage & clear booking promo', async () => {
    await request(app.getHttpServer())
      .post('/promotions/release')
      .send({ bookingId: 'bkE2E', decreaseUsage: false, cause: 'REFUNDED' })
      .expect(201);

    const p = await prisma.promotion.findUnique({ where: { id: promoId } });
    expect(p?.usedCount).toBe(0);

    const b = await prisma.booking.findUnique({ where: { id: 'bkE2E' } });
    expect(b?.promoCode).toBeNull();
    expect(b?.discountAmount).toBe(0);
    expect(b?.appliedPromotionId).toBeNull();
  });
});
