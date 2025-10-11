import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as Minio from 'minio';
import { fileTypeFromBuffer } from 'file-type';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SNIFF_BYTES = 4100;
const MAX_UPLOAD_BYTES = +(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024); // 5MB

function trimSuffix(s: string | undefined | null, ch = '/'): string {
  if (!s) return '';
  return s.replace(new RegExp(`${ch}+$`), '');
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as any) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export type PresignResult = {
  key: string;
  uploadUrl: string | null;
  publicUrlPreview?: string | null;
};

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);

  client!: Minio.Client;

  bucket = process.env.MINIO_BUCKET || 'booking-uploads';
  endPoint = process.env.MINIO_END_POINT || 'localhost';
  port = +(process.env.MINIO_PORT || 9000);
  useSSL = (process.env.MINIO_USE_SSL || 'false') === 'true';
  accessKey = process.env.MINIO_ACCESS_KEY || 'minio';
  secretKey = process.env.MINIO_SECRET_KEY || 'minio12345';

  publicPrefix = trimSuffix(process.env.MINIO_PUBLIC_URL_PREFIX, '/');

  private readonly bootstrapAtStartup =
    (process.env.MINIO_BOOTSTRAP ?? (process.env.NODE_ENV === 'production' ? '1' : '0')) ===
    '1';

  private readonly bootstrapTimeoutMs = Math.max(
    1_000,
    Number(process.env.MINIO_BOOTSTRAP_TIMEOUT_MS || 5_000),
  );

  async onModuleInit() {
    this.client = new Minio.Client({
      endPoint: this.endPoint,
      port: this.port,
      useSSL: this.useSSL,
      accessKey: this.accessKey,
      secretKey: this.secretKey,
    });

    if (!this.bootstrapAtStartup) {
      this.logger.log('MINIO_BOOTSTRAP!=1 → skip ensureBucket on startup');
      return;
    }

    try {
      await this.ensureBucketSafe();
    } catch (e) {
      this.logger.warn(
        `ensureBucket skipped (MinIO unavailable?): ${String(e?.message || e)}`,
      );
    }
  }

  get bootstrapEnabled(): boolean {
    return this.bootstrapAtStartup;
  }

  async ensureBucketSafe(timeoutMs = this.bootstrapTimeoutMs) {
    const ensurePromise = this.ensureBucket();
    await Promise.race([
      ensurePromise,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`MinIO ensureBucket timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        ensurePromise.finally(() => clearTimeout(timer));
      }),
    ]);
  }

  async ensureBucket() {
    const exists = await this.client
      .bucketExists(this.bucket)
      .catch(() => false);
    if (!exists) await this.client.makeBucket(this.bucket, '');
  }

  publicUrlFromKey(key: string): string {
    if (this.publicPrefix) return `${this.publicPrefix}/${encodeURI(key)}`;
    const proto = this.useSSL ? 'https' : 'http';
    return `${proto}://${this.endPoint}${this.port ? `:${this.port}` : ''}/${this.bucket}/${encodeURI(key)}`;
  }

  async presignPut(key: string, contentType: string): Promise<PresignResult> {
    const uploadUrl = await this.presignedPutStrict(
      key,
      contentType,
      600,
    ).catch((e) => {
      this.logger.warn(`presignPut failed: ${String(e?.message || e)}`);
      return null;
    });
    return { key, uploadUrl, publicUrlPreview: this.publicUrlFromKey(key) };
  }

  async presignedPutStrict(
    objectKey: string,
    contentType: string,
    expirySec = 600,
  ): Promise<string> {
    return this.client.presignedUrl('PUT', this.bucket, objectKey, expirySec, {
      'Content-Type': contentType,
    });
  }

  async presignGet(key: string, expiresInSeconds = 300): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, expiresInSeconds);
  }
  presignedGet(objectKey: string, expirySec = 600) {
    return this.presignGet(objectKey, expirySec);
  }

  async head(
    key: string,
  ): Promise<{ bytes?: number; contentType?: string } | null> {
    try {
      const st = await this.client.statObject(this.bucket, key);
      const metaCT =
        (st.metaData &&
          (st.metaData['content-type'] || st.metaData['Content-Type'])) ||
        undefined;
      return { bytes: Number(st.size ?? 0), contentType: metaCT };
    } catch (e) {
      this.logger.warn(`head failed: ${String(e?.message || e)}`);
      return null;
    }
  }

  async stat(objectKey: string) {
    return this.client.statObject(this.bucket, objectKey);
  }

  async getObjectBuffer(objectKey: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, objectKey);
    return streamToBuffer(stream);
  }

  async putBuffer(
    objectKey: string,
    body: Buffer,
    contentType: string,
    cacheControl?: string,
  ) {
    await this.client.putObject(this.bucket, objectKey, body, body.length, {
      'Content-Type': contentType || 'application/octet-stream',
      ...(cacheControl ? { 'Cache-Control': cacheControl } : {}),
    });
  }

  async delete(objectKey: string) {
    try {
      await this.client.removeObject(this.bucket, objectKey);
    } catch (e) {
      this.logger.warn(`delete failed: ${String(e?.message || e)}`);
    }
  }

  // Sniff MIME: đọc ~4KB rồi dừng
  async sniffMime(objectKey: string): Promise<{ mime?: string; ext?: string }> {
    const stream = await this.client.getObject(this.bucket, objectKey);
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for await (const chunk of stream as any) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(b);
        total += b.length;
        if (total >= SNIFF_BYTES) {
          try {
            (stream as any).destroy?.();
          } catch {}
          break;
        }
      }
    } catch {
      /* ignore */
    }
    const buf = Buffer.concat(chunks, Math.min(total, SNIFF_BYTES));
    const ft = await fileTypeFromBuffer(buf).catch(() => undefined);
    return { mime: ft?.mime, ext: ft?.ext };
  }

  // Validate sau upload
  async validateUploaded(objectKey: string) {
    const st = await this.stat(objectKey);
    if (st.size > MAX_UPLOAD_BYTES) {
      await this.delete(objectKey);
      throw new Error(`File too large: ${st.size} > ${MAX_UPLOAD_BYTES}`);
    }
    const { mime } = await this.sniffMime(objectKey);
    if (!mime || !ALLOWED_MIME.has(mime)) {
      await this.delete(objectKey);
      throw new Error(`Invalid file type (sniffed=${mime || 'unknown'})`);
    }
    const metaCT =
      (st.metaData &&
        (st.metaData['content-type'] || st.metaData['Content-Type'])) ||
      undefined;

    return { size: st.size, mime: mime || metaCT, contentTypeHeader: metaCT };
  }
}
