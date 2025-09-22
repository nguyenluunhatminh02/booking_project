// src/modules/booking/expire.task.spec.ts
import { Test } from '@nestjs/testing';
import { ExpireTask } from './expire.task';
import { RedisService } from '../../common/redis.service';
import { BookingsService } from '../booking/bookings.service';

describe('ExpireTask', () => {
  it('calls bookings.expireHolds and logs count', async () => {
    const bookings = {
      expireHolds: jest.fn().mockResolvedValue({ expired: 2 }),
    };
    const redis = {
      enabled: true,
      set: jest.fn().mockResolvedValue('OK'), // acquired
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
    };

    const mod = await Test.createTestingModule({
      providers: [
        ExpireTask,
        { provide: BookingsService, useValue: bookings },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    const task = mod.get(ExpireTask);
    await task.handle();

    expect(bookings.expireHolds).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalled(); // lock called
    expect(redis.del).toHaveBeenCalled(); // unlock called
  });

  it('skips if lock not acquired', async () => {
    const bookings = { expireHolds: jest.fn() };
    const redis = {
      enabled: true,
      set: jest.fn().mockResolvedValue(null), // not acquired
    };

    const mod = await Test.createTestingModule({
      providers: [
        ExpireTask,
        { provide: BookingsService, useValue: bookings },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    const task = mod.get(ExpireTask);
    await task.handle();

    expect(bookings.expireHolds).not.toHaveBeenCalled();
  });
});
