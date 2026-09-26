import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { randomUUID } from 'crypto';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const requestId = randomUUID();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = isHttp ? exception.getResponse() : null;
    const code =
      (typeof body === 'object' && body && 'code' in body
        ? (body as { code?: string }).code
        : undefined) ?? (isHttp ? exception.name : 'INTERNAL_ERROR');
    const message =
      (typeof body === 'object' && body && 'message' in body
        ? (body as { message?: string | string[] }).message
        : isHttp
          ? exception.message
          : 'Internal server error') ?? 'Unexpected error';

    response.status(status).json({
      error: { code, message, requestId },
    });
  }
}
