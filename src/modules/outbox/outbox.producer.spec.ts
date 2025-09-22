import { OutboxProducer } from './outbox.producer';

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
    const svc = new OutboxProducer(prisma);
    await svc.emit('booking.events', { foo: 1 }, 'bk_123');

    expect(prisma.outbox.create).toHaveBeenCalledTimes(1);
    expect(prisma.outbox.create).toHaveBeenCalledWith({
      data: {
        topic: 'booking.events',
        payload: { foo: 1 },
        eventKey: 'bk_123',
      },
    });
  });

  it('emitInTx() → dùng tx (TransactionClient) để ghi', async () => {
    const svc = new OutboxProducer(prisma);
    const tx = {
      outbox: {
        create: jest.fn(),
      },
    } as any;

    await svc.emitInTx(tx, 'booking.events', 'bk_999', { bar: 2 });

    expect(tx.outbox.create).toHaveBeenCalledTimes(1);
    expect(tx.outbox.create).toHaveBeenCalledWith({
      data: {
        topic: 'booking.events',
        eventKey: 'bk_999',
        payload: { bar: 2 },
      },
    });
  });
});
