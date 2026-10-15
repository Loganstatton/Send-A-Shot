"""Builds the 300-step pilot manifest (input to build_metadata.py) from the frozen dataset.

One epoch = exactly ROWS metadata rows; the pilot trains EPOCHS epochs (300 steps at batch 1).
Composition, in fill order (rows past ROWS are dropped from the end, so the priorities below always survive):
  1. every pair, original still                     - the data as approved
  2. every pair, OPPOSITE-TILT still                 - rotated so her head leans the other way (+6..+18 deg)
  3. priority pairs, one more original still         - head turns (|yaw| >= 12), open smiles/laughs, full body
  4. priority pairs, LEVEL still (tilt ~0)           - same, head level
  5. 9-frame pseudo-clips (smooth camera move), priority pairs first, alternating original / opposite tilt,
     at most MAX_CLIPS rows (a clip step costs ~2.2x a still step)
  6. remaining pairs, LEVEL still                    - fills up to ROWS
Rotation keeps her face exactly as it is (no mirroring), only the camera roll changes.
Usage: make_pilot.py <frozen dataset dir> <out manifest.json> [--include ID,ID,...]   (review pairs you approved)
"""
import json, os, sys

ROWS, EPOCHS, MAX_CLIPS = 100, 3, 20
OPP_TILTS = (6, 10, 14, 18)        # target tilts for the opposite-lean copies (her habit is -8..-27)
MAX_ROT = 35                       # never rotate more than this


def is_priority(m):
    if m.get('full_body'): return True
    if m.get('yaw') is not None and abs(m['yaw']) >= 12: return True
    return (m.get('mouth_gap') or 0) >= 0.05 and (m.get('smile') or 0) > 0.5


def rot_for(tilt, want):
    """Degrees to rotate (cv2 convention) to move the measured tilt to `want`, clamped."""
    if tilt is None: return 0.0
    return max(-MAX_ROT, min(MAX_ROT, round(tilt - want, 1)))


def compose(frozen, include=()):
    M = json.load(open(os.path.join(frozen, 'manifest.json')))
    meas = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pilot_measurements.json')))['targets']
    pairs = list(M['train']) + [e for e in M['review_pending'] if e['id'] in include]
    unknown = set(include) - {e['id'] for e in M['review_pending']}
    if unknown: raise ValueError(f'not review pairs: {sorted(unknown)}')
    val = {v['id'] for v in M['validation_heldout']}
    if val & {e['id'] for e in pairs} or val & {e['reference_photo'] for e in pairs}:
        raise ValueError('validation image would be used in training')
    base = lambda e: {k: os.path.join(frozen, e[k]) for k in ('reference', 'driver', 'target', 'loss_mask')}
    pri = [e for e in pairs if is_priority(meas[e['id']])]; rest = [e for e in pairs if e not in pri]
    rows = []                       # (row_count, manifest entry)
    def add(e, tag, rotate=0.0, still=True, clip=False):
        ent = {'id': f"{e['id']}{tag}", **base(e), 'still': still, 'clip': clip}
        if rotate: ent['rotate'] = rotate
        rows.append((int(still) + int(clip), ent))
    opp = {e['id']: rot_for(meas[e['id']]['tilt'], OPP_TILTS[i % len(OPP_TILTS)]) for i, e in enumerate(pairs)}
    lvl = {e['id']: rot_for(meas[e['id']]['tilt'], 0) for e in pairs}
    for e in pairs: add(e, '')
    for e in pairs:
        if opp[e['id']]: add(e, '_opp', opp[e['id']])
    for e in pri: add(e, '_x2')
    for e in pri:
        if lvl[e['id']]: add(e, '_lvl', lvl[e['id']])
    clips = 0
    for i, e in enumerate(pri + rest):
        if clips >= MAX_CLIPS: break
        r = opp[e['id']] if i % 2 else 0.0
        add(e, '_clipopp' if r else '_clip', r, still=False, clip=True); clips += 1
    for e in rest:
        if lvl[e['id']]: add(e, '_lvl', lvl[e['id']])
    out, n = [], 0
    for c, ent in rows:
        if n + c > ROWS: continue
        out.append(ent); n += c
    return out, n, {'pairs': len(pairs), 'priority': [e['id'] for e in pri], 'clip_rows': sum(1 for e in out if e['clip']), 'rows_per_epoch': n,
                    'epochs': EPOCHS, 'steps': n * EPOCHS}


if __name__ == '__main__':
    inc = sys.argv[sys.argv.index('--include') + 1].split(',') if '--include' in sys.argv else []
    ent, n, info = compose(sys.argv[1], inc)
    if n != ROWS: print(f'WARNING: {n} rows per epoch (expected {ROWS}); steps = {n * EPOCHS}')
    json.dump(ent, open(sys.argv[2], 'w'), indent=1)
    print(json.dumps(info))
