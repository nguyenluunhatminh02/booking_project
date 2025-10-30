// src/security/security.module.ts
import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { SecurityEventsService } from './security-events.service';

@Module({
  providers: [PrismaService, SecurityEventsService],
  exports: [SecurityEventsService],
})
export class SecurityModule {}
