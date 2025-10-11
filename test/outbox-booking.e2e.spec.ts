// test/outbox-booking.e2e.spec.ts

// --- Mock "file-type" thật SỚM để AppModule (MinioService) không cần cài lib này ---
jest.mock(
  'file-type',
  () => ({
    fileTypeFromBuffer: jest.fn(async (_buf: Buffer) => ({
      mime: 'image/png',
      ext: 'png',
    })),
  }),
  { virtual: true }, // rất quan trọng cho e2e
);

// --- Env cho e2e: tắt autostart publisher & Kafka thật ---
const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  OUTBOX_AUTOSTART: process.env.OUTBOX_AUTOSTART,
  KAFKA_BROKERS: process.env.KAFKA_BROKERS,
  KAFKAJS_NO_PARTITIONER_WARNING: process.env.KAFKAJS_NO_PARTITIONER_WARNING,
  CSRF_ENABLED: process.env.CSRF_ENABLED,
};

process.env.NODE_ENV = 'test';
process.env.OUTBOX_AUTOSTART = '0'; // publisher không tự chạy interval
process.env.KAFKA_BROKERS = ''; // ép OutboxModule xài console/fake (không kết nối Kafka)
process.env.KAFKAJS_NO_PARTITIONER_WARNING = '1';
process.env.CSRF_ENABLED = '0';

import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

import { OutboxPublisher } from '../src/modules/outbox/outbox.publisher';
import { OUTBOX_PRODUCER } from '../src/modules/outbox/outbox.tokens';
import type {
  KafkaProducerLike,
  KafkaMessage,
} from '../src/modules/outbox/types';
import { RedisService } from '../src/common/redis.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt.guard';
import { RoleGuard } from '../src/modules/rbac/guards/role.guard';

// ---------- Fakes ----------
class FakeProducer implements KafkaProducerLike {
  public sent: Record<string, KafkaMessage[]> = {};
  async connect() {}
  async disconnect() {}
  async send(topic: string, messages: KafkaMessage[]) {
    if (!this.sent[topic]) this.sent[topic] = [];
    this.sent[topic].push(...messages);
  }
  take(topic: string) {
    return this.sent[topic] ?? [];
  }
}

class FakeRedisService {
  private store = new Map<string, { val: string; exp?: number }>();

  async set(
    key: string,
    val: string,
    opts?: { ttlSec?: number; nx?: boolean },
  ) {
    const now = Date.now();
    const cur = this.store.get(key);
    if (cur?.exp && cur.exp <= now) this.store.delete(key);

    if (opts?.nx && this.store.has(key)) return false;
    const exp = opts?.ttlSec ? now + opts.ttlSec * 1000 : undefined;
    this.store.set(key, { val, exp });
    return true;
  }

  async del(key: string) {
    this.store.delete(key);
  }
}

class AllowAllGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const uid = (req.headers['x-user-id'] as string) || 'u1';
    // gán quyền đủ để qua RolesGuard
    req.user = {
      id: uid,
      email: `${uid}@test.local`,
      roles: ['ADMIN', 'HOST'],
    };
    return true;
  }
}

// ---------- Test suite ----------
describe('Outbox + Booking (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let publisher: OutboxPublisher;
  let fake: FakeProducer;

  jest.setTimeout(30_000);

  beforeAll(async () => {
    fake = new FakeProducer();

    const modRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      // ✅ BYPASS các guard ở route
      .overrideGuard(JwtAuthGuard)
      .useClass(AllowAllGuard)
      .overrideGuard(RoleGuard)
      .useClass(AllowAllGuard)
      // ✅ ép Outbox dùng fake + Redis fake
      .overrideProvider(OUTBOX_PRODUCER)
      .useValue(fake)
      .overrideProvider(RedisService)
      .useClass(FakeRedisService)
      .compile();

    app = modRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    publisher = app.get(OutboxPublisher);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect(); // đảm bảo đóng pool Prisma

    const restore = (key: keyof typeof originalEnv) => {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };
    restore('NODE_ENV');
    restore('OUTBOX_AUTOSTART');
    restore('KAFKA_BROKERS');
    restore('KAFKAJS_NO_PARTITIONER_WARNING');
    restore('CSRF_ENABLED');
  });

  it('POST /bookings/hold → ghi Outbox booking.held → tick() publish & xoá', async () => {
    // 1) Tạo property
    const p = await request(app.getHttpServer())
      .post('/properties')
      .set('X-User-Id', 'u1')
      .send({ title: 'Sea View', address: 'HCMC', amenities: {} })
      .expect(201);
    const propId = p.body.id as string;

    // 2) Seed lịch 3 ngày (có remaining/capacity)
    await request(app.getHttpServer())
      .post(`/properties/${propId}/calendar`)
      .set('X-User-Id', 'u1')
      .send({
        items: [
          { date: '2025-12-01', price: 1_000_000, remaining: 1 },
          { date: '2025-12-02', price: 1_200_000, remaining: 1 },
          { date: '2025-12-03', price: 1_500_000, remaining: 1 },
        ],
      })
      .expect(201);

    // 3) Hold booking
    const hold = await request(app.getHttpServer())
      .post('/bookings/hold')
      .set('X-User-Id', 'u1')
      .set('Idempotency-Key', 'idem-1')
      .send({
        propertyId: propId,
        checkIn: '2025-12-01',
        checkOut: '2025-12-04',
      })
      .expect(201);

    const bookingId = hold.body.id as string;

    // 4) DB có row outbox topic=booking.held
    const row = await prisma.outbox.findFirst({
      where: { topic: 'booking.held' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).toBeTruthy();
    expect((row!.payload as any).bookingId).toBe(bookingId);

    // 5) Publish 1 vòng → fake producer sẽ lưu message
    await publisher.tick();

    const sent = fake.take('booking.held');
    expect(sent.length).toBeGreaterThanOrEqual(1);

    const msg = sent[sent.length - 1];
    const val = JSON.parse(msg.value);
    expect(val.topic).toBe('booking.held');
    expect(val.payload.bookingId).toBe(bookingId);

    // 6) Row outbox đã bị xoá sau khi publish
    const left = await prisma.outbox.count({ where: { id: row!.id } });
    expect(left).toBe(0);
  });
});
