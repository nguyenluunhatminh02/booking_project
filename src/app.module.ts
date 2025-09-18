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
import { CsrfController } from './common/controllers/csrf.controller';
import { CsrfMiddleware } from './common/middlewares/csrf.middleware';
import { HealthController } from './modules/health/health.controller';
import { DeviceFingerprintMiddleware } from './common/middlewares/finger-print.middleware';
import { DeviceFingerprintService } from './common/finger-print.service';
import { MailerModule } from './modules/mailer/mailer.module';
import { PropertyModule } from './modules/property/property.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    SecurityModule,
    RbacModule,
    LoggerModule,
    MfaModule,
    MailerModule,
    PropertyModule,
  ],
  controllers: [AppController, CsrfController, HealthController],
  providers: [
    AppService,
    TokenBucketService,
    RedisService,
    DeviceFingerprintService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes('*')
      .apply(XssMiddleware)
      .forRoutes('*')
      .apply(CsrfMiddleware)
      .forRoutes('*')
      .apply(DeviceFingerprintMiddleware)
      .forRoutes('*');
  }
}
