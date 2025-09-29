// src/modules/outbox/outbox.module.ts
import { DynamicModule, Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxProducer } from './outbox.producer';
import { OutboxPublisher } from './outbox.publisher';
import {
  OUTBOX_PRODUCER,
  OUTBOX_AUTOSTART,
  OUTBOX_KAFKA_ENABLED,
} from './outbox.tokens';
import type { KafkaProducerLike, KafkaMessageInput } from './types';
// ⚠ path này tùy dự án bạn: nếu alias "src/*" chưa map trong tsconfig, đổi thành '../../common/redis.service'
import { RedisService } from '../../common/redis.service';
import { logLevel } from 'kafkajs';

function buildConsoleProducer(): KafkaProducerLike {
  const { Logger } = require('@nestjs/common');
  const logger = new Logger('OutboxConsole');
  return {
    async connect() {},
    async disconnect() {},
    async send(topic, messages) {
      for (const m of messages) {
        const h = m.headers
          ? ' ' +
            Object.entries(m.headers)
              .map(
                ([k, v]) =>
                  `${k}=${Buffer.isBuffer(v) ? v.toString('utf8') : v}`,
              )
              .join(' ')
          : '';
        logger.log(
          `[emit] topic=${topic} key=${m.key ?? ''} value=${m.value}${h}`,
        );
      }
    },
  };
}

async function buildKafkaProducer(
  enabled: boolean,
): Promise<KafkaProducerLike> {
  // Nếu disabled (ví dụ test), luôn dùng console producer
  if (!enabled) return buildConsoleProducer();

  const brokersEnv = process.env.KAFKA_BROKERS;
  if (!brokersEnv) return buildConsoleProducer();

  const { Kafka, Partitioners } = await import('kafkajs');
  const ssl = (process.env.KAFKA_SSL || '0') === '1' ? true : undefined;
  const sasl =
    process.env.KAFKA_SASL_MECH &&
    process.env.KAFKA_SASL_USER &&
    process.env.KAFKA_SASL_PASS
      ? {
          mechanism: process.env.KAFKA_SASL_MECH as any,
          username: process.env.KAFKA_SASL_USER,
          password: process.env.KAFKA_SASL_PASS,
        }
      : undefined;

  const kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID || 'booking-api',
    brokers: brokersEnv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    ssl,
    sasl,
    logLevel: logLevel.INFO,
  });

  // Dùng legacy partitioner để khỏi warning v2
  const producer = kafka.producer({
    allowAutoTopicCreation: true,
    createPartitioner: Partitioners.LegacyPartitioner,
  });

  return {
    connect: () => producer.connect(),
    disconnect: () => producer.disconnect(),
    send: async (topic, messages: KafkaMessageInput[]) => {
      await producer.send({ topic, messages });
    },
  };
}

@Module({})
export class OutboxModule {
  static register(): DynamicModule {
    // Flag mặc định: trong test => OFF; còn lại => ON
    const kafkaEnabled =
      (process.env.OUTBOX_KAFKA ??
        (process.env.NODE_ENV === 'test' ? '0' : '1')) === '1';
    const autostart =
      (process.env.OUTBOX_AUTOSTART ??
        (process.env.NODE_ENV === 'test' ? '0' : '1')) === '1';

    return {
      module: OutboxModule,
      providers: [
        PrismaService,
        RedisService,
        OutboxProducer,
        OutboxPublisher, // lớp này sẽ inject OUTBOX_PRODUCER + 2 flags
        { provide: OUTBOX_KAFKA_ENABLED, useValue: kafkaEnabled },
        { provide: OUTBOX_AUTOSTART, useValue: autostart },
        {
          provide: OUTBOX_PRODUCER,
          useFactory: async (enabled: boolean): Promise<KafkaProducerLike> => {
            try {
              return await buildKafkaProducer(enabled);
            } catch (err: any) {
              // Nếu Kafka lỗi khi build, degrade sang console để không phá app/test
              return buildConsoleProducer();
            }
          },
          inject: [OUTBOX_KAFKA_ENABLED],
        },
      ],
      exports: [OutboxProducer, OutboxPublisher],
    };
  }
}
