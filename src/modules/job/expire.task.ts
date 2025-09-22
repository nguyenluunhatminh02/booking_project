// src/modules/job/expire.task.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingsService } from '../booking/bookings.service';
import { RedisService } from 'src/common/redis.service';

// RedisService của bạn cần có .set(key, val, { ttlSec, nx }) và .del(key)

@Injectable()
export class ExpireTask {
  private readonly logger = new Logger(ExpireTask.name);
  private static readonly LOCK_KEY = 'job:expire-holds';
  private static readonly LOCK_TTL_SEC = 55; // job mỗi phút ⇒ TTL < 60s

  constructor(
    private readonly bookings: BookingsService,
    private readonly redis: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handle() {
    // cố gắng lấy lock 1-phút-1-lần
    const got = await this.redis.set(ExpireTask.LOCK_KEY, '1', {
      ttlSec: ExpireTask.LOCK_TTL_SEC,
      nx: true, // only-if-not-exists
    });

    // không lấy được lock ⇒ có task khác đang chạy
    if (!got) return;

    try {
      const { expired } = await this.bookings.expireHolds(new Date());
      if (expired) this.logger.log(`Expired holds: ${expired}`);
    } catch (err) {
      this.logger.error('ExpireTask failed', err);
      // vẫn rơi xuống finally để mở khóa
    } finally {
      // QUAN TRỌNG: luôn mở khóa để test pass .del()
      await this.redis.del(ExpireTask.LOCK_KEY);
    }
  }
}
