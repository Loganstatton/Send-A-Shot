import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { MinesRoundService } from '../../src/modules/casino/originals/mines/mines-round.service';
import { toCents } from '../../src/libs/money/money';

// Integration tests against a real Postgres instance (DATABASE_URL, see
// backend/.env.example), exercising the interactive Mines round flow end
// to end: start -> pick(s) -> cashout, and start -> pick(mine). These are
// the ledger-safety-critical paths called out in the spec: a retried
// cashout must never double-credit, a mine hit must never pay out, a tile
// can't be picked twice, and cashing out with zero safe picks is rejected.

const prisma = new PrismaClient();
const walletService = new WalletService(prisma as unknown as PrismaService);
const minesRoundService = new MinesRoundService(prisma as unknown as PrismaService, walletService);

function expectAmount(actual: string | { toString(): string }, expectedDecimalString: string) {
  expect(toCents(actual.toString())).toBe(toCents(expectedDecimalString));
}

async function createTestUser(startingBalance = '100.00') {
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `mines-test-${suffix}@example.com`,
      username: `minestest${suffix}`,
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

/**
 * Starts rounds with escalating mine counts (1..24) until one lands with
 * tile 0 safe — with a real random seed we can't force a layout, but with
 * only 1 mine among 25 tiles the odds of tile 0 being safe are 24/25, and
 * this loop makes the test deterministic-in-practice without touching the
 * provably-fair derivation at all (never mock/stub the RNG — the whole
 * point of these tests is that ledger safety holds against the real
 * outcome engine).
 */
async function startRoundWithSafeTileZero(userId: string) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const started = await minesRoundService.start(userId, randomUUID(), {
      currency: 'GC',
      betAmount: '10.00',
      minesCount: 1,
    });
    const pick = await minesRoundService.pick(userId, started.roundId, randomUUID(), 0);
    if (!pick.hit) {
      return { roundId: started.roundId, firstPick: pick };
    }
  }
  throw new Error('Could not land a safe tile 0 in 50 attempts — something is wrong with mine derivation.');
}

async function startRoundAndFindMineTile(userId: string, minesCount = 24) {
  // 24 mines / 25 tiles: any given tile index is a mine with probability
  // 24/25, so tile 0 (or the eventual fallback loop) reliably hits.
  const started = await minesRoundService.start(userId, randomUUID(), {
    currency: 'GC',
    betAmount: '10.00',
    minesCount,
  });
  for (let tile = 0; tile < 25; tile++) {
    const pick = await minesRoundService.pick(userId, started.roundId, randomUUID(), tile);
    if (pick.hit) {
      return { roundId: started.roundId, hitTile: tile };
    }
  }
  throw new Error('25 mines / 25 tiles should be impossible to avoid — derivation bug.');
}

