import { createHash, createHmac, randomBytes } from 'crypto';

/**
 * Shared provably-fair primitive used by every Original game.
 *
 * result = HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}`)
 *
 * The digest is sliced into 4-byte chunks, each read as an unsigned
 * 32-bit integer and normalized to [0, 1). Games map floats to their own
 * outcome space (dice roll 0-100, mine positions, plinko path) — this
 * module only produces the deterministic, verifiable randomness, never
 * the game-specific interpretation of it.
 */

export function generateServerSeed(): string {
  return randomBytes(32).toString('hex');
}

export function generateClientSeed(): string {
  return randomBytes(16).toString('hex');
}

export function hashServerSeed(serverSeed: string): string {
  return createHash('sha256').update(serverSeed).digest('hex');
}

/** Returns an array of floats in [0, 1), one per 4-byte chunk of the HMAC digest. */
export function deriveFloats(
  serverSeed: string,
  clientSeed: string,
  nonce: number | bigint,
  count = 1,
): number[] {
  const floats: number[] = [];
  let cursor = 0;
  let round = 0;
  let digest = hmacDigest(serverSeed, clientSeed, nonce, round);

  while (floats.length < count) {
    if (cursor + 4 > digest.length) {
      round += 1;
      digest = hmacDigest(serverSeed, clientSeed, nonce, round);
      cursor = 0;
    }
    const chunk = digest.readUInt32BE(cursor);
    floats.push(chunk / 0x100000000);
    cursor += 4;
  }

  return floats;
}

function hmacDigest(
  serverSeed: string,
  clientSeed: string,
  nonce: number | bigint,
  round: number,
): Buffer {
  const message = `${clientSeed}:${nonce.toString()}:${round}`;
  return createHmac('sha256', serverSeed).update(message).digest();
}

/** Independent verification entry point — same function the /provably-fair/verify endpoint calls. */
export function verifyRound(params: {
  serverSeed: string;
  clientSeed: string;
  nonce: number | bigint;
  floatsNeeded: number;
}): { serverSeedHash: string; floats: number[] } {
  const { serverSeed, clientSeed, nonce, floatsNeeded } = params;
  return {
    serverSeedHash: hashServerSeed(serverSeed),
    floats: deriveFloats(serverSeed, clientSeed, nonce, floatsNeeded),
  };
}
