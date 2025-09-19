import { FeatureFlagsService } from './feature-flags.service';
import { isEnabledForUser } from './ff-rollout.util';

function ffWith(payload: any, enabled = true): FeatureFlagsService {
  // stub rất nhỏ: chỉ cần .get() trả enabled + payload
  return {
    get: jest.fn(() => ({ enabled, payload })),
  } as any as FeatureFlagsService;
}

describe('feature-flags.util (helpers)', () => {
  it('deny thắng hết', async () => {
    const ff = ffWith({ rollout: 100, denyUsers: ['bob'] });
    await expect(isEnabledForUser(ff, 'fraud-v2', 'bob')).resolves.toBe(false);
  });

  it('allow thắng phần trăm', async () => {
    const ff = ffWith({ rollout: 0, allowUsers: ['alice'] });
    await expect(isEnabledForUser(ff, 'fraud-v2', 'alice')).resolves.toBe(true);
  });

  it('ẩn danh chỉ bật khi 100%', async () => {
    const ff1 = ffWith({ rollout: 99 });
    const ff2 = ffWith({ rollout: 100 });
    await expect(isEnabledForUser(ff1, 'fraud-v2', null)).resolves.toBe(false);
    await expect(isEnabledForUser(ff2, 'fraud-v2', null)).resolves.toBe(true);
  });

  it('rollout đơn điệu theo cùng user/salt', async () => {
    const userId = 'bob';
    const salt = 'fraud-v2';
    // rollout 35% vs 50%: nếu true ở 35 thì 50 cũng phải true
    const ff35 = ffWith({ rollout: 35, salt });
    const ff50 = ffWith({ rollout: 50, salt });

    const at35 = await isEnabledForUser(ff35, 'fraud-v2', userId);
    const at50 = await isEnabledForUser(ff50, 'fraud-v2', userId);
    if (at35) expect(at50).toBe(true);
  });

  it('enabled=false là kill-switch tổng', async () => {
    const ff = ffWith(
      { rollout: 100, allowUsers: ['alice'] },
      /*enabled*/ false,
    );
    await expect(isEnabledForUser(ff, 'fraud-v2', 'alice')).resolves.toBe(
      false,
    );
  });
});
