import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis.service';
import { z } from 'zod';

export type FlagRecord = {
  key: string;
  enabled: boolean;
  payload: any;
  updatedAt?: Date;
};

// Zod schema để chặt chẽ payload
const RolloutSchema = z.object({
  rollout: z.number().min(0).max(100).optional(),
  salt: z.string().optional(),
  allowUsers: z.array(z.string()).optional(),
  denyUsers: z.array(z.string()).optional(),
});

@Injectable()
export class FeatureFlagsService {
  private ttlSec = +(process.env.FEATURE_FLAG_TTL_SEC || 30);
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  private rk(key: string) {
    return `ff:${key}`;
  }

  /** Get from Redis (cached) → DB fallback */
  async get(key: string): Promise<{ enabled: boolean; payload: any }> {
    // cache
    const cached = await this.redis.get(this.rk(key));
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        /* ignore malformed cache */
      }
    }

    // db
    const row = await this.prisma.featureFlag.findUnique({
      where: { key },
      select: { enabled: true, payload: true },
    });

    // validate payload (fail-safe → null)
    let payload: any = row?.payload ?? null;
    try {
      if (payload != null) payload = RolloutSchema.parse(payload);
    } catch {
      payload = null;
    }

    const val = { enabled: !!row?.enabled, payload };

    // set cache với jitter ±20% để tránh thundering herd
    const jitter = Math.max(
      5,
      Math.floor(this.ttlSec * (0.8 + Math.random() * 0.4)),
    );
    await this.redis.setEx(this.rk(key), JSON.stringify(val), jitter);

    return val;
  }

  /** Raw DB (no cache) — useful for admin view */
  async getRaw(key: string): Promise<FlagRecord | null> {
    const row = await this.prisma.featureFlag.findUnique({
      where: { key },
      select: { key: true, enabled: true, payload: true, updatedAt: true },
    });
    return row ? { ...row } : null;
  }

  async isEnabled(key: string): Promise<boolean> {
    const v = await this.get(key);
    return !!v.enabled;
  }

  async upsert(
    key: string,
    enabled: boolean,
    payload?: any,
  ): Promise<FlagRecord> {
    const row = await this.prisma.featureFlag.upsert({
      where: { key },
      update: { enabled, payload },
      create: { key, enabled, payload },
      select: { key: true, enabled: true, payload: true, updatedAt: true },
    });
    // invalidate cache
    await this.redis.del(this.rk(key));
    return row;
  }
}