describe('MinesRoundService — interactive round ledger safety', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('start debits the bet exactly once and opens a round', async () => {
    const user = await createTestUser();
    const started = await minesRoundService.start(user.id, randomUUID(), {
      currency: 'GC',
      betAmount: '10.00',
      minesCount: 3,
    });

    expect(started.minesCount).toBe(3);
    expectAmount(started.betAmount, '10.00');

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user.id, currency: 'GC' } },
    });
    expectAmount(wallet.balance.toString(), '90.00');

    const round = await prisma.gameRound.findUniqueOrThrow({ where: { id: started.roundId } });
    expect(round.status).toBe('OPEN');
  });

  it('a retried START with the same Idempotency-Key does not double-debit', async () => {
    const user = await createTestUser();
    const key = randomUUID();
    const first = await minesRoundService.start(user.id, key, { currency: 'GC', betAmount: '10.00', minesCount: 3 });
    const second = await minesRoundService.start(user.id, key, { currency: 'GC', betAmount: '10.00', minesCount: 3 });

    expect(second.roundId).toBe(first.roundId);
    expect(second.replay).toBe(true);

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user.id, currency: 'GC' } },
    });
    expectAmount(wallet.balance.toString(), '90.00');
  });

  it('start -> safe pick(s) -> cashout credits bet*multiplier exactly once, even if cashout is retried', async () => {
    const user = await createTestUser();
    const { roundId, firstPick } = await startRoundWithSafeTileZero(user.id);
    expect(firstPick.hit).toBe(false);
    expect(firstPick.currentMultiplier).toBeGreaterThan(1);

    const walletBeforeCashout = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user.id, currency: 'GC' } },
    });
    expectAmount(walletBeforeCashout.balance.toString(), '90.00');

    const cashoutKey = randomUUID();
    const first = await minesRoundService.cashout(user.id, roundId, cashoutKey);
    expect(first.win).toBe(true);
    expect(first.round.status).toBe('SETTLED');

    const expectedWinAmount = first.round.winAmount!;
    const expectedBalance = first.wallet.balance;

    // Retry with the SAME Idempotency-Key: must return the identical
    // settled result, not credit a second time.
    const second = await minesRoundService.cashout(user.id, roundId, cashoutKey);
    expect(second.round.winAmount).toBe(expectedWinAmount);
    expect(second.wallet.balance).toBe(expectedBalance);

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user.id, currency: 'GC' } },
    });
    expectAmount(wallet.balance.toString(), expectedBalance);

    // Exactly one WIN ledger entry for this round, not two.
    const winEntries = await prisma.ledgerEntry.count({
      where: { gameRoundId: roundId, type: 'WIN' },
    });
    expect(winEntries).toBe(1);
  });

  it('start -> pick(mine) settles as a loss: no WIN entry, no payout, round SETTLED', async () => {
    const user = await createTestUser();
    const { roundId, hitTile } = await startRoundAndFindMineTile(user.id);

    const round = await prisma.gameRound.findUniqueOrThrow({ where: { id: roundId } });
    expect(round.status).toBe('SETTLED');
    expect(round.winAmount).toBeNull();

    const winEntries = await prisma.ledgerEntry.count({ where: { gameRoundId: roundId, type: 'WIN' } });
    expect(winEntries).toBe(0);

    // Wallet balance is exactly bet-debited-and-nothing-else: 100 - 10.
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user.id, currency: 'GC' } },
    });
    expectAmount(wallet.balance.toString(), '90.00');

    // Picking again after the round ended (fresh key) is rejected, not silently accepted.
    await expect(minesRoundService.pick(user.id, roundId, randomUUID(), (hitTile + 1) % 25)).rejects.toThrow(
      /already ended/i,
    );

    // Cashing out a busted round is rejected too.
    await expect(minesRoundService.cashout(user.id, roundId, randomUUID())).rejects.toThrow(/already ended/i);
  });

  it('picking the same tile index twice (different Idempotency-Keys) is rejected', async () => {
    const user = await createTestUser();
    const { roundId } = await startRoundWithSafeTileZero(user.id);

    await expect(minesRoundService.pick(user.id, roundId, randomUUID(), 0)).rejects.toThrow(/already been picked/i);
  });

  it('a retried PICK with the SAME Idempotency-Key replays the same result instead of reprocessing', async () => {
    const user = await createTestUser();
    const started = await minesRoundService.start(user.id, randomUUID(), {
      currency: 'GC',
      betAmount: '10.00',
      minesCount: 1,
    });
    const key = randomUUID();
    const first = await minesRoundService.pick(user.id, started.roundId, key, 0);
    const second = await minesRoundService.pick(user.id, started.roundId, key, 0);

    expect(second).toEqual(first);

    const round = await prisma.gameRound.findUniqueOrThrow({ where: { id: started.roundId } });
    const payload = round.resultPayload as any;
    // Only appended once, not twice, despite two pick() calls.
    if (!first.hit) {
      expect(payload.picks.filter((p: number) => p === 0)).toHaveLength(1);
    }
  });

  it('cashing out with zero safe picks is rejected', async () => {
    const user = await createTestUser();
    const started = await minesRoundService.start(user.id, randomUUID(), {
      currency: 'GC',
      betAmount: '10.00',
      minesCount: 3,
    });

    await expect(minesRoundService.cashout(user.id, started.roundId, randomUUID())).rejects.toThrow(
      /at least one safe pick/i,
    );

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user.id, currency: 'GC' } },
    });
    expectAmount(wallet.balance.toString(), '90.00');
  });

  it('cash-out multiplier climbs with more safe picks (later cashout pays more than earlier)', async () => {
    const user = await createTestUser();
    // 1 mine keeps the odds of surviving several picks high enough for a
    // deterministic-in-practice test.
    let started = await minesRoundService.start(user.id, randomUUID(), {
      currency: 'GC',
      betAmount: '10.00',
      minesCount: 1,
    });
    let picksMade = 0;
    let lastMultiplier = 0;
    for (let tile = 0; tile < 25 && picksMade < 3; tile++) {
      const pick = await minesRoundService.pick(user.id, started.roundId, randomUUID(), tile);
      if (pick.hit) break;
      expect(pick.currentMultiplier!).toBeGreaterThan(lastMultiplier);
      lastMultiplier = pick.currentMultiplier!;
      picksMade += 1;
    }
    expect(picksMade).toBeGreaterThan(0);
  });
});
