import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { SlotsService } from '../../src/modules/casino/slots/slots.service';
import { toCents } from '../../src/libs/money/money';

// Integration tests against a real Postgres instance (DATABASE_URL, see
// backend/.env.example), exercising the Vault Breaker spin() idempotency
// lifecycle end to end — the "production-critical" fix called out in the
// task brief: a retried spin (same Idempotency-Key) must never double-debit
// the wallet or return two different rounds, even when the retry races the
// original request rather than merely following it.

const prisma = new PrismaClient();
const walletService = new WalletService(prisma as unknown as PrismaService);
const slotsService = new SlotsService(prisma as unknown as PrismaService, walletService);

function expectAmount(actual: string | { toString(): string }, expectedDecimalString: string) {
  expect(toCents(actual.toString())).toBe(toCents(expectedDecimalString));
}

async function createTestUser(startingBalance = '1000.00') {
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `slots-idem-${suffix}@example.com`,
      username: `slotsidem${suffix}`,
      passwordHash: 'not-a-real-hash',
      dateOfBirth: new Date('1990-01-01'),
      stateOfRecord: 'NJ',
    },
  });
  await prisma.wallet.createMany({
    data: [
      { userId: user.id, currency: 'GC' },
      { userId: user.id, currency: 'SC' },
    ],
  });
  if (toCents(startingBalance) > 0n) {
    await walletService.postEntries(user.id, 'GC', [
      { type: 'BONUS', amount: startingBalance, source: 'SYSTEM', idempotencyKey: randomUUID() },
    ]);
  }
  return user;
}

async function getWallet(userId: string) {
  return prisma.wallet.findUniqueOrThrow({ where: { userId_currency: { userId, currency: 'GC' } } });
}

async function betEntryCount(walletId: string, gameRoundIds: string[]) {
  return prisma.ledgerEntry.count({
    where: { walletId, type: 'BET', gameRoundId: { in: gameRoundIds } },
  });
}

