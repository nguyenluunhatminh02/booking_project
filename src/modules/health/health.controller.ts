import {
  Controller,
  Get,
  Head,
  Header,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Public } from 'src/common/decorators/public.decorator';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/common/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // Liveness: chỉ báo process còn chạy
  @Get('live')
  @Public()
  @Header('Cache-Control', 'no-store')
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  // Readiness: kiểm tra phụ thuộc (DB/Redis)
  @Get('ready')
  @Public()
  @Header('Cache-Control', 'no-store')
  async ready() {
    const checks = await this.collectChecks();
    return this.assertHealthy(checks);
  }

  @Get()
  @Head()
  @Public()
  @Header('Cache-Control', 'no-store')
  async health() {
    const checks = await this.collectChecks();
    const healthy = this.isHealthy(checks);
    return { status: healthy ? 'healthy' : 'unhealthy', checks };
  }

  private async collectChecks(): Promise<{
    database: boolean;
    redis: boolean;
    timestamp: string;
  }> {
    const checks = {
      database: false,
      redis: false,
      timestamp: new Date().toISOString(),
    };

    try {
      // ping DB nhanh gọn
      await this.prisma.user.findFirst({ select: { id: true }, take: 1 });
      checks.database = true;
    } catch {
      /* db down */
    }

    try {
      if (this.redis.enabled) {
        await this.redis.set('health:check', '1', { ttlSec: 5 });
        checks.redis = true;
      } else {
        checks.redis = true; // Redis optional
      }
    } catch {
      /* redis down */
    }

    return checks;
  }

  private isHealthy(checks: {
    database: boolean;
    redis: boolean;
    timestamp: string;
  }) {
    return checks.database && checks.redis;
  }

  private assertHealthy(checks: {
    database: boolean;
    redis: boolean;
    timestamp: string;
  }) {
    const healthy = this.isHealthy(checks);
    if (!healthy) {
      throw new ServiceUnavailableException({ status: 'unhealthy', checks });
    }
    return { status: 'healthy', checks };
  }
}
