import { Global, Module } from '@nestjs/common';
import { EventsConsumerService } from './events-consumer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';

@Global()
@Module({
  providers: [EventsConsumerService, PrismaService, MailerService],
  exports: [EventsConsumerService],
})
export class EventsConsumerModule {}
