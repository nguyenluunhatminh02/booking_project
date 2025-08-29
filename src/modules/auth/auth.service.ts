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
  hashRefreshPart, // ✅ giả định: sync SHA-256
  verifyPassword,
  verifyRefreshPart, // ✅ giả định: sync SHA-256 + timingSafeEqual
} from './utils/password';

import { to429 } from 'src/common/errors/app.exception';

// ===================
// Constants / Policy
// ===================
type NetCtx = { ip?: string; ua?: string };

const NS = 'v1:auth';

const JWT_ISSUER = process.env.JWT_ISSUER || 'booking-api';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'booking-fe';
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-access';
const MAX_DENY_TTL_SEC = 60 * 60 * 24 * 7; // cap denylist TTL (7d)

// Rate-limit & lock policy
const FAIL_WINDOW_SEC = 10 * 60; // 10 phút
const MAX_FAILS = 5; // quá 5 lần => lock
const LOCK_BASE_SEC = 15 * 60; // 15 phút

@Injectable()
export class AuthService {
  private readonly refreshTtlSec = parseDurationToSec(
    process.env.REFRESH_TTL,
    60 * 60 * 24 * 30, // 30d
  );
  private readonly refreshGraceSec = parseDurationToSec(
    process.env.REFRESH_GRACE_SEC,
    20, // 20s
  );
  private readonly accessTtlSec = parseDurationToSec(
    process.env.JWT_ACCESS_TTL,
    15 * 60, // 15m
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly tokenState: TokenStateService,
    private readonly tb: TokenBucketService,
  ) {}

  // ================
  // Helpers (Tokens)
  // ================
  private async signAccessToken(user: { id: string; email: string }) {
    const av = await this.tokenState.getAccessVersion(user.id);
    const jti = crypto.randomUUID?.() ?? uuidv4();

    const token = this.jwt.sign(
      { av },
      {
        subject: user.id,
        jwtid: jti,
        secret: ACCESS_SECRET,
        expiresIn: this.accessTtlSec,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      },
    );

    const decoded = this.jwt.decode(token);
    const exp = decoded?.exp;
    return { token, jti, exp };
  }

  /**
   * DB là source of truth (refreshHash/expiresAt).
   * Redis giữ fast-path sống/chết: {NS}:rt:{sessionId} = '1' (TTL = refreshTtlSec)
   * Dùng NX để idempotent khi retry tạo session.
   */
  private async createSessionAndRefreshToken(
    userId: string,
    deviceId?: string,
  ): Promise<{
    refreshToken: string;
    refreshExpiresAt: Date;
    sessionId: string;
  }> {
    const sessionId = uuidv4();
    const tokenPart = genTokenPart(); // base64url ngẫu nhiên
    const refreshToken = buildRefreshToken(sessionId, tokenPart);
    const refreshHash = hashRefreshPart(tokenPart); // ✅ sync SHA-256

    const refreshExpiresAt = new Date(Date.now() + this.refreshTtlSec * 1000);

    await this.prisma.userSession.create({
      data: {
        id: sessionId,
        userId,
        deviceId,
        refreshHash,
        tokenVersion: 0,
        expiresAt: refreshExpiresAt,
      },
    });

    if (this.redis.enabled) {
      await this.redis.set(`${NS}:rt:${sessionId}`, '1', {
        ttlSec: this.refreshTtlSec,
        nx: true, // không reset TTL nếu retry
      });
    }

    return { refreshToken, sessionId, refreshExpiresAt };
  }

