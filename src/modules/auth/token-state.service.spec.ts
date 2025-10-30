import { TokenStateService } from './token-state.service';

test('denylistJti / isJtiDenied', async () => {
  const redis = {
    enabled: true,
    setNx: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
  } as any;
  const prisma = { user: { findUnique: jest.fn() } } as any;
  const svc = new TokenStateService(redis, prisma);

  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + 60;

  await svc.denylistJti('j1', expSec);

  expect(redis.setNx).toHaveBeenCalledTimes(1);
  const [keyArg, valueArg, ttlArg] = redis.setNx.mock.calls[0];
  expect(keyArg).toContain('j1');
  expect(valueArg).toBe('1');
  expect(typeof ttlArg).toBe('number');
  expect(ttlArg).toBeGreaterThanOrEqual(60);
  expect(ttlArg).toBeLessThanOrEqual(180);

  // giả lập setNx ok → đọc ra true
  redis.get.mockResolvedValueOnce('1');
  expect(await svc.isJtiDenied('j1')).toBe(true);
});
