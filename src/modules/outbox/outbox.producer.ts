import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { topicName } from '../kafka/topicName';

type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class OutboxProducer {
  constructor(private readonly prisma: PrismaService) {}

  async emit(topic: string, payload: any, eventKey?: string) {
    // ✅ Tự động thêm prefix
    const finalTopic = topicName(process.env.KAFKA_TOPIC_PREFIX ?? '', topic);
    return this.prisma.outbox.create({
      data: { topic: finalTopic, payload, eventKey: eventKey ?? null },
    });
  }

  async emitInTx(
    tx: PrismaTx,
    topic: string,
    eventKey: string | null,
    payload: any,
  ) {
    // ✅ Tự động thêm prefix
    const finalTopic = topicName(process.env.KAFKA_TOPIC_PREFIX ?? '', topic);
    return tx.outbox.create({ data: { topic: finalTopic, eventKey, payload } });
  }
}
