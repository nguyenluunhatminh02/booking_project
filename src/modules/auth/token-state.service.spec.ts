import { TokenStateService } from './token-state.service';

test('denylistJti / isJtiDenied', async () => {
  const redis = {
    enabled: true,
    setNx: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
  } as any;
  const prisma = { user: { findUnique: jest.fn() } } as any;
  const svc = new TokenStateService(redis, prisma);

  await svc.denylistJti('j1', Math.floor(Date.now() / 1000) + 60);
  // giả lập setNx ok → đọc ra true
  redis.get.mockResolvedValueOnce('1');
  expect(await svc.isJtiDenied('j1')).toBe(true);
});
