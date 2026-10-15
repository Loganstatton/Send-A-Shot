"""Session side of checkpoint transfer: pulls every new file from the pod's /workspace/wa2_pull (via its JupyterLab
proxy), verifies each against the pod's SHA256SUMS, and writes a local SHA256SUMS that only lists verified files.
Also answers the pod's 100 MB transfer gate (gate.bin -> gate.ok) before any training spend.

Recovery: an interrupted download resumes from its .part file (HTTP Range); a file that fails its checksum is
deleted and fetched again on the next pass; files already verified are never re-downloaded. JupyterLab may serve
files relative to /workspace or to /, so both URL prefixes are tried at the gate and the working one is kept.
Usage: POD=<id> pull_ckpts.py <local dir> [--once]
"""
import hashlib, os, subprocess, sys, time, urllib.error, urllib.request

SP = os.environ.get('SCRATCH', '/tmp/claude-0/-home-user-Send-A-Shot/5ab8d7bf-5d0f-550f-a69c-62a6985b93f2/scratchpad')
PREFIXES = ('wa2_pull', 'workspace/wa2_pull')


class Puller:
    def __init__(self, base=None, token=None, signal_gate=None, backoff=2.0):
        pod = os.environ.get('POD', '')
        self.base = base or f'https://{pod}-8888.proxy.runpod.net'
        tok = token if token is not None else open(os.path.join(SP, '.jp')).read().strip()
        self.hdr = {'Authorization': f'token {tok}', 'User-Agent': 'curl/8.5.0'}
        self.prefix = None; self.backoff = backoff
        self.signal_gate = signal_gate or (lambda: podsh('touch /workspace/wa2_pull/gate.ok'))

    def _open(self, rel, start=0):
        h = dict(self.hdr)
        if start: h['Range'] = f'bytes={start}-'
        return urllib.request.urlopen(urllib.request.Request(f'{self.base}/files/{self.prefix}/{rel}', headers=h), timeout=600)

    def find_prefix(self, probe='gate.sha256'):
        for pre in PREFIXES:
            self.prefix = pre
            try:
                self._open(probe).read(); return pre
            except Exception:
                continue
        self.prefix = None; return None

    def get(self, rel, dest=None, tries=4):
        for t in range(tries):
            try:
                if dest is None:
                    return self._open(rel).read()
                part = dest + '.part'; have = os.path.getsize(part) if os.path.exists(part) else 0
                r = self._open(rel, have)
                if have and r.status != 206: have = 0          # server ignored Range: start over
                expect = int(r.headers['Content-Length']) if r.headers.get('Content-Length') else None
                got = 0
                with open(part, 'ab' if have else 'wb') as f:
                    while True:
                        try:
                            b = r.read(1 << 22)
                        except Exception:                      # connection dropped: keep what arrived, resume next try
                            break
                        if not b: break
                        f.write(b); got += len(b)
                if expect is not None and got < expect:
                    raise IOError(f'short read {got}/{expect} bytes (kept .part to resume)')
                os.replace(part, dest); return True
            except urllib.error.HTTPError as e:
                if e.code == 416 and dest and os.path.exists(dest + '.part'):   # .part already complete
                    os.replace(dest + '.part', dest); return True
                print('retry', rel, e); time.sleep(self.backoff ** (t + 1) if self.backoff else 0)
            except Exception as e:
                print('retry', rel, e); time.sleep(self.backoff ** (t + 1) if self.backoff else 0)
        return None

    def gate(self, local):
        if not self.find_prefix(): return False
        want = self.get('gate.sha256')
        os.makedirs(local, exist_ok=True); p = os.path.join(local, 'gate.bin')
        ok = bool(want) and bool(self.get('gate.bin', p)) and sha(p) == want.decode().split()[0]
        for q in (p, p + '.part'):
            if os.path.exists(q): os.remove(q)
        if ok: self.signal_gate(); print(f'TRANSFER GATE OK via /files/{self.prefix}')
        return ok

    def pull(self, local):
        if self.prefix is None and not self.find_prefix('ckpt/SHA256SUMS'): return 0
        sums = self.get('ckpt/SHA256SUMS')
        if not sums: return 0
        os.makedirs(local, exist_ok=True); new = 0; ok = []
        for line in sums.decode().splitlines():
            if not line.strip(): continue
            h, f = line.split(None, 1); f = f.strip().lstrip('*'); p = os.path.join(local, f)
            if not (os.path.exists(p) and sha(p) == h):
                if self.get(f'ckpt/{f}', p) and sha(p) == h:
                    new += 1; print('VERIFIED', f, os.path.getsize(p) // 2 ** 20, 'MB')
                else:
                    print('FAILED', f)
                    for q in (p, p + '.part'):
                        if os.path.exists(q): os.remove(q)
                    continue
            ok.append(f'{h}  {f}')
        open(os.path.join(local, 'SHA256SUMS'), 'w').write('\n'.join(ok) + ('\n' if ok else ''))
        return new


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 22), b''): h.update(b)
    return h.hexdigest()


def podsh(cmd):
    return subprocess.run([sys.executable, os.path.join(SP, 'poc', 'podsh.py'), cmd, '60'], capture_output=True, text=True,
                          env={**os.environ}).stdout


if __name__ == '__main__':
    local = sys.argv[1]; pl = Puller(); gated = False
    while True:
        if not gated: gated = pl.gate(local)
        if gated: pl.pull(local)
        if '--once' in sys.argv: break
        time.sleep(60)
