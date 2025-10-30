import { Module } from '@nestjs/common';
import { FraudService } from './fraud.service';
import { FraudController } from './fraud.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { FeatureFlagsService } from '../feature-flag/feature-flags.service';
import { RedisService } from '../../common/redis.service';

@Module({
  controllers: [FraudController],
  providers: [FraudService, PrismaService, FeatureFlagsService, RedisService],
  exports: [FraudService],
})
export class FraudModule {}
