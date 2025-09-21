import {
  INestApplication,
  Module,
  MiddlewareConsumer,
  NestModule,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { DeviceApprovalService } from '../src/modules/auth/device-approval.service';
import { TokenStateService } from '../src/modules/auth/token-state.service';
import { JwtAccessStrategy } from '../src/modules/auth/guards/jwt.strategy';

import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { TokenBucketService } from '../src/common/token-bucket.service';
import { SecurityEventsService } from '../src/modules/security/security-events.service';
import { MailerService } from '../src/modules/mailer/mailer.service';

// ============ Test-friendly env defaults ============
process.env.JWT_ACCESS_SECRET = 'dev-access';
process.env.JWT_ISSUER = 'booking-api';
process.env.JWT_AUDIENCE = 'booking-fe';
process.env.REFRESH_TTL = '30d';
process.env.JWT_ACCESS_TTL = '900';
process.env.REFRESH_GRACE_SEC = '20';
process.env.DEVICE_APPROVAL_TTL_SEC = '900';

// ============ Tiny helpers ============
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ============ In-memory Prisma mock (Auth subset) ============
class MockPrismaAuth implements Partial<PrismaService> {
  users: any[] = [];
  sessions: any[] = [];
  tokens: any[] = [];
  _id = 1;

  private clone<T>(x: T): T {
    return x == null ? (x as any) : JSON.parse(JSON.stringify(x));
  }
  private nextId(p = 'id') {
    return `${p}_${this._id++}`;
  }

  user = {
    create: async ({ data, select }: any) => {
      const row = {
        id: this.nextId('usr'),
        email: data.email,
        password: data.password,
        accessVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.users.push(row);
      return select ? pick(row, select) : this.clone(row);
    },
    findUnique: async ({ where, select }: any) => {
      let row: any;
      if (where?.email) row = this.users.find((u) => u.email === where.email);
      if (where?.id) row = this.users.find((u) => u.id === where.id);
      if (!row) return null;
      return select ? pick(row, select) : this.clone(row);
    },
    update: async ({ where: { id }, data, select }: any) => {
      const row = this.users.find((u) => u.id === id);
      if (!row) throw new Error('user not found');
      Object.assign(row, {
        accessVersion: data?.accessVersion?.increment
          ? row.accessVersion + data.accessVersion.increment
          : (data.accessVersion ?? row.accessVersion),
        updatedAt: new Date(),
      });
      return select ? pick(row, select) : this.clone(row);
    },
  };

  userSession = {
    create: async ({ data }: any) => {
      const row = {
        id: data.id,
        userId: data.userId,
        deviceId: data.deviceId ?? null,
        refreshHash: data.refreshHash,
        tokenVersion: data.tokenVersion ?? 0,
        accessSv: data.accessSv ?? 1,
        expiresAt: new Date(data.expiresAt),
        revokedAt: null as Date | null,
        revokedReason: null as any,
        ip: data.ip ?? null,
        userAgent: data.userAgent ?? null,
        deviceFp: data.deviceFp ?? null,
        approved: data.approved ?? true,
        lastUsedAt: null as Date | null,
        rotatedAt: null as Date | null,
        reusedAt: null as Date | null,
        prevRefreshHash: null as string | null,
        prevExpiresAt: null as Date | null,
        createdAt: new Date(),
      };
      this.sessions.push(row);
      return this.clone(row);
    },
    findUnique: async ({ where, include, select }: any) => {
      const row = this.sessions.find((s) => s.id === where.id);
      if (!row) return null;
      let out: any = this.clone(row);
      if (include?.user) {
        const u = this.users.find((us) => us.id === row.userId);
        out.user = pick(u, include.user.select ?? {}) ?? null;
      }
      if (select) out = pick(out, select);
      return out;
    },
    findMany: async ({ where, select }: any) => {
      let res = this.sessions.slice();
      if (where?.userId) res = res.filter((s) => s.userId === where.userId);
      return select ? res.map((r) => pick(r, select)) : this.clone(res);
    },
    update: async ({ where: { id }, data }: any) => {
      const row = this.sessions.find((s) => s.id === id);
      if (!row) throw new Error('session not found');
      Object.assign(row, {
        refreshHash: data.refreshHash ?? row.refreshHash,
        prevRefreshHash: data.prevRefreshHash ?? row.prevRefreshHash,
        prevExpiresAt: data.prevExpiresAt ?? row.prevExpiresAt,
        tokenVersion: data.tokenVersion?.increment
          ? row.tokenVersion + data.tokenVersion.increment
          : (data.tokenVersion ?? row.tokenVersion),
        accessSv: data.accessSv?.increment
          ? row.accessSv + data.accessSv.increment
          : (data.accessSv ?? row.accessSv),
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : row.expiresAt,
        rotatedAt: data.rotatedAt ?? row.rotatedAt,
        lastUsedAt: data.lastUsedAt ?? row.lastUsedAt,
        revokedAt: data.revokedAt ?? row.revokedAt,
        revokedReason: data.revokedReason ?? row.revokedReason,
        userAgent: data.userAgent ?? row.userAgent,
        deviceFp: data.deviceFp ?? row.deviceFp,
        approved:
          typeof data.approved === 'boolean' ? data.approved : row.approved,
      });
      return this.clone(row);
    },
    updateMany: async ({ where, data }: any) => {
      let res = this.sessions.slice();
      if (where?.id) res = res.filter((s) => s.id === where.id);
      if (where?.userId) res = res.filter((s) => s.userId === where.userId);
      if (where?.refreshHash)
        res = res.filter((s) => s.refreshHash === where.refreshHash);
      if (where?.revokedAt === null)
        res = res.filter((s) => s.revokedAt === null);
      if (where?.expiresAt?.gt)
        res = res.filter((s) => s.expiresAt > new Date(where.expiresAt.gt));
      let count = 0;
      for (const row of res) {
        if (data.prevRefreshHash !== undefined)
          row.prevRefreshHash = data.prevRefreshHash;
        if (data.prevExpiresAt !== undefined)
          row.prevExpiresAt = data.prevExpiresAt
            ? new Date(data.prevExpiresAt)
            : null;
        if (data.refreshHash !== undefined) row.refreshHash = data.refreshHash;
        if (data.tokenVersion?.increment)
          row.tokenVersion += data.tokenVersion.increment;
        if (data.expiresAt !== undefined)
          row.expiresAt = new Date(data.expiresAt);
        if (data.rotatedAt !== undefined)
          row.rotatedAt = new Date(data.rotatedAt);
        if (data.lastUsedAt !== undefined)
          row.lastUsedAt = new Date(data.lastUsedAt);
        if (data.revokedAt !== undefined)
          row.revokedAt = new Date(data.revokedAt);
        if (data.revokedReason !== undefined)
          row.revokedReason = data.revokedReason;
        if (data.accessSv?.increment) row.accessSv += data.accessSv.increment;
        if (typeof data.approved === 'boolean') row.approved = data.approved;
        if (data.userAgent !== undefined) row.userAgent = data.userAgent;
        if (data.deviceFp !== undefined) row.deviceFp = data.deviceFp;
        count++;
      }
      return { count };
    },
  };

  userToken = {
    create: async ({ data }: any) => {
      const row = {
        id: data.id,
        userId: data.userId ?? null,
        type: data.type,
        tokenHash: data.tokenHash,
        meta: data.meta ?? {},
        createdAt: new Date(),
        expiresAt: new Date(data.expiresAt),
        usedAt: null as Date | null,
        usedByIp: null as string | null,
      };
      this.tokens.push(row);
      return this.clone(row);
    },
    findUnique: async ({ where: { id } }: any) => {
      const row = this.tokens.find((t) => t.id === id);
      return row ? this.clone(row) : null;
    },
    update: async ({ where: { id }, data }: any) => {
      const row = this.tokens.find((t) => t.id === id);
      if (!row) throw new Error('token not found');
      Object.assign(row, {
        usedAt: data.usedAt ?? row.usedAt,
        usedByIp: data.usedByIp ?? row.usedByIp,
      });
      return this.clone(row);
    },
  };
}

// ============ Fake infra services ============
class FakeRedis implements Partial<RedisService> {
  public enabled = true;
  private store = new Map<string, { v: string; exp?: number }>();
  async get(key: string) {
    const it = this.store.get(key);
    if (!it) return null;
    if (it.exp && it.exp < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return it.v;
  }
  async set(
    key: string,
    val: string,
    opts?: { ttlSec?: number; nx?: boolean },
  ) {
    if (opts?.nx && this.store.has(key)) return false;
    const exp = opts?.ttlSec ? Date.now() + opts.ttlSec * 1000 : undefined;
    this.store.set(key, { v: val, exp });
    return true;
  }
  async setNx(key: string, val: string, ttlSec?: number) {
    return this.set(key, val, { ttlSec, nx: true });
  }
  async incr(key: string) {
    const cur = Number((await this.get(key)) ?? '0');
    const nxt = cur + 1;
    await this.set(key, String(nxt));
    return nxt;
  }
  async expire(key: string, ttlSec: number) {
    const it = this.store.get(key);
    if (!it) return false;
    it.exp = Date.now() + ttlSec * 1000;
    this.store.set(key, it);
    return true;
  }
  async del(key: string) {
    this.store.delete(key);
  }
}

class AllowAllTB implements Partial<TokenBucketService> {
  async consume(_key: string, _cfg: any) {
    return { allowed: true };
  }
}

class NoopSec implements Partial<SecurityEventsService> {
  async loginFailed() {}
  async loginSuccess() {}
  async refreshReuse() {}
  async tokenRevoke() {}
}

class NoopMailer implements Partial<MailerService> {
  async send(_args: any) {}
}

// ============ mini utils ============
function pick(obj: any, select: Record<string, boolean>) {
  if (!obj) return obj;
  const out: any = {};
  const keys = Object.keys(select);
  if (keys.length === 0) return obj;
  for (const k of keys) if (select[k]) out[k] = obj[k];
  return out;
}

// ============ Test module with ctx middleware ============
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET,
      signOptions: {
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    DeviceApprovalService,
    TokenStateService,
    JwtAccessStrategy,
    { provide: PrismaService, useClass: MockPrismaAuth },
    { provide: RedisService, useClass: FakeRedis },
    { provide: TokenBucketService, useClass: AllowAllTB },
    { provide: SecurityEventsService, useClass: NoopSec },
    { provide: MailerService, useClass: NoopMailer },
  ],
})
class AuthTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        // cookie parser
        cookieParser() as any,
        // attach req.ctx from headers
        ((req: any, _res: any, next: any) => {
          req.ctx = {
            ip: req.headers['x-ip'] || req.ip,
            ua: req.headers['x-ua'],
            deviceFp: req.headers['x-dfp'],
          };
          next();
        }) as any,
      )
      .forRoutes('*');
  }
}

