import { Module, OnModuleInit, Injectable } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ThumbnailService } from './thumbnail.service';
import { MinioService } from './minio.service';
import { AntivirusService } from './antivirus.service';
import { OutboxProducer } from '../outbox/outbox.producer';

@Injectable()
class MinioBootstrap implements OnModuleInit {
  constructor(private minio: MinioService) {}
  async onModuleInit() {
    if (!this.minio.bootstrapEnabled) return;
    // Đảm bảo bucket tồn tại (không throw để không chặn boot)
    await this.minio.ensureBucketSafe().catch(() => undefined);
  }
}

@Module({
  controllers: [FilesController],
  providers: [
    FilesService,
    PrismaService,
    ThumbnailService,
    MinioService,
    MinioBootstrap,
    AntivirusService,
    OutboxProducer,
  ],
  exports: [FilesService, ThumbnailService],
})
export class FilesModule {}
