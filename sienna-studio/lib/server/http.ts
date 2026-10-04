import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError, ZodSchema } from 'zod';
import { GenerationError } from './generate';
import { ComfyError } from '../comfy/client';

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, 'Request body must be JSON');
  }
  return schema.parse(body);
}

/** Wrap a route handler with consistent JSON error responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e: any) {
      if (e instanceof ZodError) {
        return json({ error: e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400);
      }
      if (e instanceof HttpError || e instanceof GenerationError || e instanceof ComfyError) {
        return json({ error: e.message, details: (e as any).details }, e.status);
      }
      console.error(e);
      return json({ error: e?.message || 'Internal error' }, 500);
    }
  };
}
