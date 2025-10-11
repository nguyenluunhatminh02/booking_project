import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({
      log: ['query', 'info', 'warn', 'error'],
      errorFormat: 'minimal',
    });
  }
  prisma = new PrismaClient();

  async onModuleInit() {
    try {
      await this.$connect();
    } catch (error) {
      if (process.env.NODE_ENV === 'production') {
        throw error;
      }
      console.warn(
        'Prisma connection skipped (database unavailable):',
        (error as Error)?.message ?? error,
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
