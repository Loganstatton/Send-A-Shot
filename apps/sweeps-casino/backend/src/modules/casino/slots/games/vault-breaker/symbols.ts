import { SymbolDef } from '../../engine/symbols';

/**
 * Vault Breaker's symbol roster. IDs are stable strings used in reel
 * strips, the paytable, and API responses — the frontend maps each ID to
 * its artwork/animation, the engine only cares about `role`/`substitutable`.
 */
export const VAULT_BREAKER_SYMBOLS: Record<string, SymbolDef> = {
  // Low symbols — redesigned card ranks, not raw playing-card art.
  TEN: { id: 'TEN', role: 'PAYING', name: '10', substitutable: true },
  JACK: { id: 'JACK', role: 'PAYING', name: 'J', substitutable: true },
  QUEEN: { id: 'QUEEN', role: 'PAYING', name: 'Q', substitutable: true },
  KING: { id: 'KING', role: 'PAYING', name: 'K', substitutable: true },
  ACE: { id: 'ACE', role: 'PAYING', name: 'A', substitutable: true },

  // High symbols.
  COIN_STACK: { id: 'COIN_STACK', role: 'PAYING', name: 'Gold Coin Stack', substitutable: true },
  LASER_DEVICE: { id: 'LASER_DEVICE', role: 'PAYING', name: 'Laser Device', substitutable: true },
  VAULT_KEY: { id: 'VAULT_KEY', role: 'PAYING', name: 'Vault Key', substitutable: true },
  DIAMOND: { id: 'DIAMOND', role: 'PAYING', name: 'Diamond', substitutable: true },
  GOLD_BAR: { id: 'GOLD_BAR', role: 'PAYING', name: 'Gold Bar', substitutable: true },
  VAULTLINE_EMBLEM: { id: 'VAULTLINE_EMBLEM', role: 'PAYING', name: 'Vaultline Emblem', substitutable: true },

  // Special symbols.
  WILD: { id: 'WILD', role: 'WILD', name: 'Wild', substitutable: false },
  SCATTER: { id: 'SCATTER', role: 'SCATTER', name: 'Vault Door', substitutable: false },
};
