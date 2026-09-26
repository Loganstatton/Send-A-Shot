import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Game, GameRound, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { PostEntryInput, WalletService } from '../../../wallet/wallet.service';
import {
  deriveFloats,
  generateClientSeed,
  generateServerSeed,
  hashServerSeed,
} from '../../../../libs/provably-fair/provably-fair';
import { toCents } from '../../../../libs/money/money';
import { applyMultiplier } from '../apply-multiplier';
import { ORIGINALS_CONFIG } from '../originals.constants';
import { computeMinesMultiplier, deriveMinePositions, MINES_FLOATS_NEEDED, MINES_GRID_SIZE } from './mines.outcome';
import { StartMinesRoundDto } from './dto/start-round.dto';

const SC_FEATURE_FLAG_KEY = 'originals.sc_enabled';
const SC_BLOCKED_JURISDICTION_STATUSES = ['GC_ONLY', 'SC_DISABLED', 'BLOCKED'];
const MINES_CFG = ORIGINALS_CONFIG.mines;

/** One resolved pick request, cached under its Idempotency-Key so a retry
 * (same key) replays this exact response instead of reprocessing the pick
 * — see `pick()` below. */
interface PickLogEntry {
  tileIndex: number;
  response: PickResult;
}

/**
 * The full interactive-round state held in `GameRound.resultPayload` while
 * `status: OPEN`, and left in place (mine positions now safe to expose)
 * once the round is `SETTLED`. This is intentionally NOT the same shape as
 * the legacy single-shot mines.outcome.ts `result` — that one models "all
 * picks submitted at once"; this one models "picks accumulate one at a
 * time," so it also carries `pickLog` for pick-level idempotency, which a
 * settle-in-one-shot round never needed.
 */
interface MinesRoundState {
  minesCount: number;
  /** Server-only while OPEN — never spread into a response until the round is SETTLED. */
  minePositions: number[];
  /** Safe tile indices, in pick order. */
  picks: number[];
  hitMine: boolean;
  hitTileIndex: number | null;
  pickLog: Record<string, PickLogEntry>;
}

interface PickResult {
  hit: boolean;
  tileIndex: number;
  picks: number[];
  roundStatus: 'OPEN' | 'SETTLED';
  currentMultiplier: number | null;
  potentialPayout: string | null;
  minePositions: number[] | null;
}

@Injectable()
export class MinesRoundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  async start(userId: string, idempotencyKey: string, dto: StartMinesRoundDto) {
    if (toCents(dto.betAmount) <= 0n) {
      throw new BadRequestException({ code: 'INVALID_BET_AMOUNT', message: 'betAmount must be positive.' });
    }
    if (toCents(dto.betAmount) < toCents(MINES_CFG.minBet) || toCents(dto.betAmount) > toCents(MINES_CFG.maxBet)) {
      throw new BadRequestException({
        code: 'BET_OUT_OF_RANGE',
        message: `betAmount must be between ${MINES_CFG.minBet} and ${MINES_CFG.maxBet}.`,
      });
    }
    if (!Number.isInteger(dto.minesCount) || dto.minesCount < 1 || dto.minesCount > 24) {
      throw new BadRequestException({
        code: 'INVALID_PARAMS',
        message: 'minesCount must be an integer between 1 and 24.',
      });
    }
    if (dto.currency === 'SC') {
      await this.assertScAllowed(userId);
    }

