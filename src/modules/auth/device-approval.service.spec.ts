import { MockPrismaAuthUnit } from '../../../test/mocks-prisma-auth.unit';
import {
  DeviceApprovalService,
  buildApprovalToken,
} from './device-approval.service';
import * as bcrypt from 'bcrypt';

test('approve: happy path', async () => {
  const prisma = new MockPrismaAuthUnit();
  const mailer = { send: jest.fn() } as any;
  const svc = new DeviceApprovalService(prisma as any, mailer);

  // seed session & token
  await prisma.userSession.create({
    data: {
      id: 'sid1',
      userId: 'u1',
      refreshHash: 'h',
      expiresAt: new Date(Date.now() + 3600e3),
      approved: false,
    },
  });
  const opaque = 'opaqueX';
  const hash = await bcrypt.hash(opaque, 10);
  await prisma.userToken.create({
    data: {
      id: 'tok1',
      userId: 'u1',
      type: 'DEVICE_APPROVAL',
      tokenHash: hash,
      meta: { sessionId: 'sid1', ua: 'UA-2', fp: 'fp-2' },
      expiresAt: new Date(Date.now() + 600e3),
    },
  });

  const token = buildApprovalToken('tok1', opaque);
  const out = await svc.approve(token);

  expect(out).toEqual({ ok: true, sessionId: 'sid1' });
  const s = await prisma.userSession.findUnique({ where: { id: 'sid1' } });
  expect(s.approved).toBe(true);
  expect(s.userAgent).toBe('UA-2');
  expect(s.deviceFp).toBe('fp-2');
});
