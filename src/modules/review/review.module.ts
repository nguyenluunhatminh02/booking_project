import { Module } from '@nestjs/common';
import { ReviewService } from './review.service';
import { ReviewController } from './review.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { OutboxProducer } from '../outbox/outbox.producer';
import { ContentModerationService } from './content-moderation.service';

@Module({
  controllers: [ReviewController],
  providers: [
    ReviewService,
    PrismaService,
    IdempotencyService,
    OutboxProducer,
    ContentModerationService,
  ],
  exports: [ReviewService],
})
export class ReviewModule {}
