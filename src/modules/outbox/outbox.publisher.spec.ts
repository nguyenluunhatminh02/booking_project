import { OutboxPublisher } from './outbox.publisher';
import {
  AppConfigService,
  KafkaConfig,
  OutboxConfig,
} from '../../config/app-config.service';

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

function createConfigStub(overrides?: {
  kafka?: Partial<KafkaConfig>;
  outbox?: Partial<OutboxConfig>;
}): AppConfigService {
  const kafka: KafkaConfig = {
    topicPrefix: 'dev.',
    brokers: [],
    clientId: 'test-client',
    ssl: false,
    sasl: undefined,
    admin: {
      eventTopics: [],
      numPartitions: 1,
      replicationFactor: 1,
    },
    ...overrides?.kafka,
  };

  const outbox: OutboxConfig = {
    kafkaEnabled: false,
    autostart: false,
    pollIntervalSec: 1,
    batchSize: 200,
    lockTtlSec: 10,
    ...overrides?.outbox,
  };

  return {
    kafka,
    outbox,
  } as unknown as AppConfigService;
}

const prisma: any = {
  outbox: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn(),
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

let publisher: OutboxPublisher;

describe('OutboxPublisher (unit)', () => {
  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.outbox.deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    redis.set.mockResolvedValue(true);
    redis.del.mockResolvedValue(1);

    const config = createConfigStub();
    publisher = new OutboxPublisher(prisma, redis, producer as any, config);

    await publisher.onModuleInit();
  });

  afterEach(async () => {
    await publisher.onModuleDestroy();
  });

  it('skip khi khÃ´ng acquire Ä‘Æ°á»£c Redis lock', async () => {
    redis.set.mockResolvedValueOnce(false);
    await publisher.tick();

    expect(producer.send).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('group theo topic vÃ  gá»­i headers + envelope chuáº©n, sau Ä‘Ã³ deleteMany', async () => {
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

    expect(producer.send).toHaveBeenCalledTimes(2);

    const calls = producer.send.mock.calls;
    const topics = calls.map(([t]: [string, any]) => t).sort();
    expect(topics).toEqual(
      ['dev.booking.events', 'dev.inventory.events'].sort(),
    );

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

    expect(prisma.outbox.deleteMany).toHaveBeenCalledTimes(1);
    const ids = (prisma.outbox.deleteMany as jest.Mock).mock.calls[0][0].where
      .id.in;
    expect(ids.sort()).toEqual(['e1', 'e2', 'e3'].sort());

    expect(redis.del).toHaveBeenCalledWith('job:outbox:publish');
  });

  it('unlock khi producer.send nÃ©m lá»—i', async () => {
    prisma.outbox.findMany.mockResolvedValueOnce([row({ id: 'ee' })]);
    producer.send.mockRejectedValueOnce(new Error('send fail'));

    await publisher.tick();

    expect(redis.set).toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('job:outbox:publish');
  });

  it('khÃ´ng lÃ m gÃ¬ náº¿u khÃ´ng cÃ³ rows', async () => {
    prisma.outbox.findMany.mockResolvedValueOnce([]);
    await publisher.tick();

    expect(producer.send).not.toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('job:outbox:publish');
  });
});
