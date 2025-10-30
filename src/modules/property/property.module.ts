import { Module } from '@nestjs/common';
import { PropertyService } from './property.service';
import { PropertyController } from './property.controller';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  controllers: [PropertyController],
  providers: [PropertyService, PrismaService],
  exports: [PropertyService],
})
export class PropertyModule {}
