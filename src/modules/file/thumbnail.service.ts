import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import sharp from 'sharp';
import { MinioService } from './minio.service';
import { createHash } from 'crypto';

export type ThumbSpec = {
  kind: string;
  width: number;
  height?: number;
  format?: 'webp' | 'jpeg' | 'png';
  fit?: 'inside' | 'cover' | 'contain';
  quality?: number;
};

export const DEFAULT_SPECS: ThumbSpec[] = [
  { kind: 'THUMB_400', width: 400, format: 'webp', fit: 'inside', quality: 82 },
  { kind: 'THUMB_800', width: 800, format: 'webp', fit: 'inside', quality: 82 },
];

function clampInt(v: any, lo: number, hi: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export function loadThumbSpecsFromEnv(): ThumbSpec[] {
  const j = process.env.FILE_THUMBS_JSON;
  if (j) {
    try {
      const arr = JSON.parse(j) as any[];
      const specs = arr
        .map((o) => ({
          kind: String(o.kind),
          width: Number(o.width),
          height: o.height ? Number(o.height) : undefined,
          format: (o.format || 'webp') as ThumbSpec['format'],
          fit: (o.fit || 'inside') as ThumbSpec['fit'],
          quality: clampInt(o.quality ?? 82, 1, 100),
        }))
        .filter((x) => x.kind && x.width > 0);
      if (specs.length) return specs;
    } catch (parseErr) {
      void parseErr;
    }
  }
  const s = process.env.FILE_THUMBS;
  if (s) {
    const parts = s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const specs: ThumbSpec[] = [];
    for (const tok of parts) {
      const [kind, rest] = tok.split('=');
      if (!kind || !rest) continue;
      const segs = rest.split(':').map((s) => s.trim());
      const dim = segs[0];
      let width = 0,
        height: number | undefined;
      if (dim.includes('x')) {
        const [w, h] = dim.split('x');
        width = Number(w);
        height = h ? Number(h) : undefined;
      } else width = Number(dim);
      if (!Number.isFinite(width) || width <= 0) continue;
      const format = (segs[1] || 'webp') as ThumbSpec['format'];
      const fit = (segs[2] || 'inside') as ThumbSpec['fit'];
      const quality = clampInt(segs[3] ? Number(segs[3]) : 82, 1, 100);
      specs.push({ kind, width, height, format, fit, quality });
    }
    if (specs.length) return specs;
  }
  return DEFAULT_SPECS;
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
export class ThumbnailService {
  private readonly logger = new Logger(ThumbnailService.name);

  constructor(
    private prisma: PrismaService,
    private minio: MinioService,
  ) {}

  private buildVariantKey(
    fileId: string,
    spec: ThumbSpec,
    content: Buffer,
  ): string {
    const fmt = spec.format || 'webp';
    const fp = createHash('sha1').update(content).digest('hex').slice(0, 8);
    return `thumbnails/${fileId}/${spec.kind}.${fp}.${fmt}`;
  }

  async generate(
    fileId: string,
    specs: ThumbSpec[] = DEFAULT_SPECS,
    overwrite = false,
  ) {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new BadRequestException('File not found');
    if (!file.contentType || !file.contentType.startsWith('image/')) {
      throw new BadRequestException('Only image/* can be thumbnailed');
    }

    const inputBuf = await this.minio.getObjectBuffer(file.key);
    const variants: Array<{
      id: string;
      kind: string;
      key: string;
      url: string;
      width: number | null;
      height: number | null;
      bytes: number | null;
      contentType: string | null;
    }> = [];

    for (const spec of specs) {
      if (!overwrite) {
        const existing = await this.prisma.fileVariant.findUnique({
          where: { fileId_kind: { fileId, kind: spec.kind } },
        });
        if (existing) {
          variants.push({
            id: existing.id,
            kind: existing.kind,
            key: existing.key,
            url: existing.url,
            width: existing.width,
            height: existing.height,
            bytes: existing.bytes,
            contentType: existing.contentType,
          });
          continue;
        }
      }

      const fit = (spec.fit || 'inside') as keyof sharp.FitEnum;
      let pipeline = sharp(inputBuf).rotate().resize({
        width: spec.width,
        height: spec.height,
        fit,
        withoutEnlargement: true,
      });

      const fmt = spec.format || 'webp';
      const quality = clampInt(spec.quality ?? 82, 1, 100);
      if (fmt === 'webp') pipeline = pipeline.webp({ quality, effort: 4 });
      else if (fmt === 'jpeg')
        pipeline = pipeline.jpeg({ quality, mozjpeg: true });
      else if (fmt === 'png') pipeline = pipeline.png();

      const buf = await pipeline.toBuffer();
      const meta = await sharp(buf).metadata();
      const contentType =
        fmt === 'webp'
          ? 'image/webp'
          : fmt === 'jpeg'
            ? 'image/jpeg'
            : fmt === 'png'
              ? 'image/png'
              : 'application/octet-stream';

      const key = this.buildVariantKey(fileId, spec, buf);
      await this.minio.putBuffer(
        key,
        buf,
        contentType,
        'public,max-age=31536000,immutable',
      );
      const url = publicUrlFromKey(key);

      const before = await this.prisma.fileVariant.findUnique({
        where: { fileId_kind: { fileId, kind: spec.kind } },
      });

      const rec = await this.prisma.fileVariant.upsert({
        where: { fileId_kind: { fileId, kind: spec.kind } },
        update: {
          key,
          url,
          width: meta.width || null,
          height: meta.height || null,
          bytes: buf.length,
          contentType,
        },
        create: {
          fileId,
          kind: spec.kind,
          key,
          url,
          width: meta.width || null,
          height: meta.height || null,
          bytes: buf.length,
          contentType,
        },
      });

      if (before && before.key && before.key !== key) {
        this.minio.delete(before.key).catch(() => void 0);
      }

      variants.push({
        id: rec.id,
        kind: rec.kind,
        key: rec.key,
        url: rec.url,
        width: rec.width,
        height: rec.height,
        bytes: rec.bytes,
        contentType: rec.contentType,
      });
    }

    return variants;
  }

  async presignedGet(
    fileId: string,
    opts: { variant?: string; expires?: number } = {},
  ) {
    const { variant, expires = 300 } = opts;
    if (!variant || variant === 'ORIGINAL') {
      const f = await this.prisma.file.findUnique({ where: { id: fileId } });
      if (!f) throw new BadRequestException('File not found');
      const url = await this.minio.presignGet(f.key, expires);
      return { kind: 'ORIGINAL', url, expiresIn: expires };
    }

    const v = await this.prisma.fileVariant.findUnique({
      where: { fileId_kind: { fileId, kind: variant } },
    });
    if (!v) throw new BadRequestException('Variant not found');
    const url = await this.minio.presignGet(v.key, expires);
    return { kind: v.kind, url, expiresIn: expires };
  }

  async listVariants(fileId: string) {
    return this.prisma.fileVariant.findMany({
      where: { fileId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
