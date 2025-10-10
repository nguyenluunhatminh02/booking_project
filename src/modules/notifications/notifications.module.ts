import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsScheduler } from './notifications.scheduler';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxProducer } from '../outbox/outbox.producer';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsScheduler,
    PrismaService,
    OutboxProducer,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
