import { beforeEach, describe, expect, it } from 'vitest';

const { saveProInterest, getMyProInterest, getProInterestSummary } = await import('./pro-interest');
const { createUser, deleteUser } = await import('./db');
const { db } = await import('./pg');

let n = 0;
const user = async () => (await createUser({ name: `Pro ${n}`, email: `pro${Date.now()}${n++}@example.com`, password_hash: 'x' })).id;

beforeEach(async () => {
  await db.prepare('DELETE FROM pro_interest').run();
});

describe('NEXT Pro survey', () => {
  it('saves one answer per player, editable, ignoring unknown features', async () => {
    const id = await user();
    expect((await saveProInterest(id, { features: ['alerts', 'hack', 'alerts'], topFeature: 'alerts', intent: 'probably', bargain: '4.99', comment: '  more stats  ' })).ok).toBe(true);
    let mine = await getMyProInterest(id);
    expect(mine!.features).toEqual(['alerts']);
    expect([mine!.intent, Number(mine!.bargain_cents), mine!.comment]).toEqual(['probably', 499, 'more stats']);
    await saveProInterest(id, { features: ['analytics'], intent: 'definitely_not' });
    mine = await getMyProInterest(id);
    expect([mine!.features, mine!.intent, mine!.bargain_cents]).toEqual([['analytics'], 'definitely_not', null]);
    expect((await getProInterestSummary()).responses).toBe(1);
  });

  it('requires an answer to the $7.99 question and sane prices', async () => {
    const id = await user();
    expect(await saveProInterest(id, { features: ['alerts'] })).toMatchObject({ ok: false });
    expect(await saveProInterest(id, { intent: 'unsure', tooExpensive: '5000' })).toMatchObject({ ok: false });
    expect(await saveProInterest(id, { intent: 'unsure', bargain: 'abc' })).toMatchObject({ ok: false });
  });

  it('summarises intent, features and fair-price medians', async () => {
    const answers = [
      { intent: 'definitely', features: ['alerts', 'analytics'], topFeature: 'alerts', bargain: '3', expensive: '8' },
      { intent: 'probably', features: ['alerts'], topFeature: 'alerts', bargain: '5', expensive: '10' },
      { intent: 'probably_not', features: ['leagues'], bargain: '2', expensive: '6' },
      { intent: 'unsure', features: [] },
    ];
    for (const a of answers) await saveProInterest(await user(), a);
    const s = await getProInterestSummary();
    expect(s.responses).toBe(4);
    expect(s.wouldPayPct).toBe(50);
    expect([s.featureCounts.alerts, s.topCounts.alerts, s.featureCounts.leagues]).toEqual([2, 2, 1]);
    expect([s.medians.bargain, s.medians.expensive, s.medians.tooExpensive]).toEqual([300, 800, null]);
  });

  it('is deleted with the account', async () => {
    const id = await user();
    await saveProInterest(id, { intent: 'unsure' });
    await deleteUser(id);
    expect(await getMyProInterest(id)).toBeNull();
  });
});
