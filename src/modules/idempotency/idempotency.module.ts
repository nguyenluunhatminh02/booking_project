// src/idempotency/idempotency.module.ts
import { Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { IdemCleanup } from './idempotency.cleanup';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [PrismaService, IdempotencyService, IdemCleanup],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
