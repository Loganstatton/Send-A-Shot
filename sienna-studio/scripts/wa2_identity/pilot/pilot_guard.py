"""Absolute spending cap and resource safety for the WA2 identity pilot (runs locally; RunPod REST).

One ledger covers EVERY pilot GPU, so the cap is total, not per pod:
  spent      = sum over pilot pods of rate x run time (+ pilot volume storage)
  committed  = what still-running pods may cost until their on-pod deadlines
  A new pod is only created if spent + committed + its own minimum useful run fits under the cap, and its on-pod
  deadline (HARD_MIN, passed to pilot_pod.sh) is set from the budget that is left. So even if this session dies,
  no pod can run past the cap: each pod deletes itself at its deadline.
  `watch` additionally terminates every pilot pod as soon as spent >= cap - MARGIN.

Safety: only resources named sienna_wa2_pilot* / sienna-wa2-pilot* are ever created, stopped or deleted.
The production volume (sienna-studio, u4odco714x) and every other pod or volume are refused, whatever the arguments.

Usage: pilot_guard.py init <cap_usd> | spent | create-pod <gpu> [<volume_id>] | watch | terminate-all |
       create-volume <datacenter> --approved | delete-volume --verified <local SHA256SUMS dir> | status
"""
import json, os, sys, time, hashlib, urllib.request

SP = os.environ.get('SCRATCH', '/tmp/claude-0/-home-user-Send-A-Shot/5ab8d7bf-5d0f-550f-a69c-62a6985b93f2/scratchpad')
LEDGER = os.path.join(SP, 'wa2_pilot_ledger.json')
API = 'https://rest.runpod.io/v1'
POD_PREFIX, VOL_NAME = 'sienna_wa2_pilot', 'sienna-wa2-pilot'
PROTECTED_VOLUMES = {'u4odco714x'}; PROTECTED_NAMES = {'sienna-studio'}
MARGIN = 0.05              # USD kept in reserve for billing granularity
MIN_RUN_H = 0.5            # never start a pod that could not run at least this long
VOL_GB, VOL_RATE = 20, 0.07 / 730   # USD per GB-hour (0.07 per GB-month, billed hourly)
DRY = bool(os.environ.get('PILOT_DRY_RUN'))


