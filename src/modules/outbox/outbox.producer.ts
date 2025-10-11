import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { topicName } from '../kafka/topicName';
import { AppConfigService } from '../../config/app-config.service';

type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class OutboxProducer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  private resolveTopic(topic: string): string {
    return topicName(this.config.kafka.topicPrefix, topic);
  }

  async emit(topic: string, payload: any, eventKey?: string) {
    const finalTopic = this.resolveTopic(topic);
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
    const finalTopic = this.resolveTopic(topic);
    return tx.outbox.create({ data: { topic: finalTopic, eventKey, payload } });
  }
}
