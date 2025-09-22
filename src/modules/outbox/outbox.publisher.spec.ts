import { OutboxPublisher } from './outbox.publisher';

type Row = {
  id: string;
  topic: string;
  eventKey: string | null;
  payload: any;
  createdAt: Date;
};

function row(partial: Partial<Row>): Row {
  return {
    id: partial.id || Math.random().toString(36).slice(2),
    topic: partial.topic || 'booking.events',
    eventKey: partial.eventKey ?? null,
    payload: partial.payload ?? { ok: true },
    createdAt: partial.createdAt || new Date('2025-09-21T12:00:00Z'),
  };
}

describe('OutboxPublisher (unit)', () => {
  const prisma: any = {
    outbox: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(), // không dùng ở phiên bản publisher hiện tại
    outbox_deleteMany: jest.fn(), // helper để theo dõi call
  };

  const redis: any = {
    set: jest.fn(),
    del: jest.fn(),
  };

  const producer = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
  };

  // khởi tạo publisher bằng cách "giả" DI thủ công
  let publisher: OutboxPublisher;

  beforeEach(async () => {
    jest.resetAllMocks();
    // ENV: không autostart để tránh timer
    process.env.OUTBOX_AUTOSTART = '0';
    process.env.OUTBOX_POLL_SEC = '1';
    process.env.OUTBOX_BATCH = '200';
    process.env.KAFKA_TOPIC_PREFIX = 'dev.';

    // mock prisma.deleteMany vì publisher gọi trực tiếp (không qua $transaction)
    prisma.outbox.deleteMany = jest.fn().mockResolvedValue({ count: 0 });

    // Redis lock: cho phép acquire
    redis.set.mockResolvedValue(true);
    redis.del.mockResolvedValue(1);

    // build instance
    publisher = new OutboxPublisher(prisma, redis, producer as any);

    await publisher.onModuleInit(); // gọi connect()
  });

  afterEach(async () => {
    await publisher.onModuleDestroy();
  });

  it('skip khi không acquire được Redis lock', async () => {
    redis.set.mockResolvedValueOnce(false);
    await publisher.tick();

    expect(producer.send).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled(); // chưa acquire ⇒ không del
  });

  it('group theo topic và gửi headers + envelope chuẩn, sau đó deleteMany', async () => {
    const rows: Row[] = [
      row({
        id: 'e1',
        topic: 'booking.events',
        eventKey: 'bk_1',
        payload: { type: 'booking.confirmed' },
      }),
      row({
        id: 'e2',
        topic: 'booking.events',
        eventKey: 'bk_1',
        payload: { type: 'booking.refunded' },
      }),
      row({
        id: 'e3',
        topic: 'inventory.events',
        eventKey: 'prop_1:2025-09-22',
        payload: { type: 'inventory.adjusted' },
      }),
    ];

    prisma.outbox.findMany.mockResolvedValueOnce(rows);

    await publisher.tick();

    // gửi 2 lần (2 topic khác nhau, có prefix 'dev.')
    expect(producer.send).toHaveBeenCalledTimes(2);

    // Lần 1: dev.booking.events (không chắc thứ tự map, kiểm theo tham số)
    const calls = producer.send.mock.calls;
    const topics = calls.map(([t]: [string, any]) => t).sort();
    expect(topics).toEqual(
      ['dev.booking.events', 'dev.inventory.events'].sort(),
    );

    // Kiểm 1 call cụ thể
    const callBooking = calls.find(
      ([t]: [string, any]) => t === 'dev.booking.events',
    )!;
    const bookingMsgs = callBooking[1] as Array<{
      key?: string;
      value: string;
      headers: Record<string, any>;
    }>;
    expect(bookingMsgs).toHaveLength(2);
    expect(bookingMsgs[0].key).toBe('bk_1');
    const v0 = JSON.parse(bookingMsgs[0].value);
    expect(v0).toMatchObject({
      id: 'e1',
      topic: 'dev.booking.events',
      v: 1,
      payload: { type: 'booking.confirmed' },
    });
    expect(bookingMsgs[0].headers['x-event-id']).toBe('e1');
    expect(bookingMsgs[0].headers['x-topic']).toBe('dev.booking.events');
    expect(bookingMsgs[0].headers['x-schema-ver']).toBe('1');

    // Đã xoá các row
    expect(prisma.outbox.deleteMany).toHaveBeenCalledTimes(1);
    const ids = (prisma.outbox.deleteMany as jest.Mock).mock.calls[0][0].where
      .id.in;
    expect(ids.sort()).toEqual(['e1', 'e2', 'e3'].sort());

    // Unlock đã được gọi
    expect(redis.del).toHaveBeenCalledWith('job:outbox:publish');
  });

  it('unlock khi producer.send ném lỗi', async () => {
    prisma.outbox.findMany.mockResolvedValueOnce([row({ id: 'ee' })]);
    producer.send.mockRejectedValueOnce(new Error('send fail'));

    await publisher.tick();

    // vẫn acquire + del
    expect(redis.set).toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('job:outbox:publish');
  });

  it('không làm gì nếu không có rows', async () => {
    prisma.outbox.findMany.mockResolvedValueOnce([]);
    await publisher.tick();

    expect(producer.send).not.toHaveBeenCalled();
    // vẫn acquire + del lock
    expect(redis.set).toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('job:outbox:publish');
  });
});
