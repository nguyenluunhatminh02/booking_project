import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { JwtService } from '@nestjs/jwt';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/common/redis.service';
import { TokenBucketService } from 'src/common/token-bucket.service';
import { TokenStateService } from './token-state.service';

import {
  buildRefreshToken,
  genTokenPart,
  parseDurationToSec,
  splitRefreshToken,
} from './utils/tokens';
import {
  hashPassword,
  hashRefreshPart,
  verifyPassword,
  verifyRefreshPart,
} from './utils/password';

import { to429 } from 'src/common/errors/app.exception';
import { SecurityEventsService } from '../security/security-events.service';
import { DeviceApprovalService } from './device-approval.service';

type NetCtx = { ip?: string; ua?: string; deviceFp?: string };

const NS = 'v1:auth';

const JWT_ISSUER = process.env.JWT_ISSUER || 'booking-api';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'booking-fe';
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-access';
const MAX_DENY_TTL_SEC = 60 * 60 * 24 * 7;

const FAIL_WINDOW_SEC = 10 * 60;
const MAX_FAILS = 5;
const LOCK_BASE_SEC = 15 * 60;

@Injectable()
export class AuthService {
  private readonly refreshTtlSec = parseDurationToSec(
    process.env.REFRESH_TTL,
    60 * 60 * 24 * 30,
  );
  private readonly refreshGraceSec = parseDurationToSec(
    process.env.REFRESH_GRACE_SEC,
    20,
  );
  private readonly accessTtlSec = parseDurationToSec(
    process.env.JWT_ACCESS_TTL,
    15 * 60,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly tokenState: TokenStateService,
    private readonly tb: TokenBucketService,
    private readonly sec: SecurityEventsService,
    private readonly das: DeviceApprovalService,
  ) {}

  // ---------- helpers ----------
  private pendingKey = (sid: string, oldHash: string) =>
    `${NS}:rt:pending:${sid}:${oldHash}`;

  /** Singleflight lock theo (sid, oldHash) để tránh rotate trùng khi refresh đồng thời */
  private async withRtRotateSingleflight<T>(
    sid: string,
    oldHash: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!this.redis.enabled) return fn();
    const lockKey = `${NS}:rotlock:${sid}:${oldHash}`;
    const ttl = Math.max(this.refreshGraceSec, 5);

    // try lock
    const locked = await this.redis.set(lockKey, '1', {
      nx: true,
      ttlSec: ttl,
    });
    if (!locked) {
      // đã có thằng khác rotate: chờ pending map xuất hiện
      await new Promise((r) => setTimeout(r, 50));
      const raw1 = await this.redis.get(this.pendingKey(sid, oldHash));
      if (raw1) return JSON.parse(raw1);
      await new Promise((r) => setTimeout(r, 80));
      const raw2 = await this.redis.get(this.pendingKey(sid, oldHash));
      if (raw2) return JSON.parse(raw2);
      // fallthrough: chạy fn (rare)
    }

