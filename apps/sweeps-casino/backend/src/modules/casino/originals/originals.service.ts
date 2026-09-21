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
import { applyMultiplier } from './apply-multiplier';
import { isOriginalGameKey, ORIGINALS_CONFIG, OriginalGameKey } from './originals.constants';
import { computeOutcome, floatsNeededFor, normalizeParams } from './outcome.dispatcher';
import { OriginalsPlayDto } from './dto/originals-play.dto';

const SC_FEATURE_FLAG_KEY = 'originals.sc_enabled';
const SC_BLOCKED_JURISDICTION_STATUSES = ['GC_ONLY', 'SC_DISABLED', 'BLOCKED'];

@Injectable()
export class OriginalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  private assertGame(game: string): asserts game is OriginalGameKey {
    if (!isOriginalGameKey(game)) {
      throw new NotFoundException({
        code: 'GAME_NOT_SUPPORTED',
        message: `'${game}' is not a Phase 1 Originals game (dice, mines, plinko).`,
      });
    }
  }

  async getConfig(userId: string, game: string) {
    this.assertGame(game);
    const cfg = ORIGINALS_CONFIG[game];
    const seed = await this.getOrCreateActiveSeed(userId);

    return {
      game,
      minBet: cfg.minBet,
      maxBet: cfg.maxBet,
      houseEdgeBps: cfg.houseEdgeBps,
      seed: {
        serverSeedHash: seed.serverSeedHash,
        clientSeed: seed.clientSeed,
        nonce: seed.nonceCounter.toString(),
      },
    };
  }

  async play(userId: string, game: string, idempotencyKey: string, dto: OriginalsPlayDto) {
    this.assertGame(game);
    const cfg = ORIGINALS_CONFIG[game];

    if (toCents(dto.betAmount) <= 0n) {
      throw new BadRequestException({ code: 'INVALID_BET_AMOUNT', message: 'betAmount must be positive.' });
    }
    if (toCents(dto.betAmount) < toCents(cfg.minBet) || toCents(dto.betAmount) > toCents(cfg.maxBet)) {
      throw new BadRequestException({
        code: 'BET_OUT_OF_RANGE',
        message: `betAmount must be between ${cfg.minBet} and ${cfg.maxBet}.`,
      });
    }

    if (dto.currency === 'SC') {
      await this.assertScAllowed(userId);
    }

    const gameRow = await this.lookupGame(game);
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId_currency: { userId, currency: dto.currency } },
    });
    if (!wallet) {
      throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: 'Wallet not found.' });
    }

    // Idempotent replay: a retried request with the same Idempotency-Key
    // must not re-derive a new outcome — that would advance the seed
    // nonce and could compute a different result for what the client
    // believes is the same bet. Ledger entries are already idempotency-
    // safe inside WalletService; this short-circuit keeps the GameRound
    // and the derived outcome consistent with that same guarantee.
    const replay = await this.findReplayedRound(wallet.id, idempotencyKey);
    if (replay) {
      return this.toPlayResponse(replay, true);
    }

    const params = normalizeParams(game, {
      target: dto.target,
      direction: dto.direction,
      minesCount: dto.minesCount,
      picks: dto.picks,
      rows: dto.rows,
      risk: dto.risk,
    });

    const seed = await this.getOrCreateActiveSeed(userId);
    const nonce = seed.nonceCounter;
    const floatsNeeded = floatsNeededFor(game, params);
    const floats = deriveFloats(seed.serverSeed, seed.clientSeed, nonce, floatsNeeded);
    const outcome = computeOutcome(game, floats, params, cfg.houseEdgeBps);

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
    if (outcome.multiplier > 0) {
      winAmount = applyMultiplier(dto.betAmount, outcome.multiplier);
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
      // Wallet rejected the round (most commonly INSUFFICIENT_BALANCE) —
      // the round never settled, so it's not an audit-log-worthy played
      // round. GameRoundStatus has no dedicated "FAILED" value, so
      // ROLLED_BACK is the closest fit for "opened but never settled."
      await this.prisma.gameRound.update({
        where: { id: round.id },
        data: { status: 'ROLLED_BACK' },
      });
      throw err;
    }

    const settled = await this.prisma.gameRound.update({
      where: { id: round.id },
      data: {
        status: 'SETTLED',
        winAmount: winAmount ?? undefined,
        multiplier: outcome.multiplier,
        resultPayload: outcome.result as Prisma.InputJsonValue,
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
      ...this.toPlayResponse(settled, false),
      wallet: { currency: dto.currency, balance: postResult.balanceAfter },
    };
  }

  async getHistory(userId: string, game: string, opts: { cursor?: string; limit?: number }) {
    this.assertGame(game);
    const gameRow = await this.lookupGame(game);
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
      rounds: page.map((r) => this.toHistoryEntry(r)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async getSeeds(userId: string) {
    const active = await this.getOrCreateActiveSeed(userId);
    const history = await this.prisma.provablyFairSeed.findMany({
      where: { userId, active: false },
      orderBy: { createdAt: 'desc' },
    });

    return {
      active: {
        id: active.id,
        serverSeedHash: active.serverSeedHash,
        clientSeed: active.clientSeed,
        nonce: active.nonceCounter.toString(),
        createdAt: active.createdAt,
      },
      history: history.map((s) => ({
        id: s.id,
        serverSeedHash: s.serverSeedHash,
        serverSeedRevealed: s.serverSeedRevealed,
        clientSeed: s.clientSeed,
        nonce: s.nonceCounter.toString(),
        revealedAt: s.revealedAt,
        createdAt: s.createdAt,
      })),
    };
  }

  async rotateSeed(userId: string, newClientSeed?: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.provablyFairSeed.findFirst({ where: { userId, active: true } });
      if (current) {
        await tx.provablyFairSeed.update({
          where: { id: current.id },
          data: {
            active: false,
            serverSeedRevealed: current.serverSeed,
            revealedAt: new Date(),
          },
        });
      }

      const serverSeed = generateServerSeed();
      const created = await tx.provablyFairSeed.create({
        data: {
          userId,
          serverSeed,
          serverSeedHash: hashServerSeed(serverSeed),
          clientSeed: newClientSeed?.trim() || generateClientSeed(),
          nonceCounter: 0,
          active: true,
        },
      });

      return {
        active: {
          id: created.id,
          serverSeedHash: created.serverSeedHash,
          clientSeed: created.clientSeed,
          nonce: created.nonceCounter.toString(),
        },
        previous: current
          ? {
              id: current.id,
              serverSeedHash: current.serverSeedHash,
              serverSeedRevealed: current.serverSeed,
              revealedAt: new Date(),
            }
          : null,
      };
    });
  }

  async updateClientSeed(userId: string, clientSeed: string) {
    const active = await this.getOrCreateActiveSeed(userId);
    const updated = await this.prisma.provablyFairSeed.update({
      where: { id: active.id },
      data: { clientSeed },
    });

    return {
      id: updated.id,
      serverSeedHash: updated.serverSeedHash,
      clientSeed: updated.clientSeed,
      nonce: updated.nonceCounter.toString(),
    };
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

  private async lookupGame(game: OriginalGameKey) {
    const row = await this.prisma.game.findUnique({ where: { slug: game } });
    if (!row) {
      throw new NotFoundException({
        code: 'GAME_NOT_FOUND',
        message: `No catalog entry for Original '${game}' — seed a Game row with slug='${game}' under an INTERNAL provider.`,
      });
    }
    return row;
  }

  private async assertScAllowed(userId: string) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key: SC_FEATURE_FLAG_KEY } });
    if (!flag?.enabled) {
      throw new ForbiddenException({
        code: 'FEATURE_DISABLED',
        message: 'SC play on Originals is not currently enabled.',
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { stateOfRecord: true },
    });
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

  private async findReplayedRound(walletId: string, idempotencyKey: string): Promise<GameRound | null> {
    const entry = await this.prisma.ledgerEntry.findUnique({
      where: { walletId_idempotencyKey: { walletId, idempotencyKey: `${idempotencyKey}:bet` } },
    });
    if (!entry?.gameRoundId) return null;
    return this.prisma.gameRound.findUnique({ where: { id: entry.gameRoundId } });
  }

  private toPlayResponse(round: GameRound, replay: boolean) {
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
        clientSeed: round.clientSeed,
        nonce: round.nonce.toString(),
      },
      win: round.winAmount != null && Number(round.winAmount) > 0,
      replay,
    };
  }

  private toHistoryEntry(round: GameRound) {
    return {
      id: round.id,
      status: round.status,
      currency: round.currency,
      betAmount: round.betAmount.toString(),
      winAmount: round.winAmount?.toString() ?? null,
      multiplier: round.multiplier?.toString() ?? null,
      resultPayload: round.resultPayload,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      nonce: round.nonce.toString(),
      createdAt: round.createdAt,
      settledAt: round.settledAt,
    };
  }
}