    const gameRow = await this.lookupGame();
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId_currency: { userId, currency: dto.currency } },
    });
    if (!wallet) {
      throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: 'Wallet not found.' });
    }

    // Idempotent replay of START: a retried request with the same key must
    // not debit twice, derive a new mine layout, or consume another nonce
    // — mirrors OriginalsService.findReplayedRound exactly (look up the
    // BET ledger entry by idempotency key first).
    const replay = await this.findRoundByLedgerKey(wallet.id, `${idempotencyKey}:bet`);
    if (replay) {
      const state = replay.resultPayload as unknown as MinesRoundState;
      return {
        roundId: replay.id,
        minesCount: state.minesCount,
        betAmount: replay.betAmount.toString(),
        currency: replay.currency,
        replay: true,
      };
    }

    const seed = await this.getOrCreateActiveSeed(userId);
    const nonce = seed.nonceCounter;
    const floats = deriveFloats(seed.serverSeed, seed.clientSeed, nonce, MINES_FLOATS_NEEDED);
    const minePositions = deriveMinePositions(floats, dto.minesCount);

    const initialState: MinesRoundState = {
      minesCount: dto.minesCount,
      minePositions,
      picks: [],
      hitMine: false,
      hitTileIndex: null,
      pickLog: {},
    };

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
        resultPayload: initialState as unknown as Prisma.InputJsonValue,
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

    try {
      await this.walletService.postEntries(userId, dto.currency, entries);
    } catch (err) {
      // Same "opened but never settled -> ROLLED_BACK" convention as the
      // single-shot flow (originals.service.ts) — most commonly
      // INSUFFICIENT_BALANCE.
      await this.prisma.gameRound.update({ where: { id: round.id }, data: { status: 'ROLLED_BACK' } });
      throw err;
    }

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
      roundId: round.id,
      minesCount: dto.minesCount,
      betAmount: dto.betAmount,
      currency: dto.currency,
      replay: false,
    };
  }

  async pick(userId: string, roundId: string, idempotencyKey: string, tileIndex: number): Promise<PickResult> {
    const round = await this.loadOwnedRound(userId, roundId);
    const state = round.resultPayload as unknown as MinesRoundState;

    // Idempotent replay: the SAME key for a pick already processed returns
    // the exact cached response rather than touching `picks` again.
    const cached = state.pickLog[idempotencyKey];
    if (cached) {
      if (cached.tileIndex !== tileIndex) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'This Idempotency-Key was already used for a different tile.',
        });
      }
      return cached.response;
    }

    if (round.status !== 'OPEN') {
      throw new ConflictException({
        code: 'ROUND_NOT_OPEN',
        message: 'This round has already ended.',
      });
    }
    if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= MINES_GRID_SIZE) {
      throw new BadRequestException({ code: 'INVALID_TILE', message: 'tileIndex must be an integer between 0 and 24.' });
    }
    // A different Idempotency-Key re-requesting a tile that's already been
    // picked (safe or the mine that ended the round) is a client bug, not
    // a legitimate retry — reject rather than silently reprocessing.
    if (state.picks.includes(tileIndex) || state.hitTileIndex === tileIndex) {
      throw new ConflictException({ code: 'TILE_ALREADY_PICKED', message: 'That tile has already been picked.' });
    }

    const hit = state.minePositions.includes(tileIndex);
    let response: PickResult;

    if (hit) {
      state.hitMine = true;
      state.hitTileIndex = tileIndex;
      response = {
        hit: true,
        tileIndex,
        picks: state.picks,
        roundStatus: 'SETTLED',
        currentMultiplier: null,
        potentialPayout: null,
        minePositions: state.minePositions,
      };
      state.pickLog[idempotencyKey] = { tileIndex, response };

      await this.prisma.gameRound.update({
        where: { id: round.id },
        data: {
          status: 'SETTLED',
          multiplier: 0,
          resultPayload: state as unknown as Prisma.InputJsonValue,
          settledAt: new Date(),
        },
      });
    } else {
      state.picks.push(tileIndex);
      const { multiplier } = computeMinesMultiplier(state.minesCount, state.picks.length, MINES_CFG.houseEdgeBps);
      const potentialPayout = applyMultiplier(round.betAmount.toString(), multiplier);
      response = {
        hit: false,
        tileIndex,
        picks: state.picks,
        roundStatus: 'OPEN',
        currentMultiplier: multiplier,
        potentialPayout,
        minePositions: null,
      };
      state.pickLog[idempotencyKey] = { tileIndex, response };

      await this.prisma.gameRound.update({
        where: { id: round.id },
        data: { resultPayload: state as unknown as Prisma.InputJsonValue },
      });
    }

    return response;
  }

  async cashout(userId: string, roundId: string, idempotencyKey: string) {
    const round = await this.loadOwnedRound(userId, roundId);
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId_currency: { userId, currency: round.currency } },
    });
    if (!wallet) {
      throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: 'Wallet not found.' });
    }

    // Idempotent replay of CASHOUT: same key -> return the already-settled
    // round rather than crediting a second time. Mirrors the START/`:bet`
    // replay above, keyed on the `:win` ledger entry instead.
    const replayEntry = await this.prisma.ledgerEntry.findUnique({
      where: { walletId_idempotencyKey: { walletId: wallet.id, idempotencyKey: `${idempotencyKey}:win` } },
    });
    if (replayEntry) {
      if (replayEntry.gameRoundId !== round.id) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'This Idempotency-Key was already used for a different round.',
        });
      }
      const settled = await this.prisma.gameRound.findUniqueOrThrow({ where: { id: round.id } });
      return {
        ...this.toRoundResponse(settled, true),
        wallet: { currency: round.currency, balance: replayEntry.balanceAfter.toString() },
      };
    }

    if (round.status !== 'OPEN') {
      throw new ConflictException({ code: 'ROUND_NOT_OPEN', message: 'This round has already ended.' });
    }

    const state = round.resultPayload as unknown as MinesRoundState;
    if (state.picks.length === 0) {
      throw new ConflictException({
        code: 'NO_SAFE_PICKS',
        message: 'Cash out requires at least one safe pick.',
      });
    }

    const { multiplier } = computeMinesMultiplier(state.minesCount, state.picks.length, MINES_CFG.houseEdgeBps);
    const winAmount = applyMultiplier(round.betAmount.toString(), multiplier);

    let postResult;
    try {
      postResult = await this.walletService.postEntries(userId, round.currency, [
        {
          type: 'WIN',
          amount: winAmount,
          source: 'GAME',
          idempotencyKey: `${idempotencyKey}:win`,
          gameRoundId: round.id,
        },
      ]);
    } catch (err) {
      // Wallet-level failure here would be a platform bug (crediting a win
      // can never be "insufficient balance"), but if it ever happens the
      // round must stay OPEN/unsettled rather than silently eating the
      // player's win — same fail-safe posture as the BET path.
      throw err;
    }

    const settledState: MinesRoundState = { ...state, minePositions: state.minePositions };
    const settled = await this.prisma.gameRound.update({
      where: { id: round.id },
      data: {
        status: 'SETTLED',
        winAmount,
        multiplier,
        resultPayload: settledState as unknown as Prisma.InputJsonValue,
        settledAt: new Date(),
      },
    });

    return {
      ...this.toRoundResponse(settled, false),
      wallet: { currency: round.currency, balance: postResult.balanceAfter },
    };
  }

  private async loadOwnedRound(userId: string, roundId: string): Promise<GameRound> {
    const round = await this.prisma.gameRound.findUnique({ where: { id: roundId } });
    if (!round || round.userId !== userId) {
      throw new NotFoundException({ code: 'ROUND_NOT_FOUND', message: 'Round not found.' });
    }
    const gameRow = await this.lookupGame();
    if (round.gameId !== gameRow.id) {
      throw new NotFoundException({ code: 'ROUND_NOT_FOUND', message: 'Round not found.' });
    }
    return round;
  }

  private async findRoundByLedgerKey(walletId: string, idempotencyKey: string): Promise<GameRound | null> {
    const entry = await this.prisma.ledgerEntry.findUnique({
      where: { walletId_idempotencyKey: { walletId, idempotencyKey } },
    });
    if (!entry?.gameRoundId) return null;
    return this.prisma.gameRound.findUnique({ where: { id: entry.gameRoundId } });
  }

  private async lookupGame(): Promise<Game> {
    const row = await this.prisma.game.findUnique({ where: { slug: 'mines' } });
    if (!row) {
      throw new NotFoundException({
        code: 'GAME_NOT_FOUND',
        message: "No catalog entry for Original 'mines' — seed a Game row with slug='mines' under an INTERNAL provider.",
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

  /** Same field shape as OriginalsService.toPlayResponse's `round`, so the
   * frontend's response normalization can treat a Mines cashout like any
   * other settled Originals round. */
  private toRoundResponse(round: GameRound, replay: boolean) {
    const state = round.resultPayload as unknown as MinesRoundState;
    return {
      round: {
        id: round.id,
        status: round.status,
        currency: round.currency,
        betAmount: round.betAmount.toString(),
        winAmount: round.winAmount?.toString() ?? null,
        multiplier: round.multiplier?.toString() ?? null,
        result: {
          minesCount: state.minesCount,
          minePositions: state.minePositions,
          picks: state.picks,
          hitMine: state.hitMine,
        },
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
