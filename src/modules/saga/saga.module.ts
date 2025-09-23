import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PromotionService } from '../promotion/promotion.service';
import { InvoiceService } from '../invoice/invoice.service';
import { MailerService } from '../mailer/mailer.service';
import { OutboxModule } from '../outbox/outbox.module';
import { SagaCoordinator } from './saga.coordinator';
import { EventsConsumerService } from './events-consumer.service';
// Nếu InvoiceService phụ thuộc module khác (vd. FileModule), import thêm ở đây.

@Module({
  imports: [
    OutboxModule.register(), // để Invoice/Promotion có OutboxProducer
  ],
  providers: [
    PrismaService,
    MailerService,
    PromotionService,
    InvoiceService,
    SagaCoordinator,
    EventsConsumerService,
  ],
  exports: [SagaCoordinator],
})
export class SagaModule {}