// ============ The tests ============
describe('Auth Module E2E', () => {
  let app: INestApplication;
  let prisma: MockPrismaAuth;
  let das: DeviceApprovalService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AuthTestModule],
    }).compile();

    app = mod.createNestApplication();
    // (cookie-parser + ctx middleware đã gắn trong module)
    await app.init();

    prisma = app.get(PrismaService);
    das = app.get(DeviceApprovalService);
  });

  afterAll(async () => {
    await app.close();
  });

  let cookies: string[] = [];
  let accessToken: string = '';
  let userId: string = '';

  it('POST /auth/register -> set refresh cookie & return access token (no RT in body)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'user@example.com', password: 'StrongPass#1' })
      .expect(201);

    // access info in body (no refreshToken)
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeUndefined();

    // cookie set
    const setCookie = res.headers['set-cookie'];
    expect(Array.isArray(setCookie)).toBe(true);
    cookies = setCookie;

    accessToken = res.body.accessToken;
    // get user id for later
    const u = await prisma.user.findUnique({
      where: { email: 'user@example.com' },
      select: { id: true },
    });
    userId = u!.id;
  });

  it('POST /auth/login -> set new refresh cookie & return new access token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-ua', 'UA-1')
      .set('x-dfp', 'fp-1')
      .send({
        email: 'user@example.com',
        password: 'StrongPass#1',
        deviceId: 'dev-1',
        deviceFp: 'fp-1',
      })
      .expect(201);

    expect(res.body.accessToken).toBeTruthy();
    const setCookie = res.headers['set-cookie'];
    expect(Array.isArray(setCookie)).toBe(true);
    cookies = setCookie; // keep most recent cookie for refresh
    accessToken = res.body.accessToken;
  });

  it('POST /auth/refresh (same UA/FP) -> 201 rotates RT & returns new AT', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookies)
      .set('x-ua', 'UA-1')
      .set('x-dfp', 'fp-1')
      .send()
      .expect(201);

    expect(res.body.accessToken).toBeTruthy();
    expect(res.headers['set-cookie']).toBeDefined(); // rotated RT
    cookies = res.headers['set-cookie'];
  });

  it('POST /auth/refresh (suspicious UA) -> 401 Device approval required & session.approved=false', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookies)
      .set('x-ua', 'UA-2') // different UA => suspicious
      .set('x-dfp', 'fp-2')
      .send()
      .expect(401);

    expect(String(res.text)).toMatch(/Device approval required/i);

    // session should be set approved=false
    const sessList = await prisma.userSession.findMany({
      where: { userId },
      select: { id: true, approved: true },
    });
    const cur = sessList[sessList.length - 1];
    expect(cur.approved).toBe(false);
  });

  it('GET /auth/approve-device -> approve session with token then refresh works on new UA/FP', async () => {
    // Find latest session id (from login/refresh above)
    const sessions = await prisma.userSession.findMany({ where: { userId } });
    const sessionId = sessions[sessions.length - 1].id;

    // Issue approval token manually (same as email link)
    const issued = await das.issue(userId, sessionId, {
      ip: '1.2.3.4',
      ua: 'UA-2',
      fp: 'fp-2',
    });
    // Approve via HTTP endpoint
    await request(app.getHttpServer())
      .get('/auth/approve-device')
      .query({ token: issued.token })
      .expect(200);

    // Now refresh again with UA-2/fp-2 should succeed
    const ok = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookies)
      .set('x-ua', 'UA-2')
      .set('x-dfp', 'fp-2')
      .send()
      .expect(201);

    expect(ok.body.accessToken).toBeTruthy();
    cookies = ok.headers['set-cookie'] ?? cookies;
  });

  it('POST /auth/logout -> clear cookie (best-effort) and ok:true', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookies)
      .send()
      .expect(200);

    expect(res.body.ok).toBe(true);
    // server clears cookie; client may or may not see a Set-Cookie=deleted in this test env
  });
});
