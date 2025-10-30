// src/idempotency/idempotency.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { sha256Hex } from '../../utils/crypto.util';

type IdemInit = {
  userId?: string | null;
  endpoint: string; // "POST /bookings/hold"
  key: string; // from header "Idempotency-Key"
  payloadForHash: unknown; // pick fields quan trọng để hash
  ttlMs: number; // ví dụ holdMinutes*60*1000 + 30*60*1000
};

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tạo/đọc registry theo (userId, endpoint, key).
   * - Nếu chưa có: tạo IN_PROGRESS rồi return record đó (caller tiếp tục xử lý).
   * - Nếu có:
   *   - COMPLETED + hash trùng → trả snapshot response.
   *   - IN_PROGRESS + hash trùng → 409 (đang xử lý).
   *   - Hash khác → 422 (reused key with different payload).
   */
  async beginOrReuse<T = any>(
    init: IdemInit,
  ): Promise<
    | { mode: 'PROCEED'; id: string } // bạn được phép xử lý
    | { mode: 'REUSE'; response: T } // trả snapshot
    | { mode: 'IN_PROGRESS' } // có request khác đang chạy
  > {
    if (!init.key || init.key.length < 8) {
      throw new BadRequestException('Idempotency-Key required');
    }
    const requestHash = sha256Hex(JSON.stringify(init.payloadForHash));
    const expiresAt = new Date(Date.now() + init.ttlMs);
    const scope = {
      userId: init.userId ?? null,
      endpoint: init.endpoint,
      key: init.key,
    };

    // Try create as IN_PROGRESS
    try {
      const rec = await this.prisma.idempotency.create({
        data: { ...scope, requestHash, status: 'IN_PROGRESS', expiresAt },
      });
      return { mode: 'PROCEED', id: rec.id };
    } catch (e: any) {
      // Unique hit: read existing
      const rec = await this.prisma.idempotency.findUnique({
        where: { userId_endpoint_key: scope as any },
      });
      if (!rec) throw e;

      if (rec.requestHash !== requestHash) {
        throw new UnprocessableEntityException(
          'Idempotency-Key reused with different payload',
        );
      }
      if (rec.status === 'COMPLETED') {
        return { mode: 'REUSE', response: rec.response as any };
      }
      if (rec.status === 'FAILED') {
        // cho phép client dùng key mới; với key cũ thì coi như kết thúc
        throw new ConflictException(
          'Previous attempt failed; use a new Idempotency-Key',
        );
      }
      // IN_PROGRESS
      return { mode: 'IN_PROGRESS' };
    }
  }

  /** Lưu snapshot thành công và đánh dấu COMPLETED */
  async completeOK(id: string, response: any, resourceId?: string) {
    await this.prisma.idempotency.update({
      where: { id },
      data: { status: 'COMPLETED', response, resourceId },
    });
  }

  /** Lưu lỗi và đánh dấu FAILED (để client đổi key mới) */
  async completeFailed(id: string, error: any) {
    await this.prisma.idempotency.update({
      where: { id },
      data: { status: 'FAILED', error },
    });
  }
}
