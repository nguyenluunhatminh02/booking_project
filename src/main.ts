import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', 1); // trust proxy đầu tiên (Nginx)
  app.use(cookieParser());

  app.enableCors({
    origin: ['http://localhost:5173'], // FE origin
    credentials: true, // 👈 quan trọng để gửi cookie
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
