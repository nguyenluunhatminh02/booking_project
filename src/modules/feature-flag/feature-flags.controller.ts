import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { UpsertFlagDto } from './dto/upsert-flag.dto';
import { isEnabledForUser, isEnabled } from './ff-rollout.util';

@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly ff: FeatureFlagsService) {}

  // GET one (admin view)
  @Get(':key')
  async getOne(@Param('key') key: string) {
    const rec = await this.ff.getRaw(key);
    return rec ?? { key, enabled: false, payload: null };
  }

  // PUT upsert (admin write)
  @Put(':key')
  async putOne(@Param('key') key: string, @Body() dto: UpsertFlagDto) {
    return this.ff.upsert(key, dto.enabled, dto.payload);
  }

  // Quick check tổng (không theo user)
  @Get(':key/enabled')
  async checkEnabled(
    @Param('key') key: string,
    @Query('userId') userId?: string,
  ) {
    if (userId) {
      const on = await isEnabledForUser(this.ff, key, userId);
      return { key, userId, enabled: on };
    }
    const on = await isEnabled(this.ff, key);
    return { key, enabled: on };
  }
}
