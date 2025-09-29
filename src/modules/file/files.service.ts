import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from './minio.service';
import sharp from 'sharp';
import { OutboxProducer } from '../outbox/outbox.producer';

function sanitizeName(s: string) {
  return (s || '').replace(/[^a-zA-Z0-9._-]/g, '_');
}
function trimSlashes(s?: string) {
  if (!s) return '';
  return s.replace(/^\/+|\/+$/g, '');
}
function publicUrlFromKey(key: string): string {
  const prefix = (process.env.MINIO_PUBLIC_URL_PREFIX || '').replace(
    /\/+$/,
    '',
  );
  if (prefix) return `${prefix}/${encodeURI(key)}`;
  const endPoint = process.env.MINIO_END_POINT || 'localhost';
  const port = +(process.env.MINIO_PORT || 9000);
  const useSSL = (process.env.MINIO_USE_SSL || 'false') === 'true';
  const bucket = process.env.MINIO_BUCKET || 'booking-uploads';
  const base = `${useSSL ? 'https' : 'http'}://${endPoint}${port ? `:${port}` : ''}/${bucket}`;
  return `${base}/${encodeURI(key)}`;
}

@Injectable()
export class FilesService {
  constructor(
    private prisma: PrismaService,
    private minio: MinioService,
    private outbox: OutboxProducer,
  ) {}

  async presign(
    userId: string,
    contentType: string,
    fileName?: string,
    folder?: string,
  ) {
    const safeName = sanitizeName(fileName || `upload-${Date.now()}`);
    const folderSafe = trimSlashes(folder) || `uploads/${userId}`;
    const key = `${folderSafe}/${Date.now()}-${safeName}`;
    const uploadUrl = await this.minio.presignedPutStrict(
      key,
      contentType,
      600,
    );
    const preview = publicUrlFromKey(key);
    return { key, uploadUrl, publicUrlPreview: preview };
  }

  async confirm(
    userId: string,
    input: {
      key: string;
      contentType?: string;
      bytes?: number;
      checksum?: string;
      width?: number;
      height?: number;
      tags?: string[];
    },
  ) {
    if (!input.key) throw new BadRequestException('key required');

    // Validate sau upload (size + sniff MIME whitelist)
    const validated = await this.minio.validateUploaded(input.key);
    const contentType = input.contentType || validated.mime || null;

    const url = publicUrlFromKey(input.key);

    // optional: đọc width/height
    let width = input.width ?? null;
    let height = input.height ?? null;
    if ((!width || !height) && contentType?.startsWith('image/')) {
      const buf = await this.minio.getObjectBuffer(input.key);
      const meta = await sharp(buf)
        .metadata()
        .catch(() => ({}) as any);
      width = meta.width ?? null;
      height = meta.height ?? null;
    }

    // ✅ Lưu record với malwareStatus = PENDING
    const rec = await this.prisma.file.create({
      data: {
        key: input.key,
        url,
        bytes: (validated as any).size ?? null,
        width,
        height,
        contentType,
        checksum: input.checksum ?? null,
        tags: (input.tags as any) ?? [],
        createdById: userId,
        malwareStatus: 'PENDING',
        malwareSignature: null,
        scannedAt: null,
      },
    });

    // ✅ Phát event để job quét antivirus (và sau đó mới tạo thumbnail)
    await this.outbox.emit(
      'dev.file.uploaded',
      { fileId: rec.id },
      `dev.file.uploaded:${rec.id}`,
    );

    return rec;
  }

  async get(id: string) {
    const f = await this.prisma.file.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('File not found');
    return f;
  }

  async list(userId: string, q: { limit?: number; cursor?: string }) {
    const limit = Math.min(Math.max(q.limit ?? 20, 1), 100);
    const rows = await this.prisma.file.findMany({
      where: { createdById: userId },
      orderBy: { id: 'desc' },
      cursor: q.cursor ? { id: q.cursor } : undefined,
      skip: q.cursor ? 1 : 0,
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].id : null;
    return { data, nextCursor, hasMore };
  }

  async remove(userId: string, id: string) {
    const f = await this.prisma.file.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('File not found');
    if (f.createdById && f.createdById !== userId)
      throw new BadRequestException('Not owner');

    const links = await this.prisma.propertyFile.count({
      where: { fileId: id },
    });
    if (links > 0)
      throw new BadRequestException('File is in use by property media');

    const variants = await this.prisma.fileVariant.findMany({
      where: { fileId: id },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.fileVariant.deleteMany({ where: { fileId: id } });
      await tx.file.delete({ where: { id } });
    });

    await this.minio.delete(f.key).catch(() => undefined);
    for (const v of variants)
      await this.minio.delete(v.key).catch(() => undefined);
    return { ok: true };
  }
}
