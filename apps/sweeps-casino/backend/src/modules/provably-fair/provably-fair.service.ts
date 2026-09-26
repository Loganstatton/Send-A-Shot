import { BadRequestException, Injectable } from '@nestjs/common';
import { verifyRound } from '../../libs/provably-fair/provably-fair';
import { computeOutcome, floatsNeededFor, normalizeParams } from '../casino/originals/outcome.dispatcher';
import { isOriginalGameKey, ORIGINALS_CONFIG } from '../casino/originals/originals.constants';
import { ProvablyFairVerifyDto } from './dto/verify.dto';

@Injectable()
export class ProvablyFairService {
  /**
   * Recomputes a round's outcome from a (serverSeed, clientSeed, nonce,
   * game, gameParams) tuple, calling the exact same per-game outcome
   * functions (via outcome.dispatcher.ts) that POST
   * /casino/originals/:game/play uses — so this endpoint can never
   * disagree with what a player was actually shown/credited.
   */
  verify(dto: ProvablyFairVerifyDto) {
    if (!isOriginalGameKey(dto.game)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_GAME',
        message: `'${dto.game}' is not a supported Originals game.`,
      });
    }

    const params = normalizeParams(dto.game, dto.gameParams);
    const floatsNeeded = floatsNeededFor(dto.game, params);
    const { serverSeedHash, floats } = verifyRound({
      serverSeed: dto.serverSeed,
      clientSeed: dto.clientSeed,
      nonce: dto.nonce,
      floatsNeeded,
    });

    // This public endpoint's request body (per docs/05-api-design.md) has
    // no field for the house edge that was active when the round was
    // played — only the seed triple + game + params — so it recomputes
    // using the Original's current houseEdgeBps. Phase 1 keeps that value
    // constant per game (see originals.constants.ts) so this matches what
    // was actually credited; if house edge ever becomes editable over
    // time, this endpoint would need the historical edge to exactly
    // reproduce a past round's multiplier.
    const houseEdgeBps = ORIGINALS_CONFIG[dto.game].houseEdgeBps;
    const outcome = computeOutcome(dto.game, floats, params, houseEdgeBps);

    return {
      serverSeedHash,
      result: outcome.result,
      win: outcome.win,
      multiplier: outcome.multiplier,
    };
  }
}
