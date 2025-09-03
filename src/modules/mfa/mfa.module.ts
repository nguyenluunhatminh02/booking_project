import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { MfaService } from './mfa.service';
import { MfaController } from './mfa.controller';
import { AuditLogService } from '../audit/audit-log.service';

@Module({
  providers: [PrismaService, MfaService, AuditLogService],
  controllers: [MfaController],
  exports: [MfaService],
})
export class MfaModule {}
