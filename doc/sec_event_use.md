@Injectable()
export class AuthService {
  constructor(
    private readonly securityEvents: SecurityEventsService,
    // ...existing dependencies...
  ) {}

  async login(email: string, password: string, req: Request) {
    try {
      const user = await this.validateUser(email, password);
      
      await this.securityEvents.loginSuccess(user.id, undefined, {
        ip: req.ip,
        ua: req.headers['user-agent'],
        deviceFp: req.ctx?.deviceFp
      });

      return this.generateTokens(user);
    } catch (error) {
      await this.securityEvents.loginFailed(undefined, {
        ip: req.ip,
        ua: req.headers['user-agent']
      });
      throw error;
    }
  }
}

-----

@Injectable()
export class MfaService {
  constructor(
    private readonly securityEvents: SecurityEventsService,
    // ...existing dependencies...
  ) {}

  async enableTotp(userId: string, code: string, req: Request) {
    try {
      await this.verifyTotpAndEnable(userId, code);
      
      await this.securityEvents.mfaEnabled(userId, {
        ip: req.ip,
        ua: req.headers['user-agent'],
        deviceFp: req.ctx?.deviceFp
      });

      return { enabled: true };
    } catch (error) {
      await this.securityEvents.mfaVerifyFailed(userId, {
        ip: req.ip,
        ua: req.headers['user-agent'],
        deviceFp: req.ctx?.deviceFp
      });
      throw error;
    }
  }
}

-----

@Injectable()
export class TokenStateService {
  constructor(
    private readonly securityEvents: SecurityEventsService,
    // ...existing dependencies...
  ) {}

  async revokeRefreshToken(token: string, req: Request) {
    const decoded = await this.verifyRefreshToken(token);
    
    await this.securityEvents.tokenRevoke(decoded.sub, {
      ip: req.ip,
      ua: req.headers['user-agent'],
      deviceFp: req.ctx?.deviceFp
    });

    await this.redis.del(`rt:${token}`);
  }
}

----

@Injectable()
export class DeviceApprovalService {
  constructor(
    private readonly securityEvents: SecurityEventsService,
    // ...existing dependencies...
  ) {}

  async approveDevice(userId: string, deviceId: string, req: Request) {
    await this.prisma.approvedDevice.create({
      data: { userId, deviceId }
    });

    await this.securityEvents.deviceAdded(userId, deviceId, {
      ip: req.ip,
      ua: req.headers['user-agent']
    });
  }
}

-----

@Injectable()
export class RbacAdminService {
  constructor(
    private readonly securityEvents: SecurityEventsService,
    // ...existing dependencies...
  ) {}

  async updateUserRoles(userId: string, roleIds: string[], req: Request) {
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId } }),
      this.prisma.userRole.createMany({
        data: roleIds.map(roleId => ({ userId, roleId }))
      })
    ]);

    await this.securityEvents.logEvent({
      type: 'ROLE_CHANGED',
      userId,
      ctx: {
        ip: req.ip,
        ua: req.headers['user-agent'],
        deviceFp: req.ctx?.deviceFp
      },
      meta: { roleIds }
    });
  }
}

Comprehensive Event Types

Login events (success/failure)
Token management
MFA operations
Device management
Suspicious activities
Rich Context Tracking

IP addresses
User agents
Device fingerprints
Location data
Risk scores
Security Analysis

Failed login thresholds
Location change detection
Device change monitoring
Pattern recognition
Automated Responses

Token reuse handling
Account protection measures
Suspicious activity logging
Analytics Support

Login pattern analysis
Device usage tracking
Success/failure ratios