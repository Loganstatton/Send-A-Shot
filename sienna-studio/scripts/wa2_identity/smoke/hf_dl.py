"""Parallel downloads for the smoke test; resolves real file names from the repo listings first."""
import os, sys, time, fnmatch, threading
from huggingface_hub import HfApi, hf_hub_download
M = '/workspace/m'; os.makedirs(M, exist_ok=True); api = HfApi()
WANTS = [('Wan-AI/Wan2.2-Animate-2-14B', '*wan_animate_2_bf16.safetensors', 'dit'),
         ('Wan-AI/Wan2.2-Animate-2-14B', '*models_t5_umt5-xxl-enc-bf16.pth', 't5'),
         ('Wan-AI/Wan2.2-Animate-2-14B', '*models_clip_open-clip-xlm-roberta-large-vit-huge-14.pth', 'clip'),
         ('Wan-AI/Wan2.2-Animate-2-14B', '*umt5-xxl/*', 'tok'),
         ('Wan-AI/Wan2.1-T2V-14B', 'Wan2.1_VAE.pth', 'vae'),
         ('Comfy-Org/Wan-Animate-2', '*wan_animate_2_int8_convrot.safetensors', 'int8')]
listing = {r: api.list_repo_files(r) for r in {w[0] for w in WANTS}}
jobs = []
for repo, pat, tag in WANTS:
    files = [f for f in listing[repo] if fnmatch.fnmatch(f, pat) and 'distill' not in f]
    print('PLAN', tag, repo, files[:4], len(files), flush=True)
    if not files: print('MISSING', tag, flush=True)
    jobs += [(repo, f, tag) for f in files]
def get(repo, f, tag):
    t = time.time(); p = hf_hub_download(repo, f, local_dir=f'{M}/{repo}')
    print(f'DONE {tag} {f} {os.path.getsize(p)/2**30:.2f}GB {time.time()-t:.0f}s', flush=True)
ts = [threading.Thread(target=get, args=j) for j in jobs]
[t.start() for t in ts]; [t.join() for t in ts]; print('ALL_DOWNLOADS_DONE', flush=True)
