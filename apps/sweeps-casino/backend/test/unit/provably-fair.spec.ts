import {
  deriveFloats,
  generateClientSeed,
  generateServerSeed,
  hashServerSeed,
  verifyRound,
} from '../../src/libs/provably-fair/provably-fair';

describe('provably-fair primitive', () => {
  it('is deterministic: same (serverSeed, clientSeed, nonce) always yields the same floats', () => {
    const serverSeed = 'fixed-server-seed-for-test';
    const clientSeed = 'fixed-client-seed';
    const nonce = 42;

    const a = deriveFloats(serverSeed, clientSeed, nonce, 5);
    const b = deriveFloats(serverSeed, clientSeed, nonce, 5);

    expect(a).toEqual(b);
    a.forEach((f) => {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    });
  });

  it('produces different floats for a different nonce', () => {
    const serverSeed = 'fixed-server-seed-for-test';
    const clientSeed = 'fixed-client-seed';

    const a = deriveFloats(serverSeed, clientSeed, 1, 3);
    const b = deriveFloats(serverSeed, clientSeed, 2, 3);

    expect(a).not.toEqual(b);
  });

  it('hash is a pure function of the server seed and never reveals it', () => {
    const seed = generateServerSeed();
    const hash1 = hashServerSeed(seed);
    const hash2 = hashServerSeed(seed);
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(seed);
    expect(hash1).toHaveLength(64); // sha256 hex
  });

  it('verifyRound recomputes the same result an independent verifier would see', () => {
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const nonce = 7;

    const direct = deriveFloats(serverSeed, clientSeed, nonce, 1);
    const verified = verifyRound({ serverSeed, clientSeed, nonce, floatsNeeded: 1 });

    expect(verified.floats).toEqual(direct);
    expect(verified.serverSeedHash).toBe(hashServerSeed(serverSeed));
  });
});
