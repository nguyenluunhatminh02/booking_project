import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { BookingsAdminController } from './bookings.admin.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { FraudService } from '../fraud/fraud.service';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { FeatureFlagsService } from '../feature-flag/feature-flags.service';
import { RedisService } from 'src/common/redis.service';

@Module({
  imports: [IdempotencyModule],
  controllers: [BookingsController, BookingsAdminController],
  providers: [
    BookingsService,
    PrismaService,
    FraudService,
    FeatureFlagsService,
    RedisService,
  ],
  exports: [BookingsService],
})
export class BookingsModule {}
