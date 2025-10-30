// src/idempotency/idempotency.cleanup.ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class IdemCleanup {
  constructor(private prisma: PrismaService) {}
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweep() {
    await this.prisma.idempotency.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }
}
