import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GameRound, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PostEntryInput, WalletService } from '../../wallet/wallet.service';
import {
  deriveFloats,
  generateClientSeed,
  generateServerSeed,
  hashServerSeed,
} from '../../../libs/provably-fair/provably-fair';
import { toCents } from '../../../libs/money/money';
import { SLOT_GAME_REGISTRY, isSlotGameKey } from './games/registry';
import { playRound, RoundResult } from './engine/round';
import { GameConfig } from './engine/types';
import { buildDevFloats, DevScenario } from './engine/dev-fixtures';
import { SlotSpinDto } from './dto/slot-spin.dto';

const SC_FEATURE_FLAG_KEY = 'originals.sc_enabled';
const SC_BLOCKED_JURISDICTION_STATUSES = ['GC_ONLY', 'SC_DISABLED', 'BLOCKED'];

@Injectable()
export class SlotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  private assertGame(game: string): GameConfig {
    if (!isSlotGameKey(game)) {
      throw new NotFoundException({ code: 'GAME_NOT_SUPPORTED', message: `'${game}' is not a known slot.` });
    }
    return SLOT_GAME_REGISTRY[game];
  }

  async getConfig(userId: string, game: string) {
    const config = this.assertGame(game);
    const seed = await this.getOrCreateActiveSeed(userId);

    return {
      game: config.gameKey,
      reels: config.reels,
      rows: config.rows,
      paylineCount: config.paylines.length,
      minBet: config.minBet,
      maxBet: config.maxBet,
      symbols: Object.values(config.symbols).map((s) => ({ id: s.id, role: s.role, name: s.name })),
      paytable: config.paytable,
      freeSpins: config.freeSpins,
      freeSpinsMultiplier: config.freeSpinsMultiplier
        ? { startMultiplier: config.freeSpinsMultiplier.startMultiplier, maxMultiplier: config.freeSpinsMultiplier.maxMultiplier }
        : null,
      seed: {
        serverSeedHash: seed.serverSeedHash,
        clientSeed: seed.clientSeed,
        nonce: seed.nonceCounter.toString(),
      },
    };
  }

  async spin(userId: string, game: string, idempotencyKey: string, dto: SlotSpinDto) {
    const config = this.assertGame(game);

    if (toCents(dto.betAmount) <= 0n) {
      throw new BadRequestException({ code: 'INVALID_BET_AMOUNT', message: 'betAmount must be positive.' });
    }
    if (toCents(dto.betAmount) < toCents(config.minBet) || toCents(dto.betAmount) > toCents(config.maxBet)) {
      throw new BadRequestException({
        code: 'BET_OUT_OF_RANGE',
        message: `betAmount must be between ${config.minBet} and ${config.maxBet}.`,
      });
    }

    // GC-first per the design spec: SC play on this slot stays behind the
    // same feature flag + jurisdiction checks Originals already uses,
    // rather than being auto-enabled just because the game exists.
    if (dto.currency === 'SC') {
      await this.assertScAllowed(userId);
    }

    const gameRow = await this.lookupGame(config.gameKey);
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId_currency: { userId, currency: dto.currency } },
    });
    if (!wallet) {
      throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: 'Wallet not found.' });
    }

    // Same idempotent-replay guarantee as Originals: a retried request with
    // the same Idempotency-Key must return the already-settled round
    // rather than consuming another nonce / deriving a new result.
    const replay = await this.findReplayedRound(wallet.id, idempotencyKey);
    if (replay) {
      return this.toSpinResponse(config, replay, true);
    }

    const seed = await this.getOrCreateActiveSeed(userId);
    const nonce = Number(seed.nonceCounter);
    const floats = deriveFloats(seed.serverSeed, seed.clientSeed, nonce, config.maxFloatsPerRound);
    return this.settleRound(userId, config, gameRow, wallet, idempotencyKey, dto, seed, nonce, floats);
  }

  /**
   * Dev-only: same settlement path as `spin()` (real debit/credit, real
   * GameRound row, real ledger idempotency) but with the RNG floats
   * replaced by a crafted scenario from dev-fixtures.ts instead of a real
   * provably-fair derivation. Only ever called from
   * slots-dev.controller.ts, which 404s outside non-production — there is
   * no way for a real player request to reach this method.
   */
  async devSpin(userId: string, game: string, idempotencyKey: string, dto: SlotSpinDto, scenario: string) {
    const config = this.assertGame(game);
    const gameRow = await this.lookupGame(config.gameKey);
    const wallet = await this.prisma.wallet.findUnique({ where: { userId_currency: { userId, currency: dto.currency } } });
    if (!wallet) {
      throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: 'Wallet not found.' });
    }
    const seed = await this.getOrCreateActiveSeed(userId);
    const nonce = Number(seed.nonceCounter);
    const floats = buildDevFloats(config, scenario as DevScenario);
    return this.settleRound(userId, config, gameRow, wallet, idempotencyKey, dto, seed, nonce, floats);
  }

  private async settleRound(
    userId: string,
    config: GameConfig,
    gameRow: { id: string },
    wallet: { id: string },
    idempotencyKey: string,
    dto: SlotSpinDto,
    seed: { id: string; serverSeed: string; serverSeedHash: string; clientSeed: string },
    nonce: number,
    floats: number[],
  ) {
    const result = playRound(config, floats);

    const round = await this.prisma.gameRound.create({
      data: {
        userId,
        gameId: gameRow.id,
        currency: dto.currency,
        status: 'OPEN',
        betAmount: dto.betAmount,
        serverSeedHash: seed.serverSeedHash,
        clientSeed: seed.clientSeed,
        nonce,
        resultPayload: { pending: true } as Prisma.InputJsonValue,
      },
    });

    const entries: PostEntryInput[] = [
      {
        type: 'BET',
        amount: `-${dto.betAmount}`,
        source: 'GAME',
        idempotencyKey: `${idempotencyKey}:bet`,
        gameRoundId: round.id,
      },
    ];

    let winAmount: string | null = null;
    if (result.totalMultiplier > 0) {
      winAmount = multiplyAmount(dto.betAmount, result.totalMultiplier);
      entries.push({
        type: 'WIN',
        amount: winAmount,
        source: 'GAME',
        idempotencyKey: `${idempotencyKey}:win`,
        gameRoundId: round.id,
      });
    }

    let postResult;
    try {
      postResult = await this.walletService.postEntries(userId, dto.currency, entries);
    } catch (err) {
      await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: 'ROLLED_BACK' } });
      throw err;
    }

    const settled = await this.prisma.gameRound.update({
      where: { id: round.id },
      data: {
        status: 'SETTLED',
        winAmount: winAmount ?? undefined,
        multiplier: result.totalMultiplier,
        resultPayload: serializeRoundResult(result) as unknown as Prisma.InputJsonValue,
        settledAt: new Date(),
      },
    });

    await this.prisma.provablyFairSeed.update({
      where: { id: seed.id },
      data: { nonceCounter: { increment: 1 } },
    });

    await this.prisma.recentlyPlayed.upsert({
      where: { userId_gameId: { userId, gameId: gameRow.id } },
      create: { userId, gameId: gameRow.id },
      update: { lastPlayedAt: new Date(), playCount: { increment: 1 } },
    });

    return {
      ...this.toSpinResponse(config, settled, false),
      wallet: { currency: dto.currency, balance: postResult.balanceAfter },
    };
  }

  async getHistory(userId: string, game: string, opts: { cursor?: string; limit?: number }) {
    const config = this.assertGame(game);
    const gameRow = await this.lookupGame(config.gameKey);
    const limit = Math.min(opts.limit ?? 20, 100);

    const rounds = await this.prisma.gameRound.findMany({
      where: { userId, gameId: gameRow.id },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });

    const hasMore = rounds.length > limit;
    const page = hasMore ? rounds.slice(0, limit) : rounds;

    return {
      rounds: page.map((r) => ({
        id: r.id,
        currency: r.currency,
        betAmount: r.betAmount.toString(),
        winAmount: r.winAmount?.toString() ?? null,
        multiplier: r.multiplier?.toString() ?? null,
        resultPayload: r.resultPayload,
        createdAt: r.createdAt,
        settledAt: r.settledAt,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  private async assertScAllowed(userId: string) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key: SC_FEATURE_FLAG_KEY } });
    if (!flag?.enabled) {
      throw new ForbiddenException({ code: 'FEATURE_DISABLED', message: 'SC play on this game is not currently enabled.' });
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { stateOfRecord: true } });
    const state = user?.stateOfRecord;
    const jurisdiction = state ? await this.prisma.jurisdiction.findUnique({ where: { state } }) : null;
    const status = jurisdiction?.status ?? 'BLOCKED';
    if (SC_BLOCKED_JURISDICTION_STATUSES.includes(status)) {
      throw new ForbiddenException({
        code: 'JURISDICTION_RESTRICTED',
        message: `SC play is not available in your jurisdiction${state ? ` (${state})` : ''}.`,
      });
    }
  }

  private async getOrCreateActiveSeed(userId: string) {
    const existing = await this.prisma.provablyFairSeed.findFirst({ where: { userId, active: true } });
    if (existing) return existing;
    const serverSeed = generateServerSeed();
    return this.prisma.provablyFairSeed.create({
      data: {
        userId,
        serverSeed,
        serverSeedHash: hashServerSeed(serverSeed),
        clientSeed: generateClientSeed(),
        nonceCounter: 0,
        active: true,
      },
    });
  }

  private async lookupGame(slug: string) {
    const row = await this.prisma.game.findUnique({ where: { slug } });
    if (!row) {
      throw new NotFoundException({
        code: 'GAME_NOT_FOUND',
        message: `No catalog entry for slot '${slug}' — seed a Game row with this slug under an INTERNAL provider.`,
      });
    }
    return row;
  }

  private async findReplayedRound(walletId: string, idempotencyKey: string): Promise<GameRound | null> {
    const entry = await this.prisma.ledgerEntry.findUnique({
      where: { walletId_idempotencyKey: { walletId, idempotencyKey: `${idempotencyKey}:bet` } },
    });
    if (!entry?.gameRoundId) return null;
    return this.prisma.gameRound.findUnique({ where: { id: entry.gameRoundId } });
  }

  private toSpinResponse(config: GameConfig, round: GameRound, replay: boolean) {
    return {
      round: {
        id: round.id,
        status: round.status,
        currency: round.currency,
        betAmount: round.betAmount.toString(),
        winAmount: round.winAmount?.toString() ?? null,
        multiplier: round.multiplier?.toString() ?? null,
        result: round.resultPayload,
        serverSeedHash: round.serverSeedHash,
        serverSeedRevealed: round.serverSeedRevealed,
        clientSeed: round.clientSeed,
        nonce: round.nonce.toString(),
      },
      win: round.winAmount != null && Number(round.winAmount) > 0,
      replay,
    };
  }
}

/** betAmount ("10.00") * multiplier (2.5) -> "25.00", 2dp decimal string — same convention as apply-multiplier.ts uses for Originals. */
function multiplyAmount(betAmount: string, multiplier: number): string {
  const cents = toCents(betAmount);
  // Round to nearest cent; multiplier can have more precision than money,
  // this is the single point where slot math meets the 2-decimal ledger.
  const resultCents = BigInt(Math.round(Number(cents) * multiplier));
  const sign = resultCents < 0n ? '-' : '';
  const abs = resultCents < 0n ? -resultCents : resultCents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${sign}${whole}.${frac}`;
}

/** Trims a RoundResult down to what's worth persisting/returning — grids, wins, and the free-spins sequence, nothing engine-internal. */
function serializeRoundResult(result: RoundResult) {
  return {
    base: result.base,
    bonusTriggered: result.bonusTriggered,
    freeSpins: result.freeSpins,
    totalMultiplier: result.totalMultiplier,
    win: result.win,
  };
}
