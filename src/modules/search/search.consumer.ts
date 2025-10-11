import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Kafka, logLevel, Consumer } from 'kafkajs';
import { SearchIndexerService } from './search.indexer.service';

const TOPICS = [
  'property.created',
  'property.updated',
  'property.deleted',
  'review.created',
  'review.updated',
  'review.deleted',
  'availability.updated',
];

@Injectable()
export class SearchConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SearchConsumer.name);
  private kafka?: Kafka;
  private consumer?: Consumer;

  constructor(private readonly indexer: SearchIndexerService) {}

  async onModuleInit() {
    if (process.env.SEARCH_CONSUMER_ENABLED !== '1') {
      this.logger.log('SEARCH_CONSUMER_ENABLED!=1 → skip consumer startup');
      return;
    }

    const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const groupId = process.env.SEARCH_CONSUMER_GROUP || 'search-indexer';
    const prefix = process.env.KAFKA_TOPIC_PREFIX || 'dev.';

    try {
      this.kafka = new Kafka({ brokers, logLevel: logLevel.ERROR });
      this.consumer = this.kafka.consumer({ groupId });

      await this.consumer.connect();
      for (const t of TOPICS.map((t) => `${prefix}${t}`)) {
        await this.consumer.subscribe({ topic: t, fromBeginning: false });
      }

      await this.consumer.run({
        eachMessage: async ({ topic, message }) => {
          try {
            await this.handle(topic, message);
          } catch (e: any) {
            this.logger.error(`search-consumer error: ${e?.message || e}`);
          }
        },
      });

      this.logger.log(`SearchConsumer subscribed: ${TOPICS.join(', ')}`);
    } catch (error: any) {
      this.logger.warn(
        `SearchConsumer disabled (Kafka unavailable): ${error?.message || error}`,
      );
      await this.consumer?.disconnect().catch(() => {});
      this.consumer = undefined;
      this.kafka = undefined;
    }
  }

  async onModuleDestroy() {
    await this.consumer?.disconnect().catch(() => {});
  }

  private async retry<T>(fn: () => Promise<T>, times = 3, delayMs = 500) {
    let last: any;
    for (let i = 0; i < times; i++) {
      try {
        return await fn();
      } catch (e) {
        last = e;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw last;
  }

  private async handle(topic: string, message: any) {
    const data = message.value
      ? JSON.parse(message.value.toString('utf8') || '{}')
      : {};
    const payload = data?.payload || {};
    const logical = topic.replace(
      /^.*?(property|review|availability)\./,
      (_m, p1) => `${p1}.`,
    );

    let propertyId: string | undefined;

    switch (logical) {
      case 'property.created':
      case 'property.updated':
        propertyId = payload.propertyId || payload.id || payload.aggregateId;
        if (propertyId)
          await this.retry(() => this.indexer.reindexProperty(propertyId!));
        break;
      case 'property.deleted':
        propertyId = payload.propertyId || payload.id || payload.aggregateId;
        if (propertyId)
          await this.retry(() => this.indexer.removeProperty(propertyId!));
        break;
      case 'review.created':
      case 'review.updated':
      case 'review.deleted':
        propertyId = payload.propertyId;
        if (propertyId)
          await this.retry(() => this.indexer.reindexProperty(propertyId!));
        break;
      case 'availability.updated':
        propertyId = payload.propertyId;
        if (propertyId)
          await this.retry(() => this.indexer.reindexProperty(propertyId!));
        break;
    }
  }
}
