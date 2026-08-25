import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Same isolation trick as lib/db.test.ts and lib/notifications.test.ts:
// DATA_DIR must be set before lib/db.ts (imported transitively by
// lib/feed-signals.ts) is ever imported, so this runs against a throwaway
// SQLite file instead of the real dev/prod database.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-signals-test-'));

const {
  addToWatchlist, bulkSetArtistStage, createArtist, createUser, db, executeTrade, getFeedEvents,
} = await import('./db');
const { generateFeedSignals, SIGNAL_COOLDOWN_DAYS } = await import('./feed-signals');

function makeArtist(name: string) {
  // Same deterministic breakout_score=80 recipe as lib/db.test.ts's
  // makeArtist — every rated category lands on 8/10.
  return createArtist({
    name, music_talent: 8, growth_velocity_pct: 32, engagement_rate_pct: 16, original_song_response: 8,
    brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8,
  });
}

// getScoreChanges() only looks at score_history rows, independent of the
// artist's live rated columns — so a raw second row is enough to simulate
// "the score changed" without needing the live breakoutScore to move too.
function addScoreHistoryRow(artistId: number, breakoutScore: number, recordedAt: string) {
  db.prepare(`
    INSERT INTO score_history (artist_id, recorded_at, stage, breakout_score, music_talent, growth_velocity, engagement_quality, original_song_response, brand_personality, content_consistency, commercial_potential, professionalism)
    VALUES (?, ?, 'flagship', ?, 8, 8, 8, 8, 8, 8, 8, 8)
  `).run(artistId, recordedAt, breakoutScore);
}

function eventsFor(artistId: number, type: string) {
  return getFeedEvents(200).filter((e) => e.artist_id === artistId && e.event_type === type);
}

describe('generateFeedSignals — score movement', () => {
  it('posts signal_score_up when the score jumps by at least the alert threshold, and does not repeat on a second run', () => {
    const artist = makeArtist('Signal Score Up Artist');
    const later = new Date(Date.now() + 60 * 1000).toISOString();
    addScoreHistoryRow(artist.id, 90, later); // 80 -> 90, +10, crosses ALERT_SCORE_THRESHOLD (5)

    const first = generateFeedSignals();
    expect(first.created).toBeGreaterThan(0);
    expect(eventsFor(artist.id, 'signal_score_up')).toHaveLength(1);

    generateFeedSignals();
    // Cooldown: the same still-true "just jumped" state isn't re-posted.
    expect(eventsFor(artist.id, 'signal_score_up')).toHaveLength(1);
  });

  it('posts signal_score_down when the score drops by at least the alert threshold', () => {
    const artist = makeArtist('Signal Score Down Artist');
    const later = new Date(Date.now() + 60 * 1000).toISOString();
    addScoreHistoryRow(artist.id, 70, later); // 80 -> 70, -10

    generateFeedSignals();
    expect(eventsFor(artist.id, 'signal_score_down')).toHaveLength(1);
    expect(eventsFor(artist.id, 'signal_score_up')).toHaveLength(0);
  });

  it('does not post a score signal for a change below the alert threshold', () => {
    const artist = makeArtist('Signal Score Quiet Artist');
    const later = new Date(Date.now() + 60 * 1000).toISOString();
    addScoreHistoryRow(artist.id, 83, later); // 80 -> 83, +3, below threshold

    generateFeedSignals();
    expect(eventsFor(artist.id, 'signal_score_up')).toHaveLength(0);
    expect(eventsFor(artist.id, 'signal_score_down')).toHaveLength(0);
  });
});