  /**
   * Rotate RT an toàn (CAS theo refreshHash cũ).
   * Reset TTL Redis cho phiên RT mới.
   */
  private async rotateRefreshToken(sessionId: string, userId: string) {
    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
      select: { refreshHash: true, userId: true },
    });
    if (!session || session.userId !== userId) {
      throw new UnauthorizedException('Session missing');
    }

    const tokenPart = genTokenPart();
    const refreshToken = buildRefreshToken(sessionId, tokenPart);
    const newHash = hashRefreshPart(tokenPart); // ✅ sync SHA-256

    const now = Date.now();
    const expiresAt = new Date(now + this.refreshTtlSec * 1000);
    const prevGraceUntil = new Date(now + this.refreshGraceSec * 1000);

    const res = await this.prisma.userSession.updateMany({
      where: { id: sessionId, userId, refreshHash: session.refreshHash },
      data: {
        prevRefreshHash: session.refreshHash,
        prevExpiresAt: prevGraceUntil,
        refreshHash: newHash,
        tokenVersion: { increment: 1 },
        expiresAt,
        rotatedAt: new Date(),
        revokedAt: null,
      },
    });

    if (res.count !== 1) {
      throw new UnauthorizedException('Refresh already rotated');
    }

    if (this.redis.enabled) {
      await this.redis.set(`${NS}:rt:${sessionId}`, '1', {
        ttlSec: this.refreshTtlSec,
      });
    }

    return { refreshToken, expiresAt };
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

  // ===========
  // REGISTER
  // ===========
  async register(email: string, password: string, ctx?: NetCtx) {
    const rawEmail = (email || '').trim();
    const normEmail = rawEmail.toLowerCase();
    if (!normEmail) throw new BadRequestException('Email required');
    if (!password || password.length < 8) {
      throw new BadRequestException('Password too weak');
    }

    // Token bucket RL
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

    const pwHash = await hashPassword(password); // bcrypt rounds từ env

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

    // (Tùy policy) Issue email verify token ở đây…

    // Cấp token sau đăng ký (nếu policy cho phép)
    const { token: accessToken, exp } = await this.signAccessToken(user);
    const { refreshToken, refreshExpiresAt } =
      await this.createSessionAndRefreshToken(user.id);

    return {
      user,
      accessToken,
      accessTokenExpiresIn: this.accessTtlSec,
      accessTokenExpSec: exp, // optional
      refreshToken,
      refreshExpiresAt,
    };
  }

  // =========
  // LOGIN
  // =========
  async login(
    email: string,
    password: string,
    deviceId?: string,
    ctx?: NetCtx,
  ) {
    const normEmail = (email || '').trim().toLowerCase();
    if (!normEmail || !password) {
      throw new BadRequestException('Email/password required');
    }

    const ip = ctx?.ip ?? 'unknown';

    // Token bucket RL
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

    // Load user
    const user = await this.prisma.user.findUnique({
      where: { email: normEmail },
      select: { id: true, email: true, password: true },
    });

    if (user && (await this.tokenState.isUserLocked(user.id))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password (chống timing & enumeration)
    let ok = false;
    if (user) ok = await verifyPassword(password, user.password);
    else {
      await bcrypt.compare(
        password,
        '$2b$12$2qk0mP6c1k9H7k9H7k9HuOF0y1w1A3oJmBvBvQKf0g5mJp6WJ6U7G',
      );
    }

    if (!ok || !user) {
      // tăng fail-counter theo user => lock tạm nếu quá ngưỡng
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

      throw new UnauthorizedException('Invalid credentials');
    }

    // Dọn fail-counter
    if (this.redis.enabled) {
      try {
        await this.redis.del(`${NS}:login:fail:${user.id}`);
      } catch {
        /* empty */
      }
    }

    // Issue tokens
    const { token: accessToken, exp } = await this.signAccessToken(user);
    const { refreshToken, refreshExpiresAt } =
      await this.createSessionAndRefreshToken(user.id, deviceId);

    return {
      accessToken,
      accessTokenExpiresIn: this.accessTtlSec,
      accessTokenExpSec: exp, // optional
      refreshToken,
      refreshExpiresAt,
    };
  }

  // ==========
  // REFRESH
  // ==========
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
        try {
          await this.redis.del(`${NS}:rt:${sessionId}`);
        } catch {
          /* empty */
        }
      }
      throw new UnauthorizedException('Session expired');
    }

    // Match current
    if (verifyRefreshPart(tokenPart, session.refreshHash)) {
      await this.prisma.userSession.update({
        where: { id: sessionId },
        data: { lastUsedAt: now },
      });

      const { refreshToken: newRefresh, expiresAt } =
        await this.rotateRefreshToken(sessionId, session.userId);
      const { token: accessToken, exp } = await this.signAccessToken(
        session.user,
      );

      return {
        accessToken,
        accessTokenExpiresIn: this.accessTtlSec,
        accessTokenExpSec: exp,
        refreshToken: newRefresh,
        refreshExpiresAt: expiresAt,
      };
    }

    // Grace window
    const inGrace =
      !!session.prevRefreshHash &&
      !!session.prevExpiresAt &&
      session.prevExpiresAt > now &&
      verifyRefreshPart(tokenPart, session.prevRefreshHash);

    if (inGrace) {
      await this.prisma.userSession.update({
        where: { id: sessionId },
        data: { lastUsedAt: now },
      });

      const { refreshToken: newRefresh, expiresAt } =
        await this.rotateRefreshToken(sessionId, session.userId);
      const { token: accessToken, exp } = await this.signAccessToken(
        session.user,
      );

      return {
        accessToken,
        accessTokenExpiresIn: this.accessTtlSec,
        accessTokenExpSec: exp,
        refreshToken: newRefresh,
        refreshExpiresAt: expiresAt,
      };
    }

    // Reuse detected
    await this.revokeSession(sessionId, 'SECURITY_REUSE');
    await this.tokenState.bumpAccessVersion(session.userId);
    const lockTtlSec = Number(process.env.REUSE_LOCK_TTL_SEC || 900);
    await this.tokenState.lockUser(session.userId, lockTtlSec);

    // (best-effort) log REFRESH_REUSE nếu có service log
    // await this.sec?.log({ userId: session.userId, sessionId, type: 'REFRESH_REUSE', ctx, meta: { note: 'reuse detected' } }).catch(() => {});

    throw new UnauthorizedException('Invalid refresh token');
  }

  // ==========
  // LOGOUT(s)
  // ==========
  async logout(refreshToken: string) {
    const parts = splitRefreshToken(refreshToken);
    if (!parts) return { ok: true, revoked: 0 };
    const res = await this.revokeSession(parts.sessionId, 'USER_LOGOUT');
    return { ok: true, revoked: res?.revoked ? 1 : 0 };
  }

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
          const pipe = (this.redis as any).redis?.pipeline?.() ?? null;
          if (pipe) {
            for (const id of ids) pipe.del(`${NS}:rt:${id}`);
            await pipe.exec();
          } else {
            await Promise.all(
              ids.map((id) => this.redis.del(`${NS}:rt:${id}`)),
            );
          }
        } catch {
          /* empty */
        }
      }
    }

    await this.tokenState.bumpAccessVersion(userId);
    return { ok: true, revoked: ids.length };
  }

  // =======================
  // Revoke an access token
  // =======================
  async revokeAccessToken(accessToken: string) {
    try {
      const verified: any = this.jwt.verify(accessToken, {
        secret: ACCESS_SECRET,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        ignoreExpiration: false,
      });

      const jti: string | undefined = verified?.jti;
      const exp: number | undefined = verified?.exp; // unix seconds
      const userId: string | undefined = verified?.sub;
      const kid: string | undefined = this.jwt.decode(accessToken, {
        complete: true,
      })?.header?.kid;

      if (!jti || !exp) return { ok: false, reason: 'missing-claims' };

      const nowSec = Math.floor(Date.now() / 1000);
      if (exp <= nowSec) return { ok: true, alreadyExpired: true };

      await this.tokenState.denylistJti(
        jti,
        Math.min(exp, nowSec + MAX_DENY_TTL_SEC),
        kid,
      );

      // (best-effort) log TOKEN_REVOKE nếu có
      // await this.sec?.log({ userId, type: 'TOKEN_REVOKE', meta: { jti } }).catch(() => {});

      return { ok: true };
    } catch {
      return { ok: false, reason: 'verify-failed' };
    }
  }
}