    try {
      return await fn();
    } finally {
      await this.redis.del(lockKey).catch(() => {});
    }
  }

  private async signAccessToken(
    user: { id: string; email: string },
    opts?: { sessionId?: string },
  ) {
    const av = await this.tokenState.getAccessVersion(user.id);
    const jti = crypto.randomUUID?.() ?? uuidv4();

    const sid = opts?.sessionId;
    let sv: number | undefined;
    if (sid) {
      sv = await this.tokenState.getSessionVersion(sid);
    }

    const token = this.jwt.sign(
      { av, sid, sv },
      {
        subject: user.id,
        jwtid: jti,
        secret: ACCESS_SECRET,
        expiresIn: this.accessTtlSec,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      },
    );

    const exp = this.jwt.decode(token)?.exp;
    return { token, jti, exp };
  }

  /**
   * DB là source of truth (refreshHash/expiresAt).
   * Redis giữ fast-path sống/chết: {NS}:rt:{sessionId} = '1'
   */
  private async createSessionAndRefreshToken(
    userId: string,
    deviceId?: string,
    ctx?: NetCtx,
  ): Promise<{
    refreshToken: string;
    refreshExpiresAt: Date;
    sessionId: string;
  }> {
    const sessionId = uuidv4();
    const tokenPart = genTokenPart();
    const refreshToken = buildRefreshToken(sessionId, tokenPart);
    const refreshHash = hashRefreshPart(tokenPart);

    const refreshExpiresAt = new Date(Date.now() + this.refreshTtlSec * 1000);

    await this.prisma.userSession.create({
      data: {
        id: sessionId,
        userId,
        deviceId,
        refreshHash,
        tokenVersion: 0,
        accessSv: 1,
        expiresAt: refreshExpiresAt,
        ip: ctx?.ip,
        userAgent: ctx?.ua,
        deviceFp: ctx?.deviceFp,
        approved: true,
      },
    });

    if (this.redis.enabled) {
      await this.redis.set(`${NS}:rt:${sessionId}`, '1', {
        ttlSec: this.refreshTtlSec,
        nx: true,
      });
    }

    return { refreshToken, sessionId, refreshExpiresAt };
  }

  /**
   * Rotate RT an toàn (CAS theo expectedOldHash).
   * Nếu rotate thành công, ghi idempotent map (pendingKey) để các request khác đọc lại.
   */
  private async rotateRefreshTokenCAS(
    sessionId: string,
    userId: string,
    expectedOldHash: string,
  ): Promise<
    | { rotated: true; refreshToken: string; expiresAt: Date }
    | { rotated: false }
  > {
    const tokenPart = genTokenPart();
    const newRefresh = buildRefreshToken(sessionId, tokenPart);
    const newHash = hashRefreshPart(tokenPart);

    const now = Date.now();
    const expiresAt = new Date(now + this.refreshTtlSec * 1000);
    const prevGraceUntil = new Date(now + this.refreshGraceSec * 1000);

    const res = await this.prisma.userSession.updateMany({
      where: {
        id: sessionId,
        userId,
        refreshHash: expectedOldHash,
        revokedAt: null,
      },
      data: {
        prevRefreshHash: expectedOldHash,
        prevExpiresAt: prevGraceUntil,
        refreshHash: newHash,
        tokenVersion: { increment: 1 },
        expiresAt,
        rotatedAt: new Date(),
      },
    });

    if (res.count !== 1) return { rotated: false };

    if (this.redis.enabled) {
      await this.redis.set(`${NS}:rt:${sessionId}`, '1', {
        ttlSec: this.refreshTtlSec,
      });
      try {
        const p = JSON.stringify({
          refreshToken: newRefresh,
          refreshExpiresAt: expiresAt.toISOString(),
        });
        await this.redis.set(this.pendingKey(sessionId, expectedOldHash), p, {
          ttlSec: Math.max(this.refreshGraceSec, 5),
        });
      } catch {
        /* best-effort */
      }
    }

    return { rotated: true, refreshToken: newRefresh, expiresAt };
  }

  private async revokeSession(
    sessionId: string,
    reason:
      | 'USER_LOGOUT'
      | 'ADMIN_FORCE'
      | 'SECURITY_REUSE'
      | 'EXPIRED'
      | 'OTHER' = 'USER_LOGOUT',
  ) {
    const res = await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });

    if (this.redis.enabled) {
      try {
        await this.redis.del(`${NS}:rt:${sessionId}`);
      } catch {
        /* empty */
      }
    }

    return { revoked: res.count === 1, reason };
  }

  // ---------- REGISTER ----------
  async register(email: string, password: string, ctx?: NetCtx) {
    const rawEmail = (email || '').trim();
    const normEmail = rawEmail.toLowerCase();
    if (!normEmail) throw new BadRequestException('Email required');
    if (!password || password.length < 8)
      throw new BadRequestException('Password too weak');

    const ip = ctx?.ip ?? 'unknown';
    const emRl = await this.tb.consume(`signup:email:${normEmail}`, {
      capacity: 3,
      refillTokens: 3,
      refillIntervalMs: 60_000,
    });
    if (!emRl.allowed) throw to429(emRl);

    const ipRl = await this.tb.consume(`signup:ip:${ip}`, {
      capacity: 20,
      refillTokens: 20,
      refillIntervalMs: 60_000,
    });
    if (!ipRl.allowed) throw to429(ipRl);

    const pwHash = await hashPassword(password);

    let user: { id: string; email: string };
    try {
      user = await this.prisma.user.create({
        data: { email: normEmail, password: pwHash },
        select: { id: true, email: true },
      });
    } catch (e) {
      if ((e as PrismaClientKnownRequestError)?.code === 'P2002') {
        throw new BadRequestException('Email already exists');
      }
      throw e;
    }

    const { refreshToken, refreshExpiresAt, sessionId } =
      await this.createSessionAndRefreshToken(user.id, undefined, ctx);
    const { token: accessToken, exp } = await this.signAccessToken(user, {
      sessionId,
    });

    return {
      user,
      accessToken,
      accessTokenExpiresIn: this.accessTtlSec,
      accessTokenExpSec: exp,
      refreshToken,
      refreshExpiresAt,
    };
  }

  // ---------- LOGIN ----------
  async login(
    email: string,
    password: string,
    deviceId?: string,
    ctx?: NetCtx,
  ) {
    const normEmail = (email || '').trim().toLowerCase();
    if (!normEmail || !password)
      throw new BadRequestException('Email/password required');

    const ip = ctx?.ip ?? 'unknown';
    const emRl = await this.tb.consume(`login:email:${normEmail}`, {
      capacity: 20,
      refillTokens: 20,
      refillIntervalMs: 60_000,
    });
    if (!emRl.allowed) throw to429(emRl);

    const ipRl = await this.tb.consume(`login:ip:${ip}`, {
      capacity: 100,
      refillTokens: 100,
      refillIntervalMs: 60_000,
    });
    if (!ipRl.allowed) throw to429(ipRl);

    const user = await this.prisma.user.findUnique({
      where: { email: normEmail },
      select: { id: true, email: true, password: true },
    });

    if (user && (await this.tokenState.isUserLocked(user.id))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    let ok = false;
    if (user) ok = await verifyPassword(password, user.password);
    else {
      await bcrypt.compare(
        password,
        '$2b$12$2qk0mP6c1k9H7k9H7k9HuOF0y1w1A3oJmBvBvQKf0g5mJp6WJ6U7G',
      );
    }

    if (!ok || !user) {
      if (user && this.redis.enabled) {
        const k = `${NS}:login:fail:${user.id}`;
        const c = await this.redis.incr(k);
        if (c === 1) await this.redis.expire(k, FAIL_WINDOW_SEC);
        if (c >= MAX_FAILS) {
          const factor = Math.min(3, c - MAX_FAILS);
          const lockSec = LOCK_BASE_SEC * Math.pow(2, factor);
          await this.tokenState.lockUser(user.id, lockSec);
        }
      }
      await this.sec.loginFailed(user?.id, ctx, { email: normEmail });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (this.redis.enabled) {
      try {
        await this.redis.del(`${NS}:login:fail:${user.id}`);
      } catch {
        /* empty */
      }
    }

    const { refreshToken, refreshExpiresAt, sessionId } =
      await this.createSessionAndRefreshToken(user.id, deviceId, ctx);
    const { token: accessToken, exp } = await this.signAccessToken(user, {
      sessionId,
    });

    await this.sec.loginSuccess(user.id, sessionId, ctx, { deviceId });
    return {
      accessToken,
      accessTokenExpiresIn: this.accessTtlSec,
      accessTokenExpSec: exp,
      refreshToken,
      refreshExpiresAt,
    };
  }

  // ---------- REFRESH (concurrency-safe + idempotent + singleflight) ----------
  async refresh(refreshToken: string, ctx?: NetCtx) {
    const parts = splitRefreshToken(refreshToken);
    if (!parts) throw new UnauthorizedException('Malformed refresh token');

    const { sessionId, tokenPart } = parts;
    const now = new Date();

    // Redis fast-path
    if (this.redis.enabled) {
      const alive = await this.redis.get(`${NS}:rt:${sessionId}`);
      if (!alive)
        throw new UnauthorizedException('Refresh session expired or revoked');
    }

    // Load session + user
    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!session || session.revokedAt)
      throw new UnauthorizedException('Session revoked');
    if (session.expiresAt <= now) {
      if (this.redis.enabled) {
        await Promise.allSettled([this.redis.del(`${NS}:rt:${sessionId}`)]);
      }
      throw new UnauthorizedException('Session expired');
    }
    if (session.approved === false)
      throw new UnauthorizedException('Device approval required');

    const suspicious =
      (ctx?.ua && session.userAgent && ctx.ua !== session.userAgent) ||
      (ctx?.deviceFp && session.deviceFp && ctx.deviceFp !== session.deviceFp);

    if (suspicious) {
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: { approved: false },
      });
      await this.tokenState.bumpSessionVersion(session.id);
      try {
        await this.das.issue(session.userId, session.id, {
          ip: ctx?.ip,
          ua: ctx?.ua,
          fp: ctx?.deviceFp,
        });
      } catch {}
      throw new UnauthorizedException('Device approval required');
    }

    // --- Case 1: match current hash -> singleflight rotate ---
    if (verifyRefreshPart(tokenPart, session.refreshHash)) {
      await this.prisma.userSession
        .update({ where: { id: sessionId }, data: { lastUsedAt: now } })
        .catch(() => {});

      const expectedOld = session.refreshHash;

      const out = await this.withRtRotateSingleflight(
        sessionId,
        expectedOld,
        async () => {
          const cas = await this.rotateRefreshTokenCAS(
            sessionId,
            session.userId,
            expectedOld,
          );
          if (cas.rotated) {
            return {
              refreshToken: cas.refreshToken,
              refreshExpiresAt: cas.expiresAt.toISOString(),
            };
          }
          // thử đọc idempotent map (pendingKey)
          if (this.redis.enabled) {
            const raw = await this.redis.get(
              this.pendingKey(sessionId, expectedOld),
            );
            if (raw) return JSON.parse(raw);
          }
          // Fallback nhẹ: coi như conflict
          throw new UnauthorizedException('Refresh conflict, try again');
        },
      );

      const { token: accessToken, exp } = await this.signAccessToken(
        session.user,
        { sessionId },
      );
      return {
        accessToken,
        accessTokenExpiresIn: this.accessTtlSec,
        accessTokenExpSec: exp,
        refreshToken: out.refreshToken,
        refreshExpiresAt: new Date(out.refreshExpiresAt),
      };
    }

    // --- Case 2: inGrace (client gửi prev ngay từ đầu) ---
    const inGrace =
      !!session.prevRefreshHash &&
      !!session.prevExpiresAt &&
      session.prevExpiresAt > now &&
      verifyRefreshPart(tokenPart, session.prevRefreshHash);

    if (inGrace) {
      // 1) Ưu tiên lấy từ idempotent map trước (KHÔNG xoá prev* vội)
      if (this.redis.enabled) {
        const raw = await this.redis.get(
          this.pendingKey(sessionId, session.prevRefreshHash!),
        );
        if (raw) {
          const parsed = JSON.parse(raw);
          await this.prisma.userSession
            .update({
              where: { id: sessionId },
              data: {
                lastUsedAt: now,
                prevRefreshHash: null,
                prevExpiresAt: null,
              },
            })
            .catch(() => {});
          const { token: accessToken, exp } = await this.signAccessToken(
            session.user,
            { sessionId },
          );
          return {
            accessToken,
            accessTokenExpiresIn: this.accessTtlSec,
            accessTokenExpSec: exp,
            refreshToken: parsed.refreshToken as string,
            refreshExpiresAt: new Date(parsed.refreshExpiresAt),
          };
        }
      }

      // 2) Singleflight rotate dựa trên current refreshHash
      const out = await this.withRtRotateSingleflight(
        sessionId,
        session.refreshHash,
        async () => {
          const cas = await this.rotateRefreshTokenCAS(
            sessionId,
            session.userId,
            session.refreshHash,
          );
          if (cas.rotated) {
            return {
              refreshToken: cas.refreshToken,
              refreshExpiresAt: cas.expiresAt.toISOString(),
            };
          }
          if (this.redis.enabled) {
            const raw = await this.redis.get(
              this.pendingKey(sessionId, session.refreshHash),
            );
            if (raw) return JSON.parse(raw);
          }
          throw new UnauthorizedException('Refresh conflict, try again');
        },
      );

      // 3) Chỉ xoá prev* sau khi có kết quả
      await this.prisma.userSession
        .update({
          where: { id: sessionId },
          data: {
            lastUsedAt: now,
            prevRefreshHash: null,
            prevExpiresAt: null,
          },
        })
        .catch(() => {});

      const { token: accessToken, exp } = await this.signAccessToken(
        session.user,
        { sessionId },
      );
      return {
        accessToken,
        accessTokenExpiresIn: this.accessTtlSec,
        accessTokenExpSec: exp,
        refreshToken: out.refreshToken,
        refreshExpiresAt: new Date(out.refreshExpiresAt),
      };
    }

    // --- Case 3: reuse ---
    await this.reusePenalty(session, ctx);
  }

  private async reusePenalty(
    session: { id: string; userId: string },
    ctx?: NetCtx,
  ): Promise<never> {
    await this.revokeSession(session.id, 'SECURITY_REUSE');
    await this.tokenState.bumpAccessVersion(session.userId);
    const lockTtlSec = Number(process.env.REUSE_LOCK_TTL_SEC || 900);
    await this.tokenState.lockUser(session.userId, lockTtlSec);
    try {
      if (this.sec) {
        await this.sec.refreshReuse(session.userId, session.id, ctx, {
          note: 'reuse detected',
        });
      }
    } catch {}
    throw new UnauthorizedException('Invalid refresh token');
  }

  // ---------- LOGOUT ----------
  async logout(refreshToken: string) {
    const parts = splitRefreshToken(refreshToken);
    if (!parts) return { ok: true, revoked: 0 };
    const res = await this.revokeSession(parts.sessionId, 'USER_LOGOUT');
    return { ok: true, revoked: res?.revoked ? 1 : 0 };
  }

  // ---------- LOGOUT ALL ----------
  async logoutAll(userId: string, keepSessionId?: string) {
    const where = keepSessionId
      ? { userId, revokedAt: null, NOT: { id: keepSessionId } }
      : { userId, revokedAt: null };

    const sessions = await this.prisma.userSession.findMany({
      where,
      select: { id: true },
    });
    const ids = sessions.map((s) => s.id);

    if (ids.length > 0) {
      await this.prisma.userSession.updateMany({
        where: { id: { in: ids }, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'USER_LOGOUT' },
      });

      if (this.redis.enabled) {
        try {
          const pipe = (this as any).redis?.redis?.pipeline?.() ?? null;
          if (pipe) {
            for (const id of ids) {
              pipe.del(`${NS}:rt:${id}`);
            }
            await pipe.exec();
          } else {
            await Promise.all(
              ids.map((id) => this.redis.del(`${NS}:rt:${id}`)),
            );
          }
        } catch {}
      }
    }

    await this.tokenState.bumpAccessVersion(userId);
    return { ok: true, revoked: ids.length };
  }

  // ---------- Revoke a single access token ----------
  async revokeAccessToken(accessToken: string) {
    try {
      const verified: any = this.jwt.verify(accessToken, {
        secret: ACCESS_SECRET,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        ignoreExpiration: false,
      });

      const jti: string | undefined = verified?.jti;
      const exp: number | undefined = verified?.exp;
      const userId: string | undefined = verified?.sub;

      if (!jti || !exp) return { ok: false, reason: 'missing-claims' };

      const nowSec = Math.floor(Date.now() / 1000);
      if (exp <= nowSec) return { ok: true, alreadyExpired: true };

      await this.tokenState.denylistJti(
        jti,
        Math.min(exp, nowSec + MAX_DENY_TTL_SEC),
      );

      if (userId) {
        await this.sec.tokenRevoke(userId, undefined, { jti });
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'verify-failed' };
    }
  }
}
