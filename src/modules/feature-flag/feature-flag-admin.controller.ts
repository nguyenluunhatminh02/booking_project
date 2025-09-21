import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';

@Controller('_ff') // chỉ dùng local để test
export class FeatureFlagAdminController {
  constructor(private ff: FeatureFlagsService) {}

  @Get(':key')
  async get(@Param('key') key: string) {
    if (process.env.NODE_ENV === 'production')
      throw new ForbiddenException('Flag admin API disabled in production');
    const row = await this.ff.getRaw(key);
    return row ?? { key, enabled: false, payload: null };
  }

  @Post(':key')
  async upsert(
    @Param('key') key: string,
    @Body() body: { enabled?: boolean; payload?: any },
  ) {
    if (process.env.NODE_ENV === 'production')
      throw new ForbiddenException('Flag admin API disabled in production');
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : true;
    const payload = body.payload ?? null;
    const row = await this.ff.upsert(key, enabled, payload);
    return row;
  }
}
