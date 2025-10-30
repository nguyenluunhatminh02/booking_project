import { Controller, Get, Req } from '@nestjs/common';
import { RequireFlag } from '../feature-flag/ff.guard';
import { isEnabledForUser } from '../feature-flag/ff-rollout.util';
import { FeatureFlagsService } from '../feature-flag/feature-flags.service';

@Controller('demo')
export class DemoController {
  constructor(private ff: FeatureFlagsService) {}
  @Get('fraud-score')
  @RequireFlag('fraud-v2')
  getFraudScore(@Req() req: any) {
    return { ok: true, user: req.user?.id ?? null };
  }

  @Get('landing')
  async landing(@Req() req: any) {
    // Nếu đã đăng nhập, ưu tiên user.id; nếu chưa thì dùng aid
    const uid: string | null = req.user?.id ?? req.aid ?? null;

    // Flag: landing-v2 (B = phiên bản mới)
    const showB = await isEnabledForUser(this.ff, 'landing-v2', uid);

    // Trả JSON dễ test bằng curl; thực tế bạn render HTML tương ứng
    return {
      variant: showB ? 'B' : 'A',
      uid, // aid (nếu chưa login) hoặc userId (nếu đã login)
    };
  }
}
