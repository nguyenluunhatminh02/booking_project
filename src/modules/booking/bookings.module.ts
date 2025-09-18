import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { BookingsAdminController } from './bookings.admin.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { FraudService } from '../fraud/fraud.service';
import { IdempotencyModule } from '../idempotency/idempotency.module';

@Module({
  imports: [IdempotencyModule],
  controllers: [BookingsController, BookingsAdminController],
  providers: [BookingsService, PrismaService, FraudService],
  exports: [BookingsService],
})
export class BookingsModule {}
