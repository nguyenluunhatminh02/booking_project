// Add Redis caching for hot paths
private async getUserPermissions(userId: string) {
  const cacheKey = `user:perms:${userId}`;
  let perms = await this.redis.get(cacheKey);
  if (!perms) {
    perms = await this.loadFromDatabase(userId);
    await this.redis.setEx(cacheKey, 300, JSON.stringify(perms));
  }
  return JSON.parse(perms);
}

// Create centralized config
export const CONFIG = {
  jwt: {
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
    secret: process.env.JWT_SECRET || throwError('JWT_SECRET required'),
  },
  mfa: {
    totpWindow: parseInt(process.env.MFA_TOTP_WINDOW || '1'),
    backupCodeLength: parseInt(process.env.MFA_BACKUP_LENGTH || '10'),
  },
  security: {
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5'),
    lockoutDuration: process.env.LOCKOUT_DURATION || '15m',
  }
} as const;

Minor Improvements Needed:
🔧 Add comprehensive test suite
🔧 Implement health checks & metrics
🔧 Add API documentation (Swagger)
🔧 Environment-specific configurations