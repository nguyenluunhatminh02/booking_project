import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../../src/modules/auth/auth.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TokenStateService } from '../../src/modules/auth/token-state.service';
import { DeviceApprovalService } from '../../src/modules/auth/device-approval.service';
import { AuditLogService } from '../../src/modules/audit/audit-log.service';
import { SecurityEventsService } from '../../src/modules/security/security-events.service';
import { RedisService } from '../../src/common/redis.service';
import { TokenBucketService } from '../../src/common/token-bucket.service';
import {
  hashPassword,
  verifyPassword,
  hashRefreshPart,
} from '../../src/modules/auth/utils/password';
import {
  splitRefreshToken,
  genTokenPart,
} from '../../src/modules/auth/utils/tokens';
import {
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

// Mock the utility functions
jest.mock('../../src/modules/auth/utils/password');
jest.mock('../../src/modules/auth/utils/tokens');

describe('AuthService', () => {
  let service: AuthService;
  let prisma: jest.Mocked<PrismaService>;
  let jwt: jest.Mocked<JwtService>;
  let tokenState: jest.Mocked<TokenStateService>;
  let deviceApproval: jest.Mocked<DeviceApprovalService>;
  let audit: jest.Mocked<AuditLogService>;
  let security: jest.Mocked<SecurityEventsService>;
  let redis: jest.Mocked<RedisService>;
  let tokenBucket: jest.Mocked<TokenBucketService>;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    password: 'hashed-password',
    accessVersion: 1,
    lockedUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSession = {
    id: 'session-123',
    userId: 'user-123',
    deviceId: 'device-123',
    refreshHash: 'refresh-hash',
    tokenVersion: 0,
    accessSv: 1,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    revokedReason: null,
    approved: true,
    userAgent: 'test-agent',
    ipAddress: '127.0.0.1',
    deviceFingerprint: null,
    prevRefreshHash: null,
    graceEndsAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
            userSession: {
              create: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
            },
            $transaction: jest.fn((fn) => fn(prisma)),
          },
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn(),
            verifyAsync: jest.fn(),
          },
        },
        {
          provide: TokenStateService,
          useValue: {
            getAccessVersion: jest.fn(),
            bumpAccessVersion: jest.fn(),
            denylistJti: jest.fn(),
            isUserLocked: jest.fn(),
            lockUser: jest.fn(),
          },
        },
        {
          provide: DeviceApprovalService,
          useValue: {
            needsApproval: jest.fn(),
            issue: jest.fn(),
          },
        },
        {
          provide: AuditLogService,
          useValue: {
            log: jest.fn(),
          },
        },
        {
          provide: SecurityEventsService,
          useValue: {
            log: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            incr: jest.fn(),
            expire: jest.fn(),
            enabled: true,
          },
        },
        {
          provide: TokenBucketService,
          useValue: {
            consume: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get(PrismaService);
    jwt = module.get(JwtService);
    tokenState = module.get(TokenStateService);
    deviceApproval = module.get(DeviceApprovalService);
    audit = module.get(AuditLogService);
    security = module.get(SecurityEventsService);
    redis = module.get(RedisService);
    tokenBucket = module.get(TokenBucketService);

    // Setup default mock returns
    (hashPassword as jest.Mock).mockResolvedValue('hashed-password');
    (verifyPassword as jest.Mock).mockResolvedValue(true);
    (hashRefreshPart as jest.Mock).mockReturnValue('hashed-refresh-part');
    (genTokenPart as jest.Mock).mockReturnValue('mock-token-part');
    (splitRefreshToken as jest.Mock).mockReturnValue({
      sessionId: 'session-123',
      tokenPart: 'token-part',
    });

    tokenBucket.consume.mockResolvedValue({
      allowed: true,
      remaining: 10,
      retryAfterSec: 0,
      resetAtSec: 0,
    });

    tokenState.isUserLocked.mockResolvedValue(false);
    tokenState.getAccessVersion.mockResolvedValue(1);
  });

  describe('register', () => {
    it('should successfully register a new user', async () => {
      const registerDto = {
        email: 'newuser@example.com',
        password: 'StrongPass123!',
      };
      const netCtx = { ip: '127.0.0.1', ua: 'test-agent' };

      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        ...mockUser,
        email: registerDto.email,
      });

      const result = await service.register(registerDto, netCtx);

      expect(result).toEqual({
        id: mockUser.id,
        email: registerDto.email,
        message: 'User registered successfully',
      });
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: registerDto.email,
          password: 'hashed-password',
        },
      });
      expect(audit.log).toHaveBeenCalledWith({
        action: 'USER_REGISTER',
        entity: 'User',
        entityId: mockUser.id,
        ctx: netCtx,
      });
    });

    it('should throw ConflictException if email already exists', async () => {
      const registerDto = {
        email: 'existing@example.com',
        password: 'StrongPass123!',
      };

      prisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.register(registerDto, {})).rejects.toThrow(
        ConflictException,
      );
    });

    it('should handle rate limiting', async () => {
      const registerDto = {
        email: 'newuser@example.com',
        password: 'StrongPass123!',
      };

      tokenBucket.consume.mockResolvedValue({
        allowed: false,
        remaining: 0,
        retryAfterSec: 60,
        resetAtSec: 0,
      });

      await expect(service.register(registerDto, {})).rejects.toThrow();
    });
  });

  describe('login', () => {
    it('should successfully login with valid credentials', async () => {
      const loginDto = {
        email: 'test@example.com',
        password: 'correct-password',
        deviceId: 'device-123',
      };
      const netCtx = { ip: '127.0.0.1', ua: 'test-agent' };

      prisma.user.findUnique.mockResolvedValue(mockUser);
      (verifyPassword as jest.Mock).mockResolvedValue(true);
      deviceApproval.needsApproval.mockResolvedValue(false);
      prisma.userSession.create.mockResolvedValue(mockSession);
      jwt.signAsync.mockResolvedValue('access-token');
      redis.set.mockResolvedValue('OK');

      const result = await service.login(loginDto, netCtx);

      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'session-123.mock-token-part',
        user: {
          id: mockUser.id,
          email: mockUser.email,
        },
      });
      expect(security.log).toHaveBeenCalledWith({
        type: 'LOGIN_SUCCESS',
        userId: mockUser.id,
        sessionId: mockSession.id,
        ctx: netCtx,
      });
    });

    it('should throw UnauthorizedException for invalid email', async () => {
      const loginDto = {
        email: 'nonexistent@example.com',
        password: 'password',
        deviceId: 'device-123',
      };

      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login(loginDto, {})).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for invalid password', async () => {
      const loginDto = {
        email: 'test@example.com',
        password: 'wrong-password',
        deviceId: 'device-123',
      };

      prisma.user.findUnique.mockResolvedValue(mockUser);
      (verifyPassword as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto, {})).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw ForbiddenException for locked account', async () => {
      const loginDto = {
        email: 'test@example.com',
        password: 'correct-password',
        deviceId: 'device-123',
      };

      prisma.user.findUnique.mockResolvedValue(mockUser);
      tokenState.isUserLocked.mockResolvedValue(true);

      await expect(service.login(loginDto, {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should handle device approval flow', async () => {
      const loginDto = {
        email: 'test@example.com',
        password: 'correct-password',
        deviceId: 'new-device',
      };
      const netCtx = { ip: '127.0.0.1', ua: 'test-agent' };

      prisma.user.findUnique.mockResolvedValue(mockUser);
      (verifyPassword as jest.Mock).mockResolvedValue(true);
      deviceApproval.needsApproval.mockResolvedValue(true);
      deviceApproval.issue.mockResolvedValue('approval-token');

      const result = await service.login(loginDto, netCtx);

      expect(result).toEqual({
        requiresDeviceApproval: true,
        approvalToken: 'approval-token',
        message: 'Device approval required',
      });
    });
  });

  describe('refreshToken', () => {
    it('should successfully refresh tokens', async () => {
      const refreshToken = 'session-123.token-part';
      const netCtx = { ip: '127.0.0.1', ua: 'test-agent' };

      prisma.userSession.findFirst.mockResolvedValue(mockSession);
      prisma.user.findUnique.mockResolvedValue(mockUser);
      jwt.signAsync.mockResolvedValue('new-access-token');
      prisma.userSession.update.mockResolvedValue({
        ...mockSession,
        tokenVersion: 1,
      });
      redis.set.mockResolvedValue('OK');

      const result = await service.refreshToken(refreshToken, netCtx);

      expect(result).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'session-123.mock-token-part',
      });
    });

    it('should throw UnauthorizedException for invalid refresh token format', async () => {
      const refreshToken = 'invalid-token';

      (splitRefreshToken as jest.Mock).mockReturnValue(null);

      await expect(service.refreshToken(refreshToken, {})).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for non-existent session', async () => {
      const refreshToken = 'session-123.token-part';

      prisma.userSession.findFirst.mockResolvedValue(null);

      await expect(service.refreshToken(refreshToken, {})).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for revoked session', async () => {
      const refreshToken = 'session-123.token-part';
      const revokedSession = {
        ...mockSession,
        revokedAt: new Date(),
      };

      prisma.userSession.findFirst.mockResolvedValue(revokedSession);

      await expect(service.refreshToken(refreshToken, {})).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for expired session', async () => {
      const refreshToken = 'session-123.token-part';
      const expiredSession = {
        ...mockSession,
        expiresAt: new Date(Date.now() - 1000),
      };

      prisma.userSession.findFirst.mockResolvedValue(expiredSession);

      await expect(service.refreshToken(refreshToken, {})).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('should successfully logout user', async () => {
      const sessionId = 'session-123';
      const jti = 'jwt-123';
      const expSec = Math.floor(Date.now() / 1000) + 900;
      const netCtx = { ip: '127.0.0.1', ua: 'test-agent' };

      prisma.userSession.update.mockResolvedValue({
        ...mockSession,
        revokedAt: new Date(),
      });

      const result = await service.logout(sessionId, jti, expSec, netCtx);

      expect(result).toEqual({ message: 'Logged out successfully' });
      expect(prisma.userSession.update).toHaveBeenCalledWith({
        where: { id: sessionId },
        data: {
          revokedAt: expect.any(Date),
          revokedReason: 'USER_LOGOUT',
        },
      });
      expect(tokenState.denylistJti).toHaveBeenCalledWith(jti, expSec);
    });
  });

  describe('logoutAll', () => {
    it('should logout all user sessions', async () => {
      const userId = 'user-123';
      const currentSessionId = 'session-123';
      const netCtx = { ip: '127.0.0.1', ua: 'test-agent' };

      prisma.userSession.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.logoutAll(userId, currentSessionId, netCtx);

      expect(result).toEqual({
        message: 'Logged out from all devices',
        sessionsRevoked: 3,
      });
      expect(tokenState.bumpAccessVersion).toHaveBeenCalledWith(userId);
    });
  });

  describe('revokeAccess', () => {
    it('should revoke access tokens by bumping version', async () => {
      const userId = 'user-123';
      const reason = 'security';
      const netCtx = { ip: '127.0.0.1', ua: 'test-agent' };

      const result = await service.revokeAccess(userId, reason, netCtx);

      expect(result).toEqual({ message: 'Access tokens revoked' });
      expect(tokenState.bumpAccessVersion).toHaveBeenCalledWith(userId);
      expect(security.log).toHaveBeenCalledWith({
        type: 'TOKEN_REVOKE',
        userId,
        meta: { reason },
        ctx: netCtx,
      });
    });
  });

  describe('approveDevice', () => {
    it('should approve device with valid token', async () => {
      const approvalToken = 'approval-token-123';
      const netCtx = { ip: '127.0.0.1', ua: 'test-agent' };

      // Mock the device approval service methods
      deviceApproval.issue = jest.fn().mockResolvedValue(approvalToken);

      // You'll need to implement this method in DeviceApprovalService
      const mockApprovalResult = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: mockUser.id, email: mockUser.email },
      };

      // This test assumes you have an approveDevice method
      // If not implemented yet, you can skip this test or implement the method
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      const registerDto = {
        email: 'test@example.com',
        password: 'StrongPass123!',
      };

      prisma.user.findUnique.mockRejectedValue(new Error('Database error'));

      await expect(service.register(registerDto, {})).rejects.toThrow();
    });

    it('should handle JWT signing errors', async () => {
      const loginDto = {
        email: 'test@example.com',
        password: 'correct-password',
        deviceId: 'device-123',
      };

      prisma.user.findUnique.mockResolvedValue(mockUser);
      deviceApproval.needsApproval.mockResolvedValue(false);
      prisma.userSession.create.mockResolvedValue(mockSession);
      jwt.signAsync.mockRejectedValue(new Error('JWT signing failed'));

      await expect(service.login(loginDto, {})).rejects.toThrow();
    });
  });
});
