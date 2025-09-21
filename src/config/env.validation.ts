// src/config/env.validation.ts
import { z } from 'zod';

/**
 * Validate raw env vars. Không dùng zod.url() cho DATABASE_URL vì
 * PostgreSQL URI không phải http/https.
 */
const RawEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SHADOW_DATABASE_URL: z.string().min(1).optional(),

  // Timezone để bucket lịch/booking
  INVENTORY_TZ: z.string().default('Asia/Ho_Chi_Minh'),

  // Thời gian giữ HOLD (phút)
  HOLD_MINUTES: z.coerce.number().int().min(1).max(180).default(15),

  // --- MỚI: cấu hình cho wantReview ---
  // Tự động từ chối nếu risk HIGH (không trừ kho), phát outbox booking.auto_declined
  AUTO_DECLINE_HIGH: z.coerce.boolean().default(false),

  // Số ngày tiếp tục giữ HOLD sau khi reviewer APPROVE (đặt deadline)
  REVIEW_HOLD_DAYS: z.coerce.number().int().min(1).max(14).default(1),

  // (Tuỳ chọn) bật/tắt fraud mặc định qua flag hệ thống
  // FRAUD_CHECK_DEFAULT: z.coerce.boolean().default(true),
});

export type AppEnv = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;

  dbUrl: string;
  shadowDbUrl?: string;

  inventoryTz: string;
  holdMinutes: number;

  // --- MỚI ---
  autoDeclineHigh: boolean;
  reviewHoldDaysDefault: number;

  // fraudDefault?: boolean;
};

let cached: AppEnv | null = null;

/**
 * Đọc + validate 1 lần, cache kết quả (an toàn để gọi ở bất kỳ service nào).
 */
export default function env(): AppEnv {
  if (cached) return cached;

  const parsed = RawEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // In lỗi gọn gàng để dễ debug khi thiếu env
    const pretty = parsed.error.format();
    console.error(
      '❌ Invalid environment variables:',
      JSON.stringify(pretty, null, 2),
    );
    throw new Error('Invalid environment variables');
  }

  const e = parsed.data;

  cached = {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,

    dbUrl: e.DATABASE_URL,
    shadowDbUrl: e.SHADOW_DATABASE_URL,

    inventoryTz: e.INVENTORY_TZ,
    holdMinutes: e.HOLD_MINUTES,

    // --- MỚI ---
    autoDeclineHigh: e.AUTO_DECLINE_HIGH,
    reviewHoldDaysDefault: e.REVIEW_HOLD_DAYS,

    // fraudDefault: e.FRAUD_CHECK_DEFAULT,
  };

  return cached;
}

/**
 * (Tuỳ chọn) dùng cho unit test để reset cache giữa các test cases.
 */
export function __resetEnvCacheForTests() {
  cached = null;
}