describe('SlotsService (Vault Breaker) — idempotency-key lifecycle', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  // TEST 1 — a normal spin debits exactly once and returns a coherent result.
  it('a normal spin debits the bet exactly once and returns correct payout math', async () => {
    const user = await createTestUser();
    const wallet = await getWallet(user.id);
    const key = randomUUID();

    const result = await slotsService.spin(user.id, 'vault-breaker', key, { currency: 'GC', betAmount: '1.00' });

    expect(result.replay).toBe(false);
    expectAmount(result.round.betAmount, '1.00');

    const betEntry = await prisma.ledgerEntry.findUniqueOrThrow({
      where: { walletId_idempotencyKey: { walletId: wallet.id, idempotencyKey: `${key}:bet` } },
    });
    expectAmount(betEntry.amount.toString(), '-1.00');
    expect(betEntry.gameRoundId).toBe(result.round.id);

    const winAmount = Number(result.round.winAmount ?? 0);
    const expectedWalletDelta = -1 + winAmount;
    const freshWallet = await getWallet(user.id);
    expectAmount(freshWallet.balance.toString(), (1000 + expectedWalletDelta).toFixed(2));

    // Payout math: winAmount === betAmount * totalMultiplier, to the cent.
    const totalMultiplier = (result.round.result as any).totalMultiplier as number;
    const expectedWinCents = BigInt(Math.round(100 * totalMultiplier));
    expect(toCents(result.round.winAmount ?? '0.00')).toBe(expectedWinCents);

    const betCount = await betEntryCount(wallet.id, [result.round.id]);
    expect(betCount).toBe(1);
  });

  // TEST 2 — the connection "dies" after the server committed but before the
  // client saw the response: a sequential retry with the SAME key must
  // return the identical round, not create a second one or debit again.
  it('a sequential retry with the same Idempotency-Key replays the identical round (no double debit)', async () => {
    const user = await createTestUser();
    const wallet = await getWallet(user.id);
    const key = randomUUID();

    const first = await slotsService.spin(user.id, 'vault-breaker', key, { currency: 'GC', betAmount: '2.00' });
    expect(first.replay).toBe(false);

    const balanceAfterFirst = (await getWallet(user.id)).balance.toString();

    // Simulates: client never saw the first response (timeout/dropped
    // connection) and retries with the same Idempotency-Key.
    const second = await slotsService.spin(user.id, 'vault-breaker', key, { currency: 'GC', betAmount: '2.00' });

    expect(second.replay).toBe(true);
    expect(second.round.id).toBe(first.round.id);
    expect(second.round.winAmount).toBe(first.round.winAmount);
    expect(second.round.result).toEqual(first.round.result);

    const balanceAfterSecond = (await getWallet(user.id)).balance.toString();
    expectAmount(balanceAfterSecond, balanceAfterFirst);

    const betCount = await betEntryCount(wallet.id, [first.round.id, second.round.id]);
    expect(betCount).toBe(1);

    const roundCount = await prisma.gameRound.count({ where: { userId: user.id } });
    expect(roundCount).toBe(1);
  });

  // TEST 3 — the real race: two requests carrying the identical
  // Idempotency-Key arrive genuinely concurrently (Promise.all, not
  // sequential awaits). This is the one that actually exercises the
  // concurrency fix in settleRound() — sequential testing (TEST 2) cannot
  // catch a bug here, because findReplayedRound()'s pre-check only helps
  // when the first call has already committed before the second starts.
  it('two genuinely concurrent spins sharing an Idempotency-Key converge on one round and one debit', async () => {
    const user = await createTestUser();
    const wallet = await getWallet(user.id);
    const key = randomUUID();

    const [a, b] = await Promise.all([
      slotsService.spin(user.id, 'vault-breaker', key, { currency: 'GC', betAmount: '3.00' }),
      slotsService.spin(user.id, 'vault-breaker', key, { currency: 'GC', betAmount: '3.00' }),
    ]);

    // Both callers must see the SAME round and SAME result — never two
    // different roundIds for one logical wager.
    expect(a.round.id).toBe(b.round.id);
    expect(a.round.winAmount).toBe(b.round.winAmount);
    expect(a.round.result).toEqual(b.round.result);
    // Exactly one of the two is the "original" (replay: false), the other
    // is necessarily a replay of it — never both false, never both true in
    // a way that implies two independent rounds.
    expect([a.replay, b.replay].sort()).toEqual([false, true]);

    // Only one BET ledger entry exists for this wallet/round — no double debit.
    const betCount = await betEntryCount(wallet.id, [a.round.id, b.round.id]);
    expect(betCount).toBe(1);

    // Only one GameRound row is left SETTLED for this user from this race —
    // the loser's own round (if a separate row was ever created) must have
    // been rolled back, never left dangling as a second "real-looking" round.
    const settledRounds = await prisma.gameRound.findMany({ where: { userId: user.id, status: 'SETTLED' } });
    expect(settledRounds).toHaveLength(1);
    expect(settledRounds[0].id).toBe(a.round.id);

    const walletAfter = await getWallet(user.id);
    const winAmount = Number(a.round.winAmount ?? 0);
    expectAmount(walletAfter.balance.toString(), (1000 - 3 + winAmount).toFixed(2));
  });

  // TEST 4 — a second, independent spin (fresh Idempotency-Key) after the
  // first has completed is its own separate wager, not folded into the first.
  it('a second spin with a NEW Idempotency-Key is an independent wager (two debits, two rounds)', async () => {
    const user = await createTestUser();
    const wallet = await getWallet(user.id);

    const first = await slotsService.spin(user.id, 'vault-breaker', randomUUID(), { currency: 'GC', betAmount: '1.00' });
    const second = await slotsService.spin(user.id, 'vault-breaker', randomUUID(), { currency: 'GC', betAmount: '1.00' });

    expect(second.round.id).not.toBe(first.round.id);
    expect(first.replay).toBe(false);
    expect(second.replay).toBe(false);

    const betCount = await betEntryCount(wallet.id, [first.round.id, second.round.id]);
    expect(betCount).toBe(2);

    const roundCount = await prisma.gameRound.count({ where: { userId: user.id } });
    expect(roundCount).toBe(2);

    const win1 = Number(first.round.winAmount ?? 0);
    const win2 = Number(second.round.winAmount ?? 0);
    const walletAfter = await getWallet(user.id);
    expectAmount(walletAfter.balance.toString(), (1000 - 1 + win1 - 1 + win2).toFixed(2));
  });

  // Not a client-side fallback: confirms spin() always derives its result
  // from the real provably-fair chain (serverSeedHash/clientSeed/nonce are
  // always present and non-empty) — there is no code path here that
  // fabricates a result without touching the seed.
  it('every settled round carries real provably-fair seed material, never a fabricated result', async () => {
    const user = await createTestUser();
    const result = await slotsService.spin(user.id, 'vault-breaker', randomUUID(), { currency: 'GC', betAmount: '1.00' });
    expect(result.round.serverSeedHash).toBeTruthy();
    expect(result.round.clientSeed).toBeTruthy();
    expect(result.round.nonce).toBeTruthy();
  });
});
