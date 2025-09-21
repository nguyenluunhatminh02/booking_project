import { Module } from '@nestjs/common';
import { PromotionController } from './promotion.controller';
import { PromotionService } from './promotion.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [PromotionController],
  providers: [PromotionService, PrismaService], // dùng trực tiếp PrismaService
  exports: [PromotionService],
})
export class PromotionModule {}
