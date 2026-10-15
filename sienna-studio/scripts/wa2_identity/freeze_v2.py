"""Freezes dataset v2 from frozen v1 plus ONLY the candidates the owner has confirmed by eye. v1 is never modified.

  train/               v1's 24 pairs (byte-identical, verified) + confirmed candidates
  review_pending/      candidates neither confirmed nor rejected (kept for comparison, never trained)
  validation_heldout/  v1's 6 photos, byte-identical (verified)
Rejected candidates and the provisional exclusions (O-023, O-012) are recorded in the manifest only; nothing replaces
them, so the dataset never grows with lower-quality pairs to reach a size.
Usage: freeze_v2.py --confirm R1-17,P3 [--reject P41] [--src <v1 dir>] [--out <v2 dir>]
"""
import argparse, hashlib, json, os, shutil, stat, sys, tarfile, time

CANDIDATES = ['R1-17', 'P3', 'P12', 'P41', 'P9', 'P1']
EXCLUDED = ['O-023', 'O-012']
BASE = '/home/user/Send-A-Shot/stageA_review'


def sha(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


def freeze(src, out, confirm, reject=()):
    confirm, reject = list(dict.fromkeys(confirm)), list(dict.fromkeys(reject))
    bad = [i for i in confirm + reject if i not in CANDIDATES]
    if bad: raise ValueError(f'not a pending candidate: {bad}' + (' (provisionally excluded)' if set(bad) & set(EXCLUDED) else ''))
    if set(confirm) & set(reject): raise ValueError(f'both confirmed and rejected: {sorted(set(confirm) & set(reject))}')
    if os.path.exists(out): raise FileExistsError(f'{out} exists; frozen datasets are never overwritten')
    v1 = json.load(open(os.path.join(src, 'manifest.json')))
    sums1 = dict(reversed(l.split(None, 1)) for l in open(os.path.join(src, 'SHA256SUMS')).read().splitlines())
    sums1 = {k.strip().lstrip('./'): v for k, v in sums1.items()}
    for rel, h in sums1.items():                                  # v1 must be intact before anything is built from it
        if sha(os.path.join(src, rel)) != h: raise ValueError(f'v1 file changed: {rel}')
    pend = {e['id']: e for e in v1['review_pending']}
    tmp = out + '.building'; shutil.rmtree(tmp, ignore_errors=True)
    for d in ('train', 'review_pending', 'validation_heldout'): os.makedirs(os.path.join(tmp, d))
    man = {'frozen': time.strftime('%Y-%m-%d'), 'from': 'wa2_dataset_frozen_v1', 'v1_sha256sums': sha(os.path.join(src, 'SHA256SUMS')),
           'decision': {'confirmed': confirm, 'rejected': reject, 'excluded': EXCLUDED,
                        'kept_for_comparison': [c for c in CANDIDATES if c not in confirm and c not in reject]},
           'train': [], 'review_pending': [], 'validation_heldout': []}

    def copy(e, dst_dir):
        n = dict(e)
        for k in ('reference', 'driver', 'target', 'loss_mask'):
            rel = f"{dst_dir}/{os.path.basename(e[k])}"; shutil.copy2(os.path.join(src, e[k]), os.path.join(tmp, rel)); n[k] = rel
        return n
    man['train'] = [copy(e, 'train') for e in v1['train']] + [copy(pend[i], 'train') for i in confirm]
    man['review_pending'] = [copy(pend[i], 'review_pending') for i in man['decision']['kept_for_comparison']]
    for e in v1['validation_heldout']:
        shutil.copy2(os.path.join(src, e['image']), os.path.join(tmp, e['image'])); man['validation_heldout'].append(dict(e))
    ids = lambda g: {e['id'] for e in man[g]}
    val = ids('validation_heldout')
    assert not (ids('train') & val) and not ({e['reference_photo'] for e in man['train']} & val)
    assert not (ids('train') & set(EXCLUDED + reject)) and len(man['train']) == len(v1['train']) + len(confirm)
    json.dump(man, open(os.path.join(tmp, 'manifest.json'), 'w'), indent=1)
    open(os.path.join(tmp, 'README.txt'), 'w').write(
        f"FROZEN WA2 identity dataset v2 ({man['frozen']}). Built from v1 by freeze_v2.py; do not edit.\n"
        f"train: {len(man['train'])} pairs (v1's {len(v1['train'])} + confirmed {', '.join(confirm) or 'none'})\n"
        f"review_pending (never trained): {', '.join(man['decision']['kept_for_comparison']) or 'none'}\n"
        f"rejected: {', '.join(reject) or 'none'}; excluded: {', '.join(EXCLUDED)}\n"
        "validation_heldout: identical to v1; scoring only.\n")
    files = sorted(os.path.relpath(os.path.join(r, f), tmp) for r, _, fs in os.walk(tmp) for f in fs)
    open(os.path.join(tmp, 'SHA256SUMS'), 'w').write(''.join(f'{sha(os.path.join(tmp, f))}  ./{f}\n' for f in files))
    v1_by_name = {os.path.basename(k): h for k, h in sums1.items() if '/' in k}   # every image/mask carried over from v1
    for f in files:
        if '/' not in f: continue                                 # manifest, README, SHA256SUMS are new by design
        if v1_by_name.get(os.path.basename(f)) != sha(os.path.join(tmp, f)): raise ValueError(f'copy differs from v1: {f}')
    os.rename(tmp, out)
    for r, ds, fs in os.walk(out):
        for f in fs: os.chmod(os.path.join(r, f), stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
    return man


def backup_parts(frozen, dest, limit=28 * 2 ** 20):
    """Self-contained .tgz parts under the chat upload limit (each extracts into the same folder)."""
    os.makedirs(dest, exist_ok=True); name = os.path.basename(frozen.rstrip('/'))
    files = sorted(os.path.relpath(os.path.join(r, f), os.path.dirname(frozen.rstrip('/'))) for r, _, fs in os.walk(frozen) for f in fs)
    groups, cur, size = [], [], 0
    for f in files:
        s = os.path.getsize(os.path.join(os.path.dirname(frozen.rstrip('/')), f))
        if cur and size + s > limit: groups.append(cur); cur, size = [], 0
        cur.append(f); size += s
    if cur: groups.append(cur)
    out = []
    for i, g in enumerate(groups, 1):
        p = os.path.join(dest, f'{name}_part{i}of{len(groups)}.tgz')
        with tarfile.open(p, 'w:gz') as t:
            for f in g: t.add(os.path.join(os.path.dirname(frozen.rstrip('/')), f), arcname=f)
        out.append(p)
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--confirm', default=''); ap.add_argument('--reject', default='')
    ap.add_argument('--src', default=f'{BASE}/wa2_dataset_frozen_v1'); ap.add_argument('--out', default=f'{BASE}/wa2_dataset_frozen_v2')
    ap.add_argument('--backup-dir'); a = ap.parse_args()
    sp = lambda s: [x for x in s.split(',') if x]
    m = freeze(a.src, a.out, sp(a.confirm), sp(a.reject))
    print(json.dumps(m['decision']), '| train pairs', len(m['train']))
    if a.backup_dir: print('backup parts:', backup_parts(a.out, a.backup_dir))
