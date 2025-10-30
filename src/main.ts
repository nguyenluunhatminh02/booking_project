import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as hpp from 'hpp';
import * as bodyParser from 'body-parser';
import * as compression from 'compression';
// Nếu bạn dùng CsrfMiddleware ở AppModule thì KHÔNG cần import csurf ở đây
// import * as csurf from 'csurf';
import { TransformInterceptor } from './common/transforms/transform.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ValidationException } from './common/errors/app.exception';
import { ValidationError } from 'class-validator';
import { ensureTopics } from './modules/kafka/ensure-topics';
import { AppConfigService } from './config/app-config.service';
// import { CsrfExceptionFilter } from './common/filters/csrf-exception.filter'; // không bắt được EBADCSRFTOKEN

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  console.log('Waiting for Kafka to be ready...');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const config = app.get(AppConfigService);

  // Optional: initialize Sentry for error monitoring if configured
  if (process.env.SENTRY_DSN) {
    try {
      const SentryModule = await import('@sentry/node');
      // support both CJS and ESM default exports
      const Sentry: any =
        (SentryModule && (SentryModule as any).default) || SentryModule;

      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: config.nodeEnv ?? process.env.NODE_ENV,
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
      });

      // Expose the initialized Sentry instance on global so other modules can
      // capture without importing @sentry/node directly (keeps optional dependency).
      (global as any).__SENTRY__ = Sentry;

      // If Sentry provides the Express handlers, register the request handler
      // early so Sentry attaches request context to subsequent events.
      try {
        if (
          Sentry &&
          Sentry.Handlers &&
          typeof Sentry.Handlers.requestHandler === 'function'
        ) {
          app.use(Sentry.Handlers.requestHandler());
        }
      } catch {
        // ignore if handlers not available
      }

      console.log('Sentry initialized');
    } catch (err) {
      console.warn(
        'Sentry not initialized (package missing or init error):',
        err,
      );
    }
  }

  try {
    await ensureTopics(config.kafka);
  } catch (error) {
    console.error('Failed to ensure topics:', error);
  }
  app.set('trust proxy', 1);

  // Cấu hình nguồn FE/API từ env
  const FE_ORIGINS = config.cors.allowedOrigins;

  // Dùng helmet tổng quát + CSP (tránh phần tử rỗng)
  app.use(helmet());
  app.use(
    helmet.contentSecurityPolicy({
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"], // nếu Swagger/UI bị chặn, cân nhắc thêm 'unsafe-eval' hoặc per-route CSP
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'"], // dev; prod nên hạn chế hơn
        connectSrc: ["'self'", ...FE_ORIGINS], // ★ tránh phần tử rỗng
        upgradeInsecureRequests: [], // bật directive
      },
    }),
  );

  app.use(hpp());
  app.use(compression({ threshold: 1024 }));
  app.use(cookieParser(config.cookieSecret));

  // Logger
  app.useLogger(app.get(Logger));

  // CORS – ★ thêm các header cần thiết
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // Postman/curl
      if (FE_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-CSRF-Token', // ★
      'X-XSRF-Token', // ★
      'X-Device-Fp', // ★ nếu bạn gửi fingerprint từ FE
      'X-Request-Id', // ★ nếu client gửi request-id
    ],
    exposedHeaders: [
      'Content-Length',
      'Content-Type',
      'RateLimit-Limit', // ★ để FE đọc rate limit
      'RateLimit-Remaining', // ★
      'RateLimit-Reset', // ★
      'Retry-After', // ★
    ],
  });

  // Nếu KHÔNG apply CsrfMiddleware trong AppModule, thì bật csurf ở đây:
  // app.use(
  //   csurf({
  //     cookie: {
  //       key: '__Host-csrf',
  //       httpOnly: true,
  //       sameSite: 'lax',
  //       secure: process.env.NODE_ENV === 'production',
  //       path: '/',
  //     },
  //     ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
  //   }),
  // );

  // Express-level handler cho EBADCSRFTOKEN (★ BẮT BUỘC để trả JSON đẹp)
  app.use((err, req, res, next) => {
    if (err?.code === 'EBADCSRFTOKEN') {
      return res.status(403).json({
        statusCode: 403,
        message: 'Invalid CSRF token',
        path: req.originalUrl,
        timestamp: new Date().toISOString(),
        code: 'FORBIDDEN',
      });
    }
    return next(err);
  });

  // ❶ Stripe/MOCK webhook cần raw (không parse JSON ở route này)
  app.use('/payments/webhook', bodyParser.raw({ type: '*/*' }));

  // ❷ Các route còn lại parse JSON như bình thường, đồng thời giữ lại rawBody
  app.use(
    bodyParser.json({
      verify: (req: any, _res, buf) => {
        if (!req.rawBody) req.rawBody = buf;
      },
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const fieldErrors = errors.flatMap((err) => {
          const field = err.property;
          const constraints = err.constraints || {};
          const entries = Object.entries(constraints);
          if (entries.length === 0) return [];
          // map constraint -> code & message
          return entries.map(([, msg]) => ({
            field,
            message: msg,
          }));
        });
        return ValidationException(fieldErrors, 'Validation failed'); // status=422, code=VALIDATION_ERROR
      },
    }),
  );

  app.useGlobalInterceptors(
    new TransformInterceptor({
      customSensitiveFields: ['ssn', 'creditCard'],
      excludePaths: ['/docs', '/swagger'],
      skipSanitization: config.isDevelopment,
    }),
  );

  // Exception filters
  // app.useGlobalFilters(new CsrfExceptionFilter()); // không bắt được EBADCSRFTOKEN, có thể bỏ
  app.useGlobalFilters(new GlobalExceptionFilter());

  await app.listen(config.port);
}
void bootstrap();
