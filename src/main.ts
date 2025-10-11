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
// import { CsrfExceptionFilter } from './common/filters/csrf-exception.filter'; // không bắt được EBADCSRFTOKEN

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  if (process.env.KAFKA_BOOTSTRAP === '1') {
    console.log('Waiting for Kafka to be ready...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    try {
      await ensureTopics();
    } catch (error) {
      console.error('Failed to ensure topics:', error);
    }
  } else {
    console.log('Skipping Kafka topic check (KAFKA_BOOTSTRAP!=1)');
  }
  app.set('trust proxy', 1);

  // Cấu hình nguồn FE/API từ env
  const FE_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

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
  app.use(cookieParser(process.env.COOKIE_SECRET || 'dev-cookie'));

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
      skipSanitization: process.env.NODE_ENV === 'development',
    }),
  );

  // Exception filters
  // app.useGlobalFilters(new CsrfExceptionFilter()); // không bắt được EBADCSRFTOKEN, có thể bỏ
  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = process.env.PORT ?? 3000;
  console.log('Starting Nest HTTP listener...');
  await app.listen(port);
  console.log(`🚀 Booking API is running on http://localhost:${port}`);
}
bootstrap();
