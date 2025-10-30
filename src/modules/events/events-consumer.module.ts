import { Global, Module } from '@nestjs/common';
import { EventsConsumerService } from './events-consumer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { KafkaModule } from '../kafka/kafka.module';
import { ConfigModule } from '@nestjs/config';

@Global()
@Module({
  imports: [KafkaModule, ConfigModule],
  providers: [EventsConsumerService, PrismaService, MailerService],
  exports: [EventsConsumerService],
})
export class EventsConsumerModule {}
