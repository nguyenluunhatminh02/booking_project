import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

// 💡 Dùng đúng kiểu TransactionClient thay vì Pick<PrismaService,...>
type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class OutboxProducer {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Emit ngoài transaction — ghi 1 row Outbox
   */
  async emit(topic: string, payload: any, eventKey?: string) {
    return this.prisma.outbox.create({
      data: { topic, payload, eventKey: eventKey ?? null },
    });
  }

  /**
   * Emit trong transaction — truyền `tx` (chính là `prisma` client trong callback $transaction)
   * Ví dụ:
   * await prisma.$transaction(async (tx) => {
   *   // ... cập nhật DB
   *   await this.outbox.emitInTx(tx, 'booking.held', booking.id, { bookingId: booking.id });
   * })
   */
  async emitInTx(
    tx: PrismaTx,
    topic: string,
    eventKey: string | null,
    payload: any,
  ) {
    return tx.outbox.create({
      data: { topic, eventKey, payload },
    });
  }
}
