import { Module } from '@nestjs/common';
import { ExpireTask } from './expire.task';
import { BookingsModule } from '../booking/bookings.module';
import { RedisService } from 'src/common/redis.service';

@Module({
  imports: [BookingsModule],
  providers: [ExpireTask, RedisService],
})
export class JobsModule {}
