import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RawEnv } from './env.validation';

type SaslConfig =
  | {
      mechanism: string;
      username: string;
      password: string;
    }
  | undefined;

export type KafkaConfig = {
  topicPrefix: string;
  brokers: string[];
  clientId: string;
  ssl: boolean;
  sasl: SaslConfig;
  admin: {
    eventTopics: string[];
    numPartitions: number;
    replicationFactor: number;
  };
};

export type OutboxConfig = {
  kafkaEnabled: boolean;
  autostart: boolean;
  pollIntervalSec: number;
  batchSize: number;
  lockTtlSec: number;
};

export type CorsConfig = {
  allowedOrigins: string[];
};

export type ThrottleConfig = {
  messagingSend: { limit: number; ttlMs: number };
  messagingTyping: { limit: number; ttlMs: number };
};

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<RawEnv, true>) {}

  get nodeEnv(): 'development' | 'test' | 'production' {
    return this.config.get('NODE_ENV', { infer: true });
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get isTest(): boolean {
    return this.nodeEnv === 'test';
  }

  get port(): number {
    return this.config.get('PORT', { infer: true });
  }

  get cors(): CorsConfig {
    return {
      allowedOrigins: this.parseList(
        this.config.get('CORS_ORIGINS', { infer: true }),
      ),
    };
  }

  get cookieSecret(): string {
    return this.config.get('COOKIE_SECRET', { infer: true });
  }

  get inventoryTimezone(): string {
    return this.config.get('INVENTORY_TZ', { infer: true });
  }

  get bookingHoldMinutes(): number {
    return this.config.get('HOLD_MINUTES', { infer: true });
  }

  get autoDeclineHighRisk(): boolean {
    const raw = this.config.get('AUTO_DECLINE_HIGH');
    return raw ?? false;
  }

  get reviewHoldDays(): number {
    return this.config.get('REVIEW_HOLD_DAYS', { infer: true });
  }

  get kafka(): KafkaConfig {
    const topicPrefix = this.config.get('KAFKA_TOPIC_PREFIX', { infer: true });
    const brokers = this.parseList(
      this.config.get('KAFKA_BROKERS', { infer: true }),
    );
    const clientId = this.config.get('KAFKA_CLIENT_ID', { infer: true });
    const ssl = !!this.config.get('KAFKA_SSL');

    const mech = this.config.get('KAFKA_SASL_MECH');
    const username = this.config.get('KAFKA_SASL_USER');
    const password = this.config.get('KAFKA_SASL_PASS');
    const sasl: SaslConfig =
      mech && username && password
        ? { mechanism: mech, username, password }
        : undefined;

    const topicsRaw = this.config.get('EVENT_TOPICS');
    const eventTopics =
      typeof topicsRaw === 'string' && topicsRaw.trim().length > 0
        ? this.parseList(topicsRaw)
        : [
            'booking.held',
            'booking.expired',
            'booking.cancelled',
            'booking.refunded',
            'booking.paid',
            'booking.confirmed',
          ];

    const numPartitions = this.config.get('KAFKA_NUM_PARTITIONS', {
      infer: true,
    });
    const replicationFactor = this.config.get('KAFKA_REPLICATION_FACTOR', {
      infer: true,
    });

    return {
      topicPrefix,
      brokers,
      clientId,
      ssl,
      sasl,
      admin: {
        eventTopics,
        numPartitions,
        replicationFactor,
      },
    };
  }

  get outbox(): OutboxConfig {
    const kafkaDefault = !this.isTest;
    const kafkaEnabled = this.parseBool(
      this.config.get('OUTBOX_KAFKA'),
      kafkaDefault,
    );
    const autostart = this.parseBool(
      this.config.get('OUTBOX_AUTOSTART'),
      kafkaDefault,
    );
    const pollIntervalSec = this.config.get('OUTBOX_POLL_SEC', { infer: true });
    const batchSize = this.config.get('OUTBOX_BATCH', { infer: true });
    const lockTtlSec = this.config.get('OUTBOX_LOCK_TTL_SEC', { infer: true });

    return {
      kafkaEnabled,
      autostart,
      pollIntervalSec,
      batchSize,
      lockTtlSec,
    };
  }

  get throttle(): ThrottleConfig {
    const sendLimit = this.config.get('THROTTLE_INBOX_SEND_LIMIT', {
      infer: true,
    });
    const sendTtl =
      this.config.get('THROTTLE_INBOX_SEND_TTL_SEC', { infer: true }) * 1000;
    const typingLimit = this.config.get('THROTTLE_TYPING_LIMIT', {
      infer: true,
    });
    const typingTtl =
      this.config.get('THROTTLE_TYPING_TTL_SEC', { infer: true }) * 1000;

    return {
      messagingSend: { limit: sendLimit, ttlMs: sendTtl },
      messagingTyping: { limit: typingLimit, ttlMs: typingTtl },
    };
  }

  private parseBool(
    raw: string | boolean | number | undefined,
    fallback: boolean,
  ): boolean {
    if (raw === undefined) return fallback;
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw !== 0;
    const normalized = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
    return fallback;
  }

  private parseList(raw: string): string[] {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}
