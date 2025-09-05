import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

export type SecurityEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'TOKEN_REVOKE'
  | 'REFRESH_REUSE'
  | 'PASSWORD_CHANGE'
  | 'PASSWORD_RESET'
  | 'MFA_ENABLED'
  | 'MFA_DISABLED'
  | 'MFA_VERIFY_FAILED'
  | 'ROLE_CHANGED'
  | 'PERMISSION_CHANGED'
  | 'DEVICE_ADDED'
  | 'DEVICE_REMOVED'
  | 'SUSPICIOUS_ACTIVITY';

export type SecurityContext = {
  ip?: string;
  ua?: string;
  deviceFp?: string;
  location?: {
    country?: string;
    city?: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  riskScore?: number;
};

export type SecurityEventInput = {
  type: SecurityEventType;
  userId?: string | null;
  sessionId?: string | null;
  ctx?: SecurityContext;
  meta?: Record<string, any>;
};

@Injectable()
export class SecurityEventsService {
  private readonly log = new Logger('SecurityEvents');
  private readonly FAILED_LOGIN_THRESHOLD = 5;
  private readonly SUSPICIOUS_TIME_WINDOW = 30 * 60 * 1000; // 30 minutes

  constructor(private readonly prisma: PrismaService) {}

  // Core logging method
  async logEvent(input: SecurityEventInput) {
    try {
      const event = await this.prisma.securityEvent.create({
        data: {
          type: input.type as any,
          userId: input.userId ?? null,
          sessionId: input.sessionId ?? null,
          ip: input.ctx?.ip,
          userAgent: input.ctx?.ua,
          deviceFp: input.ctx?.deviceFp,
          meta: {
            ...input.meta,
            location: input.ctx?.location,
            riskScore: input.ctx?.riskScore,
          },
        },
      });

      // Check for suspicious patterns
      if (await this.isSuspiciousActivity(input)) {
        await this.handleSuspiciousActivity(input);
      }

      return event;
    } catch (e: any) {
      this.log.error(`Failed to log security event: ${e?.message}`);
    }
  }

  // Authentication Events
  async loginSuccess(
    userId: string,
    sessionId?: string,
    ctx?: SecurityContext,
    meta?: Record<string, any>,
  ) {
    return this.logEvent({
      type: 'LOGIN_SUCCESS',
      userId,
      sessionId,
      ctx,
      meta,
    });
  }

  async loginFailed(
    userId?: string,
    ctx?: SecurityContext,
    meta?: Record<string, any>,
  ) {
    const event = await this.logEvent({
      type: 'LOGIN_FAILED',
      userId: userId ?? null,
      ctx,
      meta,
    });

    if (userId) {
      await this.checkFailedLoginThreshold(userId);
    }

    return event;
  }

  // Token Management
  async tokenRevoke(
    userId?: string,
    ctx?: SecurityContext,
    meta?: Record<string, any>,
  ) {
    return this.logEvent({
      type: 'TOKEN_REVOKE',
      userId: userId ?? null,
      ctx,
      meta,
    });
  }

  async refreshReuse(
    userId: string,
    sessionId: string,
    ctx?: SecurityContext,
    meta?: Record<string, any>,
  ) {
    const event = await this.logEvent({
      type: 'REFRESH_REUSE',
      userId,
      sessionId,
      ctx,
      meta,
    });

    // Force logout on token reuse
    await this.handleTokenReuse(userId, sessionId);

    return event;
  }

  // MFA Events
  async mfaEnabled(userId: string, ctx?: SecurityContext) {
    return this.logEvent({
      type: 'MFA_ENABLED',
      userId,
      ctx,
    });
  }

  async mfaDisabled(userId: string, ctx?: SecurityContext) {
    return this.logEvent({
      type: 'MFA_DISABLED',
      userId,
      ctx,
    });
  }

  async mfaVerifyFailed(userId: string, ctx?: SecurityContext) {
    return this.logEvent({
      type: 'MFA_VERIFY_FAILED',
      userId,
      ctx,
    });
  }

  // Device Management
  async deviceAdded(userId: string, deviceFp: string, ctx?: SecurityContext) {
    return this.logEvent({
      type: 'DEVICE_ADDED',
      userId,
      ctx: { ...ctx, deviceFp },
    });
  }

  async deviceRemoved(userId: string, deviceFp: string, ctx?: SecurityContext) {
    return this.logEvent({
      type: 'DEVICE_REMOVED',
      userId,
      ctx: { ...ctx, deviceFp },
    });
  }

  // Security Analysis Methods
  private async isSuspiciousActivity(
    event: SecurityEventInput,
  ): Promise<boolean> {
    if (!event.userId) return false;

    const recentEvents = await this.prisma.securityEvent.findMany({
      where: {
        userId: event.userId,
        createdAt: {
          gte: new Date(Date.now() - this.SUSPICIOUS_TIME_WINDOW),
        },
      },
    });

    // Check for multiple failed logins
    const failedLogins = recentEvents.filter(
      (e) => e.type === 'LOGIN_FAILED',
    ).length;
    if (failedLogins >= this.FAILED_LOGIN_THRESHOLD) return true;

    // Check for unusual locations
    if (event.ctx?.location && recentEvents.length > 0) {
      const lastLocation = (
        recentEvents[0].meta as { location?: SecurityContext['location'] }
      )?.location;
      if (this.isLocationUnusual(event.ctx.location, lastLocation)) return true;
    }

    // Check for rapid device changes
    if (event.ctx?.deviceFp) {
      const uniqueDevices = new Set(
        recentEvents.filter((e) => e.deviceFp).map((e) => e.deviceFp),
      );
      if (uniqueDevices.size >= 3) return true; // More than 3 devices in window
    }

    return false;
  }

  private async handleSuspiciousActivity(event: SecurityEventInput) {
    if (!event.userId) return;

    await this.logEvent({
      type: 'SUSPICIOUS_ACTIVITY',
      userId: event.userId,
      ctx: event.ctx,
      meta: {
        originalEventType: event.type,
        reason: 'Multiple failed attempts or unusual location/device pattern',
      },
    });

    // You could add additional actions here:
    // - Send notification to user
    // - Lock account temporarily
    // - Require additional verification
    // - Alert security team
  }

  private async handleTokenReuse(userId: string, sessionId: string) {
    await this.prisma.userSession.updateMany({
      where: { userId, id: sessionId },
      data: {
        revokedAt: new Date(),
        revokedReason: 'SECURITY_REUSE',
      },
    });
  }

  private async checkFailedLoginThreshold(userId: string) {
    const failedCount = await this.prisma.securityEvent.count({
      where: {
        userId,
        type: 'LOGIN_FAILED',
        createdAt: {
          gte: new Date(Date.now() - this.SUSPICIOUS_TIME_WINDOW),
        },
      },
    });

    if (failedCount >= this.FAILED_LOGIN_THRESHOLD) {
      // Could implement account locking or additional verification here
      this.log.warn(`Account ${userId} reached failed login threshold`);
    }
  }

  private isLocationUnusual(current: any, previous: any): boolean {
    if (!current?.coordinates || !previous?.coordinates) return false;

    // Basic distance calculation between coordinates
    const distance = Math.sqrt(
      Math.pow(current.coordinates.lat - previous.coordinates.lat, 2) +
        Math.pow(current.coordinates.lng - previous.coordinates.lng, 2),
    );

    // Consider unusual if distance > ~100km (rough approximation)
    return distance > 1;
  }

  // Analytics Methods
  async getLoginPatterns(userId: string, windowHours = 24) {
    const events = await this.prisma.securityEvent.findMany({
      where: {
        userId,
        type: { in: ['LOGIN_SUCCESS', 'LOGIN_FAILED'] },
        createdAt: {
          gte: new Date(Date.now() - windowHours * 60 * 60 * 1000),
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      total: events.length,
      success: events.filter((e) => e.type === 'LOGIN_SUCCESS').length,
      failed: events.filter((e) => e.type === 'LOGIN_FAILED').length,
      devices: new Set(events.filter((e) => e.deviceFp).map((e) => e.deviceFp))
        .size,
    };
  }
}