describe('generateFeedSignals — undervalued / overheated', () => {
  it('posts signal_undervalued when price sits well below what the live score implies', () => {
    const artist = makeArtist('Signal Undervalued Artist');
    db.prepare('UPDATE artists SET next_current_price_cents = 100 WHERE id = ?').run(artist.id); // price floor

    generateFeedSignals();
    expect(eventsFor(artist.id, 'signal_undervalued')).toHaveLength(1);
    expect(eventsFor(artist.id, 'signal_overheated')).toHaveLength(0);
  });

  it('posts signal_overheated when price sits well above what the live score implies', () => {
    const artist = makeArtist('Signal Overheated Artist');
    db.prepare('UPDATE artists SET next_current_price_cents = 5000 WHERE id = ?').run(artist.id); // near the top of the pricing curve

    generateFeedSignals();
    expect(eventsFor(artist.id, 'signal_overheated')).toHaveLength(1);
    expect(eventsFor(artist.id, 'signal_undervalued')).toHaveLength(0);
  });

  it('an undervalued state still true 10+ days later is eligible to post again, per the spec\'s own example', () => {
    const artist = makeArtist('Signal Cooldown Expiry Artist');
    db.prepare('UPDATE artists SET next_current_price_cents = 100 WHERE id = ?').run(artist.id);

    generateFeedSignals();
    expect(eventsFor(artist.id, 'signal_undervalued')).toHaveLength(1);

    generateFeedSignals();
    expect(eventsFor(artist.id, 'signal_undervalued')).toHaveLength(1); // still within cooldown

    const staleTimestamp = new Date(Date.now() - (SIGNAL_COOLDOWN_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE feed_events SET created_at = ? WHERE artist_id = ? AND event_type = 'signal_undervalued'")
      .run(staleTimestamp, artist.id);

    generateFeedSignals();
    expect(eventsFor(artist.id, 'signal_undervalued')).toHaveLength(2);
  });
});

describe('generateFeedSignals — market momentum', () => {
  it('posts market_momentum_mover on a large enough price swing within the window', () => {
    const artist = makeArtist('Momentum Mover Artist');
    const buyer = createUser({ name: 'Momentum Buyer', email: 'momentum-buyer@example.com', password_hash: 'hash' });
    db.prepare('UPDATE users SET next_credits_cents = 5000000 WHERE id = ?').run(buyer.id); // enough for a >10% impact buy
    const buy = executeTrade(buyer.id, artist.id, 'buy', 3_000_000); // ~15% impact, well past ALERT_PRICE_PCT_THRESHOLD
    if (!buy.ok) throw new Error(buy.error);

    generateFeedSignals();
    expect(eventsFor(artist.id, 'market_momentum_mover')).toHaveLength(1);
  });

  it('posts market_momentum_backers once at least MIN_BACKERS_FOR_MOMENTUM distinct backers bought within the window', () => {
    const artist = makeArtist('Momentum Backers Artist');
    for (let i = 0; i < 3; i++) {
      const backer = createUser({ name: `Backer ${i}`, email: `momentum-backer-${i}@example.com`, password_hash: 'hash' });
      const buy = executeTrade(backer.id, artist.id, 'buy', 10_000);
      if (!buy.ok) throw new Error(buy.error);
    }

    generateFeedSignals();
    expect(eventsFor(artist.id, 'market_momentum_backers')).toHaveLength(1);
  });

  it('does not post market_momentum_backers below the minimum backer count', () => {
    const artist = makeArtist('Momentum Backers Too Few Artist');
    for (let i = 0; i < 2; i++) {
      const backer = createUser({ name: `Sparse Backer ${i}`, email: `momentum-sparse-backer-${i}@example.com`, password_hash: 'hash' });
      const buy = executeTrade(backer.id, artist.id, 'buy', 10_000);
      if (!buy.ok) throw new Error(buy.error);
    }

    generateFeedSignals();
    expect(eventsFor(artist.id, 'market_momentum_backers')).toHaveLength(0);
  });

  it('posts market_momentum_most_watched once at least MIN_WATCHERS_FOR_MOMENTUM distinct users watched within the window', () => {
    const artist = makeArtist('Momentum Watchers Artist');
    for (let i = 0; i < 5; i++) {
      const watcher = createUser({ name: `Watcher ${i}`, email: `momentum-watcher-${i}@example.com`, password_hash: 'hash' });
      addToWatchlist(watcher.id, artist.id);
    }

    generateFeedSignals();
    expect(eventsFor(artist.id, 'market_momentum_most_watched')).toHaveLength(1);
  });
});

describe('generateFeedSignals — roster scope', () => {
  it('skips passed artists entirely, even if they would otherwise qualify for a signal', () => {
    const admin = createUser({ name: 'Signal Admin', email: 'signal-admin@example.com', password_hash: 'hash' });
    const artist = makeArtist('Signal Passed Artist');
    db.prepare('UPDATE artists SET next_current_price_cents = 100 WHERE id = ?').run(artist.id); // would otherwise be undervalued
    bulkSetArtistStage([artist.id], 'passed', { id: admin.id, name: admin.name });

    const result = generateFeedSignals();
    expect(eventsFor(artist.id, 'signal_undervalued')).toHaveLength(0);
    expect(result.checked).toBeGreaterThanOrEqual(0);
  });
});
