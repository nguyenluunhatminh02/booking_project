export const MFA_CONFIG = {
  BACKUP_CODE_LENGTH: 10,
  BACKUP_CODE_COUNT: 10,
  MAX_VERIFY_ATTEMPTS: 3,
  VERIFY_TIMEOUT_SEC: 30,
  RECOVERY_KEY_LENGTH: 32,
  BCRYPT_ROUNDS: 10,
  TOTP: {
    ISSUER: 'BookingApp',
    WINDOW: 1, // Time window in steps
    STEP: 30, // Step in seconds
  },
} as const;
