import { OutboxProducer } from './outbox.producer';
import { topicName } from '../kafka/topicName';
import {
  AppConfigService,
  KafkaConfig,
  OutboxConfig,
} from '../../config/app-config.service';

function createConfigStub(prefix: string): AppConfigService {
  const kafka: KafkaConfig = {
    topicPrefix: prefix,
    brokers: [],
    clientId: 'test-client',
    ssl: false,
    sasl: undefined,
    admin: {
      eventTopics: [],
      numPartitions: 1,
      replicationFactor: 1,
    },
  };
  const outbox: OutboxConfig = {
    kafkaEnabled: false,
    autostart: false,
    pollIntervalSec: 5,
    batchSize: 200,
    lockTtlSec: 10,
  };

  return {
    kafka,
    outbox,
  } as unknown as AppConfigService;
}

describe('OutboxProducer', () => {
  const prisma: any = {
    outbox: {
      create: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('emit() → ghi 1 row outbox với topic/payload/eventKey', async () => {
    const config = createConfigStub('dev.');
    const svc = new OutboxProducer(prisma, config);
    await svc.emit('booking.events', { foo: 1 }, 'bk_123');

    expect(prisma.outbox.create).toHaveBeenCalledTimes(1);
    expect(prisma.outbox.create).toHaveBeenCalledWith({
      data: {
        topic: topicName('dev.', 'booking.events'),
        payload: { foo: 1 },
        eventKey: 'bk_123',
      },
    });
  });

  it('emitInTx() → dùng tx (TransactionClient) để ghi', async () => {
    const config = createConfigStub('dev.');
    const svc = new OutboxProducer(prisma, config);
    const tx = {
      outbox: {
        create: jest.fn(),
      },
    } as any;

    await svc.emitInTx(tx, 'booking.events', 'bk_999', { bar: 2 });

    expect(tx.outbox.create).toHaveBeenCalledTimes(1);
    expect(tx.outbox.create).toHaveBeenCalledWith({
      data: {
        topic: topicName('dev.', 'booking.events'),
        eventKey: 'bk_999',
        payload: { bar: 2 },
      },
    });
  });
});