def call(path, body=None, method=None):
    if DRY:
        print('DRY', method or ('POST' if body is not None else 'GET'), path, json.dumps(body)[:200] if body else ''); return {}
    key = open(os.path.join(SP, '.rp')).read().strip()
    r = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method or ('POST' if body is not None else 'GET'),
                               headers={'Authorization': 'Bearer ' + key, 'User-Agent': 'curl/8.5.0', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(r, timeout=90) as f:
        return json.loads(f.read() or b'{}')


def load():
    return json.load(open(LEDGER)) if os.path.exists(LEDGER) else None


def save(L):
    json.dump(L, open(LEDGER + '.tmp', 'w'), indent=1); os.replace(LEDGER + '.tmp', LEDGER)


def pod_cost(p, now):
    return (min(p.get('ended') or now, now) - p['started']) / 3600 * p['rate']


def spent(L, now=None):
    now = now or time.time()
    s = sum(pod_cost(p, now) for p in L['pods'])
    v = L.get('volume')
    if v: s += ((v.get('deleted') or now) - v['created']) / 3600 * VOL_GB * VOL_RATE
    return s


def committed(L, now=None):
    """Further cost the live pods may still incur before their on-pod deadlines."""
    now = now or time.time()
    return sum(max(0.0, p['deadline'] - now) / 3600 * p['rate'] for p in L['pods'] if not p.get('ended'))


def budget_minutes(L, rate, now=None):
    """Minutes a new pod at `rate` may run so that spent + committed + this pod stays under cap - MARGIN."""
    left = L['cap'] - MARGIN - spent(L, now) - committed(L, now)
    return max(0.0, left / rate * 60)


def check_volume_allowed(vid, name):
    if vid in PROTECTED_VOLUMES or name in PROTECTED_NAMES or not str(name).startswith(VOL_NAME):
        raise SystemExit(f'REFUSED: volume {name} ({vid}) is not a pilot volume')


def check_pod_allowed(name):
    if not str(name).startswith(POD_PREFIX):
        raise SystemExit(f'REFUSED: pod {name} is not a pilot pod')


def sha_dir(d):
    """Verify every line of <d>/SHA256SUMS against the files in d. Returns the number of verified files."""
    n = 0
    for line in open(os.path.join(d, 'SHA256SUMS')):
        h, f = line.split(None, 1); f = f.strip().lstrip('*')
        if hashlib.sha256(open(os.path.join(d, f), 'rb').read()).hexdigest() != h:
            raise SystemExit(f'CHECKSUM MISMATCH {f}')
        n += 1
    return n


def main(a):
    cmd = a[0]; L = load()
    if cmd == 'init':
        if L and any(not p.get('ended') for p in L['pods']): raise SystemExit('live pods in ledger; refusing to reset')
        save({'cap': float(a[1]), 'pods': [], 'volume': None, 'created': time.time()}); print('cap', a[1]); return
    if L is None: raise SystemExit('run init <cap> first')
    if cmd == 'spent':
        print(f"spent {spent(L):.3f} | committed {committed(L):.3f} | cap {L['cap']:.2f}")
    elif cmd == 'create-pod':
        gpu, vol = a[1], (a[2] if len(a) > 2 else None)
        if vol: check_volume_allowed(vol, (L.get('volume') or {}).get('name', ''))
        tpl = call('/pods/pjj0dd04izwq7g')            # same template/env as earlier Sienna pods (read only)
        body = {'name': f'{POD_PREFIX}_{len(L["pods"]) + 1}', 'templateId': tpl.get('templateId'), 'gpuTypeIds': [gpu], 'gpuCount': 1,
                'ports': tpl.get('ports'), 'env': {**(tpl.get('env') or {}), 'SIENNA_IDLE_MINUTES': '30'}, 'cloudType': 'SECURE',
                'containerDiskInGb': 150, 'minRAMPerGPU': 48, 'volumeInGb': 0, 'imageName': 'runpod/comfyui:1.4.0-comfyuiv0.35.0-cuda12.8'}
        if vol: body.update({'networkVolumeId': vol, 'volumeMountPath': '/pilotvol'})   # never /workspace: ComfyUI installs there
        est_rate = float(os.environ.get('EXPECTED_RATE', '0.59'))
        if budget_minutes(L, est_rate) < MIN_RUN_H * 60: raise SystemExit(f'REFUSED: budget left for only {budget_minutes(L, est_rate):.0f} min')
        d = call('/pods', body); rate = float(d.get('costPerHr') or est_rate); now = time.time()
        L['pods'].append({'id': d.get('id', 'dry'), 'name': body['name'], 'gpu': gpu, 'rate': rate, 'started': now, 'deadline': now, 'volume': vol})
        mins = budget_minutes(L, rate, now); L['pods'][-1]['deadline'] = now + mins * 60; save(L)
        print(f"CREATED {d.get('id')} {gpu} ${rate}/h  HARD_MIN={int(mins)}  (pass to pilot_pod.sh)")
    elif cmd in ('watch', 'terminate-all'):
        while True:
            L = load(); s = spent(L)
            if cmd == 'terminate-all' or s >= L['cap'] - MARGIN:
                for p in L['pods']:
                    if not p.get('ended'):
                        check_pod_allowed(p['name']); call(f"/pods/{p['id']}", method='DELETE'); p['ended'] = time.time(); print('TERMINATED', p['id'], f'spent {s:.3f}')
                save(L)
                if cmd == 'terminate-all' or not any(not p.get('ended') for p in L['pods']): return
            for p in L['pods']:                     # pods that already deleted themselves at their deadline
                if not p.get('ended') and time.time() > p['deadline'] + 120: p['ended'] = p['deadline']
            save(L); time.sleep(20)
    elif cmd == 'create-volume':
        if '--approved' not in a: raise SystemExit('REFUSED: the owner has not approved a pilot volume')
        if L.get('volume') and not L['volume'].get('deleted'): raise SystemExit('a pilot volume already exists')
        d = call('/networkvolumes', {'name': VOL_NAME, 'size': VOL_GB, 'dataCenterId': a[1]})
        L['volume'] = {'id': d.get('id', 'dry'), 'name': VOL_NAME, 'dc': a[1], 'created': time.time()}; save(L); print('VOLUME', L['volume'])
    elif cmd == 'delete-volume':
        v = L.get('volume')
        if not v or v.get('deleted'): print('no live pilot volume'); return
        check_volume_allowed(v['id'], v['name'])
        if '--verified' not in a: raise SystemExit('REFUSED: verify the local checkpoint copies first (--verified <dir>)')
        n = sha_dir(a[a.index('--verified') + 1]); print(f'{n} local files verified')
        if any(not p.get('ended') and p.get('volume') == v['id'] for p in L['pods']): raise SystemExit('a pod still uses the volume')
        call(f"/networkvolumes/{v['id']}", method='DELETE')
        left = [x for x in (call('/networkvolumes') or []) if isinstance(x, dict) and x.get('id') == v['id']] if not DRY else []
        if left: raise SystemExit('DELETE did not take effect; volume still listed')
        v['deleted'] = time.time(); save(L); print('VOLUME DELETED and confirmed absent from the account listing')
    elif cmd == 'status':
        print(json.dumps(L, indent=1)); print(f"spent {spent(L):.3f} committed {committed(L):.3f}")


if __name__ == '__main__':
    main(sys.argv[1:])
