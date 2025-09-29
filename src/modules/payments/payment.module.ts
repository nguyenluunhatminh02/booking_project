import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { PaymentWebhookController } from './payment.webhook.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { OutboxProducer } from '../outbox/outbox.producer';
import { StripeLikeHmacAdapter } from './providers/stripelike.adapter';
import { MockProviderAdapter } from './providers/mock.adapter';
import { VnpayAdapter } from './providers/vnpay.adapter';

@Module({
  controllers: [PaymentController, PaymentWebhookController],
  providers: [
    PaymentService,
    PrismaService,
    IdempotencyService,
    OutboxProducer,
    StripeLikeHmacAdapter,
    MockProviderAdapter,
    VnpayAdapter,
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
