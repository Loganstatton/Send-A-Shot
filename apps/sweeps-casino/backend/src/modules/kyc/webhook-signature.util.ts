import { createHmac, timingSafeEqual } from 'crypto';

/**
 * HMAC-SHA256-over-raw-body signature check, the standard pattern used by
 * real KYC/payment vendors (Stripe, Persona, etc.): the header carries a
 * hex-encoded HMAC of the exact raw request bytes, keyed with a shared
 * secret only we and the (mock, for now) provider know. Comparison is
 * constant-time to avoid a timing side-channel. This is implemented for
 * real even though only MockKycProvider calls this webhook today, so the
 * pattern is already correct when a live vendor is wired in.
 */
export function verifyHmacSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  secret: string | undefined,
): boolean {
  if (!rawBody || !signatureHeader || !secret) return false;

  const expectedHex = createHmac('sha256', secret).update(rawBody).digest('hex');

  let expected: Buffer;
  let provided: Buffer;
  try {
    expected = Buffer.from(expectedHex, 'hex');
    provided = Buffer.from(signatureHeader, 'hex');
  } catch {
    return false;
  }

  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
