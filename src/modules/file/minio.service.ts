// src/modules/files/minio.service.ts

import { Injectable, OnModuleInit } from '@nestjs/common';
import * as Minio from 'minio';
import { fileTypeFromBuffer } from 'file-type'; // v16 (CJS) hoặc latest (ESM)

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SNIFF_BYTES = 4100; // đủ cho đa số định dạng ảnh
const MAX_UPLOAD_BYTES = +(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024); // 5MB default

@Injectable()
export class MinioService implements OnModuleInit {
  client: Minio.Client;
  bucket = process.env.MINIO_BUCKET || 'booking-uploads';

  onModuleInit() {
    this.client = new Minio.Client({
      endPoint: process.env.MINIO_END_POINT || 'localhost',
      port: +(process.env.MINIO_PORT || 9000),
      useSSL: (process.env.MINIO_USE_SSL || 'false') === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'minio',
      secretKey: process.env.MINIO_SECRET_KEY || 'minio12345',
    });
  }

  async ensureBucket() {
    const exists = await this.client
      .bucketExists(this.bucket)
      .catch(() => false);
    if (!exists) await this.client.makeBucket(this.bucket, '');
  }

  /** Presign PUT nhưng buộc client phải gửi đúng Content-Type (được ký vào URL). */
  async presignedPutStrict(
    objectKey: string,
    contentType: string,
    expirySec = 600,
  ) {
    return await this.client.presignedUrl(
      'PUT',
      this.bucket,
      objectKey,
      expirySec,
      {
        'Content-Type': contentType,
      },
    );
  }

  presignedGet(objectKey: string, expirySec = 600) {
    return this.client.presignedGetObject(this.bucket, objectKey, expirySec);
  }

  async stat(objectKey: string) {
    return await this.client.statObject(this.bucket, objectKey);
  }

  /** Đọc 1 phần đầu file để sniff magic bytes. */
  async sniffMime(objectKey: string): Promise<{ mime?: string; ext?: string }> {
    const stream = await this.client.getPartialObject(
      this.bucket,
      objectKey,
      0,
      SNIFF_BYTES,
    );
    const chunks: Buffer[] = [];
    for await (const chunk of stream as any) {
      chunks.push(Buffer.from(chunk));
      if (Buffer.concat(chunks).length >= SNIFF_BYTES) break;
    }
    const buf = Buffer.concat(chunks).subarray(0, SNIFF_BYTES);
    const ft = await fileTypeFromBuffer(buf).catch(() => undefined);
    return { mime: ft?.mime, ext: ft?.ext };
  }

  async delete(objectKey: string) {
    await this.client.removeObject(this.bucket, objectKey);
  }

  /** Validate sau upload: size + sniff MIME nằm trong whitelist. */
  async validateUploaded(objectKey: string) {
    const st = await this.stat(objectKey); // có .size và .metaData (tuỳ client gửi)
    if (st.size > MAX_UPLOAD_BYTES) {
      await this.delete(objectKey);
      throw new Error(`File too large: ${st.size} > ${MAX_UPLOAD_BYTES}`);
    }

    const { mime } = await this.sniffMime(objectKey);
    if (!mime || !ALLOWED_MIME.has(mime)) {
      await this.delete(objectKey);
      throw new Error(`Invalid file type (sniffed=${mime || 'unknown'})`);
    }

    return { size: st.size, mime };
  }
}
