import { Module } from '@nestjs/common';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxProducer } from '../outbox/outbox.producer';

@Module({
  controllers: [MessagingController],
  providers: [MessagingService, PrismaService, OutboxProducer],
  exports: [MessagingService],
})
export class MessagingModule {}
