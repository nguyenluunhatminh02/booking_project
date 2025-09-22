// src/modules/outbox/outbox.debug.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('debug/outbox')
export class OutboxDebugController {
  constructor(private prisma: PrismaService) {}
  @Get()
  async list(@Query('take') take = '20') {
    const n = Math.max(1, Math.min(200, parseInt(take as any, 10) || 20));
    const rows = await this.prisma.outbox.findMany({
      orderBy: { createdAt: 'desc' },
      take: n,
    });
    return rows.map((r) => ({
      id: r.id,
      topic: r.topic,
      createdAt: r.createdAt,
      payload: r.payload,
      v: 1,
    }));
  }
}
