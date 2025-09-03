import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as hpp from 'hpp';
import * as compression from 'compression';
import { CsrfExceptionFilter } from './common/filters/csrf-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.set('trust proxy', 1); // trust proxy đầu tiên (Nginx)
  app.use(cookieParser());
  app.use(compression({ threshold: 1024 })); // giảm băng thông
  app.useLogger(app.get(Logger));
  // Security headers
  app.use(
    helmet.contentSecurityPolicy({
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"], // Khi cần thêm script động, hãy dùng nonce
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'"], // cân nhắc bỏ 'unsafe-inline' nếu kiểm soát CSS tốt
        connectSrc: ["'self'", process.env.PUBLIC_API_ORIGIN ?? ''],
        upgradeInsecureRequests: [], // tuỳ môi trường
      },
    }),
  );

  // Prevent HTTP Parameter Pollution
  app.use(hpp());
  app.useGlobalFilters(new CsrfExceptionFilter());
  //  const allowlist = (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean);
  app.enableCors({
    //  origin: (origin, cb) => {
    //   if (!origin) return cb(null, true); // Postman, curl…
    //   if (allowlist.includes(origin)) return cb(null, true);
    //   return cb(new Error('Not allowed by CORS'), false);
    // },
    origin: ['http://localhost:5173'], // FE origin
    credentials: true, // 👈 quan trọng để gửi cookie
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Length', 'Content-Type'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
