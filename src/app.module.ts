import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { APP_GUARD } from '@nestjs/core';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { TokenBucketService } from './common/token-bucket.service';
import { RedisService } from './common/redis.service';
import { SecurityModule } from './modules/security/security.module';

@Module({
  imports: [PrismaModule, AuthModule, SecurityModule],
  controllers: [AppController],
  providers: [
    AppService,
    TokenBucketService,
    RedisService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
