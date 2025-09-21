// src/modules/files/files.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
  ConflictException,
} from '@nestjs/common';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { MinioService } from './minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { randomUUID } from 'crypto';
import * as mime from 'mime-types';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'] as const;

class PresignUploadDto {
  @IsString()
  @IsNotEmpty()
  propertyId!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(ALLOWED as any)
  contentType!: (typeof ALLOWED)[number];
}

class AttachPhotoDto {
  @IsString()
  @IsNotEmpty()
  propertyId!: string;

  @IsString()
  @IsNotEmpty()
  objectKey!: string; // server’s key from step 1
}

class PresignDownloadDto {
  @IsString()
  @IsNotEmpty()
  objectKey!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('v1/files')
export class FilesController {
  constructor(
    private readonly minio: MinioService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('presign-upload')
  async presignUpload(@Body() dto: PresignUploadDto) {
    // TODO: verify property ownership (current user is host of dto.propertyId)
    const ext =
      mime.extension(dto.contentType) === 'jpeg'
        ? 'jpg'
        : mime.extension(dto.contentType) || 'bin';

    const objectKey = `properties/${dto.propertyId}/${randomUUID()}.${ext}`;

    await this.minio.ensureBucket();
    const expires = +(process.env.PRESIGNED_EXPIRES_SEC || 600);
    const url = await this.minio.presignedPutStrict(
      objectKey,
      dto.contentType,
      expires,
    );

    return {
      objectKey,
      putUrl: url,
      requiredHeaders: { 'Content-Type': dto.contentType },
      expiresInSec: expires,
      maxBytes: +(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024),
    };
  }

  @Post('attach-photo')
  @HttpCode(201)
  async attachPhoto(@Body() dto: AttachPhotoDto) {
    // Verify prefix to prevent cross-property attach
    const expectedPrefix = `properties/${dto.propertyId}/`;
    if (!dto.objectKey.startsWith(expectedPrefix)) {
      throw new BadRequestException('objectKey mismatch propertyId');
    }

    // 1) Validate uploaded object (size + magic bytes)
    let size = 0;
    let sniffMime = '';
    try {
      const res = await this.minio.validateUploaded(dto.objectKey);
      size = res.size;
      sniffMime = res.mime || '';
    } catch (err: any) {
      // validateUploaded đã xoá object nếu fail
      throw new BadRequestException(err?.message || 'Invalid upload');
    }

    // 2) Persist to DB (idempotent by unique (bucket, objectKey))
    try {
      const photo = await this.prisma.photo.create({
        data: {
          propertyId: dto.propertyId,
          bucket: this.minio.bucket,
          objectKey: dto.objectKey,
          // optional meta columns if you have:
          // mime: sniffMime,
          // size,
        } as any,
      });
      return { ...photo, mime: sniffMime, size };
    } catch (e: any) {
      if (e?.code === 'P2002') {
        // unique violation (already attached) → tùy chọn trả 200 hay 409
        throw new ConflictException('Photo already attached');
      }
      throw e;
    }
  }

  @Post('presign-download')
  async presignDownload(@Body() dto: PresignDownloadDto) {
    // (optional) verify objectKey belongs to requester’s property
    const url = await this.minio.presignedGet(
      dto.objectKey,
      +(process.env.PRESIGNED_EXPIRES_SEC || 600),
    );
    return { url, method: 'GET' };
  }
}
