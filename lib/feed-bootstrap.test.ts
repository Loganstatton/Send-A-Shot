import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-bootstrap-test-'));

const { addLogEntry, approveDiscoveryCandidate, createUser, db, getFeedEvents, insertDiscoveryCandidate } = await import('./db');
const { bootstrapFeedFromHistory, BOOTSTRAP_WINDOW_DAYS } = await import('./feed-bootstrap');

async function eventsFor(artistId: number, type: string) {
  return (await getFeedEvents(200)).filter((e) => e.artist_id === artistId && e.event_type === type);
}

describe('bootstrapFeedFromHistory', () => {
  it('creates new_artist and early_discovery events for a real historical approval, as if the live code had created them', async () => {
    const submitter = await createUser({ name: 'Bootstrap Submitter', email: 'bootstrap-submitter@example.com', password_hash: 'hash' });
    const admin = await createUser({ name: 'Bootstrap Admin', email: 'bootstrap-admin@example.com', password_hash: 'hash' });
    await insertDiscoveryCandidate({
      source: 'public_submission', name: 'Bootstrap Approved Artist', followers_count: 5000, flagged_reason: 'test', submitted_by_user_id: submitter.id,
    });
    const candidate = await db.prepare("SELECT id FROM discovery_candidates WHERE name = 'Bootstrap Approved Artist'").get() as { id: number };
    const artist = (await approveDiscoveryCandidate(candidate.id, { id: admin.id, name: admin.name }))!;

    // Simulate this having happened BEFORE the Feed schema existed —
    // delete the events the live code already created (approveDiscoveryCandidate
    // creates them itself), so the bootstrap is what has to (re)create them.
    await db.prepare('DELETE FROM feed_events WHERE artist_id = ?').run(artist.id);
    expect(await eventsFor(artist.id, 'new_artist')).toHaveLength(0);

    const result = await bootstrapFeedFromHistory();
    expect(result.newArtist).toBeGreaterThanOrEqual(1);
    expect(result.earlyDiscovery).toBeGreaterThanOrEqual(1);
    expect(await eventsFor(artist.id, 'new_artist')).toHaveLength(1);
    const early = await eventsFor(artist.id, 'early_discovery');
    expect(early).toHaveLength(1);
    expect(early[0].actor_user_id).toBe(submitter.id);
  });

  it('does not create early_discovery for an approval with no real submitter', async () => {
    const admin = await createUser({ name: 'Bootstrap Admin No Sub', email: 'bootstrap-admin-nosub@example.com', password_hash: 'hash' });
    await insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'bootstrap-uuid-1', name: 'Bootstrap No Submitter Artist', followers_count: 3000, flagged_reason: 'test' });
    const candidate = await db.prepare("SELECT id FROM discovery_candidates WHERE name = 'Bootstrap No Submitter Artist'").get() as { id: number };
    const artist = (await approveDiscoveryCandidate(candidate.id, { id: admin.id, name: admin.name }))!;
    await db.prepare('DELETE FROM feed_events WHERE artist_id = ?').run(artist.id);

    await bootstrapFeedFromHistory();
    expect(await eventsFor(artist.id, 'new_artist')).toHaveLength(1);
    expect(await eventsFor(artist.id, 'early_discovery')).toHaveLength(0);
  });

  it('creates artist_update only for real self-update contact_log entries, never an internal Scout note', async () => {
    const admin = await createUser({ name: 'Bootstrap Update Admin', email: 'bootstrap-update-admin@example.com', password_hash: 'hash' });
    await insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'bootstrap-uuid-2', name: 'Bootstrap Update Artist', followers_count: 2000, flagged_reason: 'test' });
    const candidate = await db.prepare("SELECT id FROM discovery_candidates WHERE name = 'Bootstrap Update Artist'").get() as { id: number };
    const artist = (await approveDiscoveryCandidate(candidate.id, { id: admin.id, name: admin.name }))!;

    const selfUpdate = await addLogEntry(artist.id, { type: 'note', message: 'Artist self-update: new single next week.' }, admin);
    const internalNote = await addLogEntry(artist.id, { type: 'note', message: 'Internal: tried calling, no answer.' }, admin);
    await db.prepare('DELETE FROM feed_events WHERE artist_id = ?').run(artist.id); // simulate pre-Feed history

    await bootstrapFeedFromHistory();
    const updates = await eventsFor(artist.id, 'artist_update');
    expect(updates).toHaveLength(1);
    expect(updates[0].ref_id).toBe(selfUpdate.id);
    expect(updates.some((e) => e.ref_id === internalNote.id)).toBe(false);
  });

  it('is idempotent — running it twice creates zero additional events the second time', async () => {
    const admin = await createUser({ name: 'Bootstrap Idempotent Admin', email: 'bootstrap-idempotent-admin@example.com', password_hash: 'hash' });
    await insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'bootstrap-uuid-3', name: 'Bootstrap Idempotent Artist', followers_count: 1000, flagged_reason: 'test' });
    const candidate = await db.prepare("SELECT id FROM discovery_candidates WHERE name = 'Bootstrap Idempotent Artist'").get() as { id: number };
    const artist = (await approveDiscoveryCandidate(candidate.id, { id: admin.id, name: admin.name }))!;
    await db.prepare('DELETE FROM feed_events WHERE artist_id = ?').run(artist.id);

    const first = await bootstrapFeedFromHistory();
    const second = await bootstrapFeedFromHistory();
    expect(first.newArtist).toBeGreaterThanOrEqual(1);
    expect(second.newArtist).toBe(0);
    expect(second.earlyDiscovery).toBe(0);
    expect(second.artistUpdate).toBe(0);
    expect(await eventsFor(artist.id, 'new_artist')).toHaveLength(1); // still exactly one, not two
  });

  it('ignores an approval outside the bootstrap window', async () => {
    const admin = await createUser({ name: 'Bootstrap Old Admin', email: 'bootstrap-old-admin@example.com', password_hash: 'hash' });
    await insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'bootstrap-uuid-4', name: 'Bootstrap Old Artist', followers_count: 1000, flagged_reason: 'test' });
    const candidate = await db.prepare("SELECT id FROM discovery_candidates WHERE name = 'Bootstrap Old Artist'").get() as { id: number };
    const artist = (await approveDiscoveryCandidate(candidate.id, { id: admin.id, name: admin.name }))!;
    await db.prepare('DELETE FROM feed_events WHERE artist_id = ?').run(artist.id);
    // Backdate the review well outside the window.
    const longAgo = new Date(Date.now() - (BOOTSTRAP_WINDOW_DAYS + 5) * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare('UPDATE discovery_candidates SET reviewed_at = ? WHERE id = ?').run(longAgo, candidate.id);

    await bootstrapFeedFromHistory();
    expect(await eventsFor(artist.id, 'new_artist')).toHaveLength(0);
  });
});
