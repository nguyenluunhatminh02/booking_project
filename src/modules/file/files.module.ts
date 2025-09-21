// src/modules/files/files.module.ts
import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { MinioService } from './minio.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  controllers: [FilesController],
  providers: [MinioService, PrismaService],
  exports: [MinioService],
})
export class FilesModule {}
