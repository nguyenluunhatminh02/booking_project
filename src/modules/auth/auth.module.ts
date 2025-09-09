// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/common/redis.service';
import { TokenBucketService } from 'src/common/token-bucket.service';
import { TokenStateService } from './token-state.service';
import { JwtAccessStrategy } from './strategy/jwt.strategy';
import { SecurityEventsService } from '../security/security-events.service';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import { AuditLogService } from '../audit/audit-log.service';
import { DeviceApprovalService } from './device-approval.service';
import { JwtAuthGuard } from './guards/jwt.guard';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET || 'dev-access',
      signOptions: {
        expiresIn: process.env.JWT_ACCESS_TTL || '15m',
        issuer: process.env.JWT_ISSUER || 'booking-api',
        audience: process.env.JWT_AUDIENCE || 'booking-fe',
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAccessStrategy,
    JwtAuthGuard,
    PrismaService,
    RedisService,
    TokenBucketService,
    TokenStateService,
    SecurityEventsService,
    AuditLogService,
    DeviceApprovalService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [JwtAuthGuard, JwtAccessStrategy],
})
export class AuthModule {}
