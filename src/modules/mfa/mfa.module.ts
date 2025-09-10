import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { MfaService } from './mfa.service';
import { MfaController } from './mfa.controller';
import { AuditLogService } from '../audit/audit-log.service';
import { TokenStateService } from '../auth/token-state.service';
import { RedisService } from 'src/common/redis.service';

@Module({
  providers: [
    PrismaService,
    MfaService,
    AuditLogService,
    TokenStateService,
    RedisService,
  ],
  controllers: [MfaController],
  exports: [MfaService],
})
export class MfaModule {}
