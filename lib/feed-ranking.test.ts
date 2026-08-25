import { describe, expect, it } from 'vitest';
import { itemMatchesTab, rankFeedItems, scoreForTab } from './feed-ranking';
import { FeedItemDTO } from './feed-items';

// DIVERSITY_WINDOW in lib/feed-ranking.ts — not exported (it's an internal
// tuning constant), mirrored here the same way other tests in this repo
// hardcode a threshold value alongside a comment pointing at its source.
const DIVERSITY_WINDOW = 3;

let nextId = 1;
function makeItem(overrides: Partial<FeedItemDTO> = {}): FeedItemDTO {
  const id = nextId++;
  return {
    id,
    eventType: 'new_artist',
    createdAt: new Date().toISOString(),
    artist: { id: 100 + id, name: `Artist ${id}`, score: 70, priceCents: 1000, changePct: 0 },
    metadata: {},
    factors: { isFollowed: false, genreMatch: false, baseStrength: 0.5, unusualness: 0, momentum: 0 },
    ...overrides,
  };
}

describe('itemMatchesTab', () => {
  it('for_you matches every item regardless of factors', () => {
    expect(itemMatchesTab(makeItem({ factors: { isFollowed: false, genreMatch: false, baseStrength: 0.5, unusualness: 0, momentum: 0 } }), 'for_you')).toBe(true);
    expect(itemMatchesTab(makeItem({ eventType: 'signal_undervalued' }), 'for_you')).toBe(true);
  });

  it('following only matches items whose artist the viewer follows', () => {
    const followed = makeItem({ factors: { isFollowed: true, genreMatch: false, baseStrength: 0.5, unusualness: 0, momentum: 0 } });
    const notFollowed = makeItem({ factors: { isFollowed: false, genreMatch: false, baseStrength: 0.5, unusualness: 0, momentum: 0 } });
    expect(itemMatchesTab(followed, 'following')).toBe(true);
    expect(itemMatchesTab(notFollowed, 'following')).toBe(false);
  });

  it('market only matches signal/momentum event types, not social/discovery ones', () => {
    expect(itemMatchesTab(makeItem({ eventType: 'signal_undervalued' }), 'market')).toBe(true);
    expect(itemMatchesTab(makeItem({ eventType: 'market_momentum_backers' }), 'market')).toBe(true);
    expect(itemMatchesTab(makeItem({ eventType: 'new_artist' }), 'market')).toBe(false);
    expect(itemMatchesTab(makeItem({ eventType: 'artist_update' }), 'market')).toBe(false);
    expect(itemMatchesTab(makeItem({ eventType: 'founding_believer_share' }), 'market')).toBe(false);
  });
});

describe('scoreForTab', () => {
  it('a fresher item scores higher than an older one, all else equal', () => {
    const now = Date.now();
    const fresh = makeItem({ createdAt: new Date(now).toISOString() });
    const old = makeItem({ createdAt: new Date(now - 72 * 60 * 60 * 1000).toISOString() });
    expect(scoreForTab(fresh, 'for_you', now)).toBeGreaterThan(scoreForTab(old, 'for_you', now));
  });

  it('for_you rewards a followed artist over an identical unfollowed one', () => {
    const now = Date.now();
    const followed = makeItem({ createdAt: new Date(now).toISOString(), factors: { isFollowed: true, genreMatch: false, baseStrength: 0.5, unusualness: 0, momentum: 0 } });
    const notFollowed = makeItem({ createdAt: new Date(now).toISOString(), factors: { isFollowed: false, genreMatch: false, baseStrength: 0.5, unusualness: 0, momentum: 0 } });
    expect(scoreForTab(followed, 'for_you', now)).toBeGreaterThan(scoreForTab(notFollowed, 'for_you', now));
  });

  it("market ignores relevance — a followed and unfollowed item score identically", () => {
    const now = Date.now();
    const followed = makeItem({ eventType: 'signal_undervalued', createdAt: new Date(now).toISOString(), factors: { isFollowed: true, genreMatch: true, baseStrength: 0.5, unusualness: 0.4, momentum: 0.3 } });
    const notFollowed = makeItem({ eventType: 'signal_undervalued', createdAt: new Date(now).toISOString(), factors: { isFollowed: false, genreMatch: false, baseStrength: 0.5, unusualness: 0.4, momentum: 0.3 } });
    expect(scoreForTab(followed, 'market', now)).toBe(scoreForTab(notFollowed, 'market', now));
  });
});

describe('rankFeedItems', () => {
  it('for_you returns every item, just reordered', () => {
    const items = [makeItem(), makeItem({ eventType: 'signal_undervalued' }), makeItem({ eventType: 'artist_update' })];
    const ranked = rankFeedItems(items, 'for_you');
    expect(ranked).toHaveLength(3);
    expect(new Set(ranked.map((i) => i.id))).toEqual(new Set(items.map((i) => i.id)));
  });

  it('following drops items for artists the viewer does not follow', () => {
    const followed = makeItem({ factors: { isFollowed: true, genreMatch: false, baseStrength: 0.5, unusualness: 0, momentum: 0 } });
    const notFollowed = makeItem({ factors: { isFollowed: false, genreMatch: false, baseStrength: 0.5, unusualness: 0, momentum: 0 } });
    const ranked = rankFeedItems([followed, notFollowed], 'following');
    expect(ranked.map((i) => i.id)).toEqual([followed.id]);
  });

  it('market drops non-market event types', () => {
    const signal = makeItem({ eventType: 'market_momentum_mover' });
    const social = makeItem({ eventType: 'early_discovery' });
    const ranked = rankFeedItems([signal, social], 'market');
    expect(ranked.map((i) => i.id)).toEqual([signal.id]);
  });

  it('never stacks more than the diversity window of consecutive items from the same artist when other artists are available', () => {
    // 5 items from one dominant artist plus 5 items each from a DIFFERENT
    // other artist — enough real alternatives that the diversity pass can
    // actually interleave (a single other-artist item wouldn't be enough
    // to break up 5 same-artist items into runs of 3 or fewer).
    const sameArtist = Array.from({ length: 5 }, (_, i) =>
      makeItem({ artist: { id: 1, name: 'Dominant Artist', score: 100 - i, priceCents: 1000, changePct: 0 } })
    );
    const others = Array.from({ length: 5 }, (_, i) =>
      makeItem({ artist: { id: 2 + i, name: `Other Artist ${i}`, score: 50, priceCents: 1000, changePct: 0 } })
    );
    const ranked = rankFeedItems([...sameArtist, ...others], 'for_you');

    let run = 1;
    for (let i = 1; i < ranked.length; i++) {
      run = ranked[i].artist?.id === ranked[i - 1].artist?.id ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(DIVERSITY_WINDOW);
    }
    // Every item still makes it into the result — diversify reorders, never drops.
    expect(ranked).toHaveLength(10);
  });
});
