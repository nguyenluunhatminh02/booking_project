import { Injectable, Logger } from '@nestjs/common';
import { MinioService } from './minio.service';
import * as net from 'net';

export type AvResult =
  | { status: 'CLEAN' }
  | { status: 'INFECTED'; signature: string }
  | { status: 'ERROR'; message?: string };

function readUntilSocketEnd(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    socket.on('data', (chunk) => (data += chunk.toString('utf8')));
    socket.on('error', (e) => reject(e));
    socket.on('end', () => resolve(data));
  });
}

@Injectable()
export class AntivirusService {
  private readonly logger = new Logger(AntivirusService.name);

  private host = process.env.CLAMAV_HOST || 'localhost';
  private port = +(process.env.CLAMAV_PORT || 3310);
  private timeoutMs = +(process.env.CLAMAV_TIMEOUT_MS || 15000);
  private chunkSize = Math.max(
    64 * 1024,
    +(process.env.CLAMAV_CHUNK || 1024 * 1024),
  ); // >=64KB

  constructor(private readonly minio: MinioService) {}

  /** Scan một buffer (dùng INSTREAM) */
  async scanBuffer(buf: Buffer): Promise<AvResult> {
    let socket: net.Socket | null = null;
    try {
      socket = net.connect({ host: this.host, port: this.port });
      socket.setTimeout(this.timeoutMs);
      await new Promise<void>((resolve, reject) => {
        socket!.once('connect', () => resolve());
        socket!.once('error', reject);
        socket!.once('timeout', () => reject(new Error('clamd timeout')));
      });

      // Gửi lệnh INSTREAM
      socket.write('zINSTREAM\0', 'utf8');

      // Gửi buffer theo chunk, mỗi chunk có prefix 4 bytes (uint32 BE) là kích thước chunk
      const total = buf.length;
      for (let off = 0; off < total; off += this.chunkSize) {
        const end = Math.min(off + this.chunkSize, total);
        const sz = end - off;
        const header = Buffer.alloc(4);
        header.writeUInt32BE(sz, 0);
        socket.write(header);
        socket.write(buf.subarray(off, end));
      }
      // Kết thúc stream: size=0
      const zero = Buffer.alloc(4);
      zero.writeUInt32BE(0, 0);
      socket.write(zero);

      socket.end();

      const reply = await readUntilSocketEnd(socket);
      // Phản hồi: "stream: OK" hoặc "stream: Eicar-Test-Signature FOUND"
      if (/OK\s*$/.test(reply)) return { status: 'CLEAN' };
      const m = reply.match(/stream:\s*([^\s]+)\s+FOUND/i);
      if (m) return { status: 'INFECTED', signature: m[1] };
      return {
        status: 'ERROR',
        message: reply.trim() || 'unknown clamd reply',
      };
    } catch (e: any) {
      return { status: 'ERROR', message: e?.message || String(e) };
    } finally {
      try {
        socket?.destroy();
      } catch {
        /* empty */
      }
    }
  }

  /** Scan object trong MinIO theo key */
  async scanMinioObject(key: string): Promise<AvResult> {
    const buf = await this.minio.getObjectBuffer(key);
    return this.scanBuffer(buf);
  }
}
