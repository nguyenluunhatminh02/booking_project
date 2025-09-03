import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { APP_GUARD } from '@nestjs/core';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { TokenBucketService } from './common/token-bucket.service';
import { RedisService } from './common/redis.service';
import { SecurityModule } from './modules/security/security.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { LoggerModule } from './logger/logger.module';
import { RequestContextMiddleware } from './common/middlewares/request-context.middleware';
import { MfaModule } from './modules/mfa/mfa.module';
import { XssMiddleware } from './common/middlewares/xss.middleware';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    SecurityModule,
    RbacModule,
    LoggerModule,
    MfaModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    TokenBucketService,
    RedisService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes('*')
      .apply(XssMiddleware)
      .forRoutes('*');
  }
}
