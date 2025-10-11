import { DynamicModule, Module, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxProducer } from './outbox.producer';
import { OutboxPublisher } from './outbox.publisher';
import { OUTBOX_PRODUCER } from './outbox.tokens';
import type { KafkaProducerLike, KafkaMessageInput } from './types';
import { RedisService } from '../../common/redis.service';
import { logLevel } from 'kafkajs';
import { AppConfigService, KafkaConfig } from '../../config/app-config.service';

function buildConsoleProducer(): KafkaProducerLike {
  const logger = new Logger('OutboxConsole');
  return {
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    send: (topic: string, messages: KafkaMessageInput[]) => {
      for (const message of messages) {
        const headerText = message.headers
          ? ' ' +
            Object.entries(message.headers)
              .map(
                ([key, value]) =>
                  `${key}=${Buffer.isBuffer(value) ? value.toString('utf8') : value}`,
              )
              .join(' ')
          : '';
        logger.log(
          `[emit] topic=${topic} key=${message.key ?? ''} value=${message.value}${headerText}`,
        );
      }
      return Promise.resolve();
    },
  };
}

async function buildKafkaProducer(
  enabled: boolean,
  kafkaConfig: KafkaConfig,
): Promise<KafkaProducerLike> {
  if (!enabled || kafkaConfig.brokers.length === 0) {
    return buildConsoleProducer();
  }

  const { Kafka, Partitioners } = await import('kafkajs');

  const kafka = new Kafka({
    clientId: kafkaConfig.clientId,
    brokers: kafkaConfig.brokers,
    ssl: kafkaConfig.ssl || undefined,
    sasl: kafkaConfig.sasl as any,
    logLevel: logLevel.INFO,
  });

  const producer = kafka.producer({
    allowAutoTopicCreation: true,
    createPartitioner: Partitioners.LegacyPartitioner,
  });

  return {
    connect: () => producer.connect(),
    disconnect: () => producer.disconnect(),
    send: (topic: string, messages: KafkaMessageInput[]) =>
      producer.send({ topic, messages }),
  };
}

@Module({})
export class OutboxModule {
  static register(): DynamicModule {
    return {
      module: OutboxModule,
      providers: [
        PrismaService,
        RedisService,
        OutboxProducer,
        OutboxPublisher,
        {
          provide: OUTBOX_PRODUCER,
          useFactory: async (
            config: AppConfigService,
          ): Promise<KafkaProducerLike> => {
            try {
              const outboxCfg = config.outbox;
              return await buildKafkaProducer(
                outboxCfg.kafkaEnabled,
                config.kafka,
              );
            } catch (error) {
              void error;
              return buildConsoleProducer();
            }
          },
          inject: [AppConfigService],
        },
      ],
      exports: [OutboxProducer, OutboxPublisher],
    };
  }
}
