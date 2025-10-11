import { z } from 'zod';

const boolLike = z
  .union([z.string(), z.boolean(), z.number()])
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const normalized = value.toString().trim().toLowerCase();
    if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
    return undefined;
  })
  .optional();

/**
 * Validate raw environment variables. Do not use zod.url() for DATABASE_URL
 * because PostgreSQL URIs do not conform to http/https.
 */
export const RawEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SHADOW_DATABASE_URL: z.string().min(1).optional(),

  // Inventory / booking
  INVENTORY_TZ: z.string().default('Asia/Ho_Chi_Minh'),
  HOLD_MINUTES: z.coerce.number().int().min(1).max(180).default(15),
  AUTO_DECLINE_HIGH: boolLike,
  REVIEW_HOLD_DAYS: z.coerce.number().int().min(1).max(14).default(1),

  // Web security
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  COOKIE_SECRET: z.string().default('dev-cookie'),

  // Kafka / Outbox
  KAFKA_TOPIC_PREFIX: z.string().default(''),
  KAFKA_BROKERS: z.string().default('localhost:9094'),
  KAFKA_CLIENT_ID: z.string().default('booking-api'),
  KAFKA_SSL: boolLike,
  KAFKA_SASL_MECH: z.string().optional(),
  KAFKA_SASL_USER: z.string().optional(),
  KAFKA_SASL_PASS: z.string().optional(),
  KAFKA_NUM_PARTITIONS: z.coerce.number().int().positive().default(3),
  KAFKA_REPLICATION_FACTOR: z.coerce.number().int().positive().default(1),
  EVENT_TOPICS: z.string().optional(),

  OUTBOX_AUTOSTART: boolLike,
  OUTBOX_KAFKA: boolLike,
  OUTBOX_POLL_SEC: z.coerce.number().int().positive().default(5),
  OUTBOX_BATCH: z.coerce.number().int().positive().default(200),
  OUTBOX_LOCK_TTL_SEC: z.coerce.number().int().positive().default(10),

  // Throttling
  THROTTLE_INBOX_SEND_LIMIT: z.coerce.number().int().positive().default(30),
  THROTTLE_INBOX_SEND_TTL_SEC: z.coerce.number().int().positive().default(60),
  THROTTLE_TYPING_LIMIT: z.coerce.number().int().positive().default(60),
  THROTTLE_TYPING_TTL_SEC: z.coerce.number().int().positive().default(60),
});

export type RawEnv = z.infer<typeof RawEnvSchema>;

export function validateEnv(config: Record<string, unknown>): RawEnv {
  const parsed = RawEnvSchema.safeParse(config);
  if (!parsed.success) {
    const pretty = parsed.error.format();
    console.error(
      '❌ Invalid environment variables:',
      JSON.stringify(pretty, null, 2),
    );
    throw new Error('Invalid environment variables');
  }
  return parsed.data;
}

let cached: RawEnv | null = null;

export default function env(): RawEnv {
  if (cached) return cached;
  cached = validateEnv(process.env);
  return cached;
}

export function __resetEnvCacheForTests() {
  cached = null;
}
