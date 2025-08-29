// dùng trên route
@RateLimit({ capacity: 20, refillTokens: 20, refillIntervalMs: 60_000, keyBy: 'email' /* hoặc 'ip'/'user' */ })
@Post('auth/login')
login() { ... }
