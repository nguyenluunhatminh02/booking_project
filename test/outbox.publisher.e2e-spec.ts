import { Test } from '@nestjs/testing';
import { OutboxPublisher } from '../src/modules/outbox/outbox.publisher';
import { OUTBOX_PRODUCER } from '../src/modules/outbox/outbox.tokens';

describe('OutboxPublisher (e2e)', () => {
  const prisma = {
    outbox: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const redis = {
    set: jest.fn(),
    del: jest.fn(),
  };

  const sent: Array<{ topic: string; messages: any[] }> = [];
  const producer = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    send: jest
      .fn()
      .mockImplementation(async (topic: string, messages: any[]) => {
        sent.push({ topic, messages });
      }),
  };

  beforeAll(() => {
    process.env.OUTBOX_AUTOSTART = '0'; // không tự poll timer trong e2e
    process.env.KAFKA_TOPIC_PREFIX = 'e2e.';
  });

  beforeEach(() => {
    jest.resetAllMocks();
    sent.length = 0;
    redis.set.mockResolvedValue(true);
    redis.del.mockResolvedValue(1);
  });

  it('publish + deleteMany + lock/unlock (happy path)', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OutboxPublisher,
        { provide: 'PrismaService', useValue: prisma }, // nếu project export token khác, đổi lại cho khớp
        { provide: 'RedisService', useValue: redis },
        { provide: OUTBOX_PRODUCER, useValue: producer },
      ],
    })
      // Nếu project dùng class PrismaService/RedisService thật, có thể .overrideProvider để mock:
      .overrideProvider('PrismaService')
      .useValue(prisma)
      .overrideProvider('RedisService')
      .useValue(redis)
      .compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const publisher = app.get(OutboxPublisher);

    // Fake rows
    const createdAt = new Date('2025-09-21T12:34:56Z');
    prisma.outbox.findMany.mockResolvedValueOnce([
      {
        id: 'x1',
        topic: 'booking.events',
        eventKey: 'bk_10',
        payload: { type: 'booking.confirmed', amount: 100 },
        createdAt,
      },
      {
        id: 'x2',
        topic: 'booking.events',
        eventKey: 'bk_10',
        payload: { type: 'booking.refunded', amount: 100 },
        createdAt,
      },
    ]);
    prisma.outbox.deleteMany.mockResolvedValue({ count: 2 });

    await publisher.onModuleInit(); // connect producer
    await publisher.tick();

    // kiểm send
    expect(producer.send).toHaveBeenCalledTimes(1);
    const [topic, messages] = producer.send.mock.calls[0];
    expect(topic).toBe('e2e.booking.events');
    expect(messages).toHaveLength(2);

    // header & envelope
    const m0 = messages[0];
    expect(m0.key).toBe('bk_10');
    const value = JSON.parse(m0.value);
    expect(value).toMatchObject({
      id: 'x1',
      topic: 'e2e.booking.events',
      v: 1,
      payload: { type: 'booking.confirmed', amount: 100 },
    });
    expect(m0.headers['x-event-id']).toBe('x1');
    expect(m0.headers['x-topic']).toBe('e2e.booking.events');
    expect(m0.headers['x-schema-ver']).toBe('1');

    // xoá
    expect(prisma.outbox.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['x1', 'x2'] } },
    });

    // lock
    expect(redis.set).toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('job:outbox:publish');

    await app.close();
  });

  it('skip khi lock không acquire', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OutboxPublisher,
        { provide: 'PrismaService', useValue: prisma },
        { provide: 'RedisService', useValue: redis },
        { provide: OUTBOX_PRODUCER, useValue: producer },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const publisher = app.get(OutboxPublisher);

    redis.set.mockResolvedValueOnce(false);
    await publisher.tick();

    expect(producer.send).not.toHaveBeenCalled();
    expect(prisma.outbox.findMany).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();

    await app.close();
  });
});
