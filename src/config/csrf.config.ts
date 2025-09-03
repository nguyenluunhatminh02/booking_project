export const CSRF_CONFIG = {
  cookie: {
    key: 'XSRF-TOKEN',
    httpOnly: false,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  },
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  ignoredPaths: [
    '/api/auth/login',
    '/api/auth/register',
    '/api/health',
    '/api/metrics',
  ],
} as const;
