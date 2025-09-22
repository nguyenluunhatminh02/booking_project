import { Controller, Get, Post } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxPublisher } from './outbox.publisher';

@Controller('outbox')
export class OutboxController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pub: OutboxPublisher,
  ) {}

  @Get('health')
  async health() {
    const pending = await this.prisma.outbox.count();
    return {
      pending,
      pollSec: Number(process.env.OUTBOX_POLL_SEC || 5),
      batch: Number(process.env.OUTBOX_BATCH || 200),
      autostart: (process.env.OUTBOX_AUTOSTART || '0') === '1',
    };
  }

  @Post('tick')
  async tick() {
    await this.pub.tick();
    const pending = await this.prisma.outbox.count();
    return { ok: true, pending };
  }
}
