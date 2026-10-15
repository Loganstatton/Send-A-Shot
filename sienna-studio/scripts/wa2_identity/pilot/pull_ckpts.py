"""Session side of checkpoint transfer: pulls every new file from the pod's /workspace/wa2_pull (via its JupyterLab
proxy), verifies each against the pod's SHA256SUMS, and writes a local SHA256SUMS that only lists verified files.
Also answers the pod's 100 MB transfer gate (gate.bin -> gate.ok) before any training spend.
Usage: POD=<id> pull_ckpts.py <local dir> [--once]
"""
import hashlib, json, os, ssl, subprocess, sys, time, urllib.request

SP = os.environ.get('SCRATCH', '/tmp/claude-0/-home-user-Send-A-Shot/5ab8d7bf-5d0f-550f-a69c-62a6985b93f2/scratchpad')
POD = os.environ['POD']; HOST = f'https://{POD}-8888.proxy.runpod.net'; TOK = open(os.path.join(SP, '.jp')).read().strip()
HDR = {'Authorization': f'token {TOK}', 'User-Agent': 'curl/8.5.0'}


def get(rel, dest=None, tries=4):
    for t in range(tries):
        try:
            r = urllib.request.urlopen(urllib.request.Request(f'{HOST}/files/wa2_pull/{rel}', headers=HDR), timeout=600)
            if dest is None: return r.read()
            with open(dest + '.part', 'wb') as f:
                while True:
                    b = r.read(1 << 22)
                    if not b: break
                    f.write(b)
            os.replace(dest + '.part', dest); return True
        except Exception as e:
            print('retry', rel, e); time.sleep(2 ** (t + 1))
    return None


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 22), b''): h.update(b)
    return h.hexdigest()


def podsh(cmd):
    return subprocess.run([sys.executable, os.path.join(SP, 'poc', 'podsh.py'), cmd, '60'], capture_output=True, text=True, env={**os.environ, 'POD': POD}).stdout


def gate(local):
    want = get('gate.sha256')
    if not want: return False
    os.makedirs(local, exist_ok=True); p = os.path.join(local, 'gate.bin')
    ok = get('gate.bin', p) and sha(p) == want.decode().split()[0]
    os.remove(p) if os.path.exists(p) else None
    if ok: podsh('touch /workspace/wa2_pull/gate.ok'); print('TRANSFER GATE OK (100 MB pulled and verified)')
    return ok


def pull(local):
    sums = get('ckpt/SHA256SUMS')
    if not sums: return 0
    os.makedirs(local, exist_ok=True); new = 0
    for line in sums.decode().splitlines():
        h, f = line.split(None, 1); f = f.strip().lstrip('*'); p = os.path.join(local, f)
        if os.path.exists(p) and sha(p) == h: continue
        if get(f'ckpt/{f}', p) and sha(p) == h:
            new += 1; print('VERIFIED', f, os.path.getsize(p) // 2 ** 20, 'MB')
        else:
            print('FAILED', f); os.remove(p) if os.path.exists(p) else None
    ok = [l for l in sums.decode().splitlines() if os.path.exists(os.path.join(local, l.split(None, 1)[1].strip().lstrip('*')))
          and sha(os.path.join(local, l.split(None, 1)[1].strip().lstrip('*'))) == l.split()[0]]
    open(os.path.join(local, 'SHA256SUMS'), 'w').write('\n'.join(ok) + '\n')
    return new


if __name__ == '__main__':
    local = sys.argv[1]; gated = False
    while True:
        if not gated: gated = gate(local)
        pull(local)
        if '--once' in sys.argv: break
        time.sleep(60)
