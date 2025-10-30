// src/modules/invoice/invoice.module.ts
import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';

@Module({
  controllers: [InvoiceController],
  providers: [InvoiceService, PrismaService, MailerService],
  exports: [InvoiceService],
})
export class InvoiceModule {}
