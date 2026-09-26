import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';

/**
 * Every mutating wallet-adjacent endpoint requires a caller-supplied
 * Idempotency-Key header. Missing it is a client error, not something we
 * default/generate server-side — the caller must be able to safely retry
 * with the exact same key.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const key = request.headers['idempotency-key'];
    if (!key || typeof key !== 'string') {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key header is required for this operation.',
      });
    }
    return key;
  },
);
