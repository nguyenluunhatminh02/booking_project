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
import { AnonIdMiddleware } from './common/middlewares/anon-id.middleware';
import { FeatureFlagsModule } from './modules/feature-flag/feature-flags.module';
import { BookingsModule } from './modules/booking/bookings.module';
import { IdempotencyModule } from './modules/idempotency/idempotency.module';
import { FraudModule } from './modules/fraud/fraud.module';
import { DemoController } from './modules/demo/demo.controller';
import { FeatureFlagsService } from './modules/feature-flag/feature-flags.service';
import { FilesModule } from './modules/file/files.module';
import { ScheduleModule } from '@nestjs/schedule';
import { JobsModule } from './modules/job/jobs.module';
import { OutboxModule } from './modules/outbox/outbox.module';

@Module({
  imports: [
    OutboxModule.register(),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    SecurityModule,
    RbacModule,
    LoggerModule,
    MfaModule,
    MailerModule,
    PropertyModule,
    FeatureFlagsModule,
    BookingsModule,
    IdempotencyModule,
    FraudModule,
    FilesModule,
    JobsModule,
  ],
  controllers: [
    AppController,
    CsrfController,
    HealthController,
    DemoController,
  ],
  providers: [
    AppService,
    TokenBucketService,
    RedisService,
    FeatureFlagsService,
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
      .forRoutes('*')
      .apply(AnonIdMiddleware)
      .forRoutes('landing');
  }
}
