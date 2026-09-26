import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  // rawBody: true populates req.rawBody (Buffer) alongside the normal
  // parsed req.body, on every route, without disabling JSON parsing
  // elsewhere. KYC/Payments webhook signature verification needs the exact
  // raw bytes the HMAC was computed over (see
  // src/modules/kyc/kyc-webhook.controller.ts,
  // src/modules/payments/payments-webhook.controller.ts).
  const app = await NestFactory.create(AppModule, { cors: false, rawBody: true });

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:3100').split(','),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('api/v1');

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`sweeps-casino backend listening on :${port}`);
}

bootstrap();
