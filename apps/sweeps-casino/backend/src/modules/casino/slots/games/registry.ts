import { GameConfig } from '../engine/types';
import { VAULT_BREAKER_CONFIG } from './vault-breaker/config';

/**
 * Every slot this engine can run, keyed by the Game catalog `slug`. Adding
 * a second slot is: a new games/<slug>/{symbols,paylines,paytable,reel-
 * strips,config}.ts (following vault-breaker/ as the template) + one line
 * here — the engine itself (round.ts, reels.ts, payline-evaluator.ts) is
 * unchanged.
 */
export const SLOT_GAME_REGISTRY: Record<string, GameConfig> = {
  'vault-breaker': VAULT_BREAKER_CONFIG,
};

export function isSlotGameKey(value: string): boolean {
  return value in SLOT_GAME_REGISTRY;
}
