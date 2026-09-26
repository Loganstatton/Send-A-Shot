import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { toCents } from '../../src/libs/money/money';

// Prisma's Decimal#toString() strips trailing zeros ("10.00" -> "10"), so
// balance assertions compare by exact cent value rather than string shape.
function expectAmount(actual: string | { toString(): string }, expectedDecimalString: string) {
  expect(toCents(actual.toString())).toBe(toCents(expectedDecimalString));
}

/**
 * Integration tests against a real Postgres instance (DATABASE_URL env var,
 * see backend/.env.example). These exercise exactly the scenarios the spec
 * calls out as non-negotiable: duplicate bet/win callbacks must only post
 * once, concurrent plays against the same wallet must not race past a
 * negative balance, and insufficient balance must be rejected atomically.
 */

const prisma = new PrismaClient();
const walletService = new WalletService(prisma as unknown as PrismaService);

async function createTestUser() {
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `wallet-test-${suffix}@example.com`,
      username: `wallettest${suffix}`,
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
  return user;
}

describe('WalletService — ledger correctness', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('credits a wallet and records balance_before/balance_after correctly', async () => {
    const user = await createTestUser();

    const result = await walletService.postEntries(user.id, 'GC', [
      {
        type: 'BONUS',
        amount: '100.00',
        source: 'SYSTEM',
        idempotencyKey: randomUUID(),
      },
    ]);

    expectAmount(result.balanceAfter, '100.00');
    expectAmount(result.entries[0].balanceBefore.toString(), '0.00');
    expectAmount(result.entries[0].balanceAfter.toString(), '100.00');

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user.id, currency: 'GC' } },
    });
    expectAmount(wallet.balance.toString(), '100.00');
  });

  it('a duplicate idempotency key is a no-op, not a double credit', async () => {
    const user = await createTestUser();
    const key = randomUUID();

    const first = await walletService.postEntries(user.id, 'GC', [
      { type: 'BONUS', amount: '50.00', source: 'SYSTEM', idempotencyKey: key },
    ]);
    const second = await walletService.postEntries(user.id, 'GC', [
      { type: 'BONUS', amount: '50.00', source: 'SYSTEM', idempotencyKey: key },
    ]);

    expectAmount(first.balanceAfter, '50.00');
    expectAmount(second.balanceAfter, '50.00');
    expect(second.entries[0].id).toBe(first.entries[0].id);

    const count = await prisma.ledgerEntry.count({
      where: { walletId: first.walletId, idempotencyKey: key },
    });
    expect(count).toBe(1);
  });

  it('rejects a bet that would drive the balance negative', async () => {
    const user = await createTestUser();
    await walletService.postEntries(user.id, 'GC', [
      { type: 'BONUS', amount: '10.00', source: 'SYSTEM', idempotencyKey: randomUUID() },
    ]);

    await expect(
      walletService.postEntries(user.id, 'GC', [
        { type: 'BET', amount: '-25.00', source: 'GAME', idempotencyKey: randomUUID() },
      ]),
    ).rejects.toThrow(/Insufficient/i);

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user.id, currency: 'GC' } },
    });
    expectAmount(wallet.balance.toString(), '10.00');
  });

  it('serializes concurrent bets against the same wallet — none push the balance negative', async () => {
    const user = await createTestUser();
    await walletService.postEntries(user.id, 'GC', [
      { type: 'BONUS', amount: '100.00', source: 'SYSTEM', idempotencyKey: randomUUID() },
    ]);

    // 20 concurrent 10.00 bets against a 100.00 balance: exactly 10 should
    // succeed, 10 should be rejected as insufficient — never a negative
    // balance, and never more than 10 successes, regardless of scheduling.
    const attempts = Array.from({ length: 20 }, () =>
      walletService
        .postEntries(user.id, 'GC', [
          { type: 'BET', amount: '-10.00', source: 'GAME', idempotencyKey: randomUUID() },
        ])
        .then(() => 'ok' as const)
        .catch(() => 'rejected' as const),
    );

    const outcomes = await Promise.all(attempts);
    const successes = outcomes.filter((o) => o === 'ok').length;

    expect(successes).toBe(10);

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId: user.id, currency: 'GC' } },
    });
    expectAmount(wallet.balance.toString(), '0.00');

    const ledgerSum = await walletService.computeLedgerBalance(
      (await prisma.wallet.findUniqueOrThrow({
        where: { userId_currency: { userId: user.id, currency: 'GC' } },
      })).id,
    );
    expectAmount(ledgerSum, '0.00');
  });

  it('a BET followed by a WIN in one postEntries call settles atomically', async () => {
    const user = await createTestUser();
    await walletService.postEntries(user.id, 'GC', [
      { type: 'BONUS', amount: '100.00', source: 'SYSTEM', idempotencyKey: randomUUID() },
    ]);

    const key = randomUUID();
    const result = await walletService.postEntries(user.id, 'GC', [
      { type: 'BET', amount: '-10.00', source: 'GAME', idempotencyKey: `${key}:bet` },
      { type: 'WIN', amount: '19.80', source: 'GAME', idempotencyKey: `${key}:win` },
    ]);

    expectAmount(result.balanceAfter, '109.80');
  });

  it('reconcileAllWallets finds no drift after a batch of settled rounds', async () => {
    const user = await createTestUser();
    await walletService.postEntries(user.id, 'GC', [
      { type: 'BONUS', amount: '100.00', source: 'SYSTEM', idempotencyKey: randomUUID() },
    ]);
    for (let i = 0; i < 5; i += 1) {
      const key = randomUUID();
      await walletService.postEntries(user.id, 'GC', [
        { type: 'BET', amount: '-5.00', source: 'GAME', idempotencyKey: `${key}:bet` },
        { type: 'WIN', amount: '4.50', source: 'GAME', idempotencyKey: `${key}:win` },
      ]);
    }

    const drift = await walletService.reconcileAllWallets();
    const walletIds = await prisma.wallet.findMany({ where: { userId: user.id } });
    const thisUsersDrift = drift.filter((d) => walletIds.some((w) => w.id === d.walletId));
    expect(thisUsersDrift).toHaveLength(0);
  });
});
