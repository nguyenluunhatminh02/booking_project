import { Module } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlagsController } from './feature-flags.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/common/redis.service';

@Module({
  providers: [FeatureFlagsService, PrismaService, RedisService],
  controllers: [FeatureFlagsController],
})
export class FeatureFlagsModule {}
