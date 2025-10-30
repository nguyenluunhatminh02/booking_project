import { MockPrisma, MockRedis } from '../../../test/mocks';
import { FeatureFlagsService } from './feature-flags.service';

describe('FeatureFlagsService', () => {
  let prisma: MockPrisma;
  let redis: MockRedis;
  let svc: FeatureFlagsService;

  beforeEach(() => {
    prisma = new MockPrisma();
    redis = new MockRedis();
    // seed DB giả
    prisma.data['fraud-v2'] = {
      enabled: true,
      payload: { rollout: 35 },
      updatedAt: new Date(),
    };
    // env TTL
    process.env.FEATURE_FLAG_TTL_SEC = '30';
    svc = new FeatureFlagsService(prisma as any, redis as any);
  });

  it('get() lần 1: miss Redis → hit DB → set cache', async () => {
    const val = await svc.get('fraud-v2');
    expect(val).toEqual({ enabled: true, payload: { rollout: 35 } });
    expect(redis.get).toHaveBeenCalledWith('ff:fraud-v2');
    expect(prisma.featureFlag.findUnique).toHaveBeenCalled();
    expect(redis.setEx).toHaveBeenCalled(); // đã cache
  });

  it('get() lần 2: hit Redis, không chạm DB', async () => {
    await svc.get('fraud-v2'); // warm cache
    (prisma.featureFlag.findUnique as any).mockClear();

    const val = await svc.get('fraud-v2');
    expect(val.enabled).toBe(true);
    expect(prisma.featureFlag.findUnique).not.toHaveBeenCalled();
    expect(redis.get).toHaveBeenCalledTimes(2);
  });

  it('upsert() → del cache → get() sau đó phải lấy giá trị mới', async () => {
    // upsert đổi rollout
    await svc.upsert('fraud-v2', true, { rollout: 50 });
    expect(redis.del).toHaveBeenCalledWith('ff:fraud-v2');

    const val = await svc.get('fraud-v2');
    expect(val.payload).toEqual({ rollout: 50 });
  });

  it('isEnabled() phản ánh enabled flag', async () => {
    expect(await svc.isEnabled('fraud-v2')).toBe(true);
    await svc.upsert('fraud-v2', false, { rollout: 100 });
    expect(await svc.isEnabled('fraud-v2')).toBe(false);
  });
});
