"""Convert a DiffSynth-Studio Wan-Animate-2 LoRA into the key layout ComfyUI's WanAnimate2Model loads.

DiffSynth wraps every transformer block (`Incontext_AttentionBlock.block`), so its LoRA keys look like
    blocks.7.block.self_attn.q.lora_A.weight          (or .lora_A.default.weight from PEFT)
ComfyUI's WanAnimate2Block subclasses WanAttentionBlock directly, so the same weight is
    diffusion_model.blocks.7.self_attn.q.lora_A.weight
(the official checkpoint uses the ComfyUI layout too: the official repo inserts `.block` itself when loading).

Usage: python convert_lora.py in.safetensors out.safetensors [--alpha A]
"""
import re, sys
from typing import Dict

KEY_RE = re.compile(r'^(?:pipe\.dit\.|dit\.)?blocks\.(\d+)\.(?:block\.)?(.+?)\.lora_([AB])(?:\.default)?\.weight$')
# Linear layers that exist in a ComfyUI WAN block (WA2 has image cross-attention: k_img / v_img).
COMFY_LINEARS = {f'self_attn.{p}' for p in 'qkvo'} | {f'cross_attn.{p}' for p in ('q', 'k', 'v', 'o', 'k_img', 'v_img')} | {'ffn.0', 'ffn.2'}


def convert_key(key: str) -> str:
    m = KEY_RE.match(key)
    if not m:
        raise ValueError(f'unexpected LoRA key: {key}')
    block, module, ab = m.groups()
    if module not in COMFY_LINEARS:
        raise ValueError(f'LoRA targets a module ComfyUI\'s WA2 block does not have: {module} ({key})')
    return f'diffusion_model.blocks.{block}.{module}.lora_{ab}.weight'


def convert(state: Dict[str, object], alpha: float = None) -> Dict[str, object]:
    out = {}
    for k, v in state.items():
        nk = convert_key(k)
        if nk in out:
            raise ValueError(f'two keys map to {nk}')
        out[nk] = v
    if alpha is not None:  # ComfyUI scales by alpha/rank when an .alpha tensor exists; DiffSynth trains at scale 1
        import numpy as np
        for nk in list(out):
            if nk.endswith('lora_A.weight'):
                out[nk[:-len('lora_A.weight')] + 'alpha'] = np.asarray(alpha, dtype=np.float32)
    return out


def check_pairs(state: Dict[str, object]) -> int:
    """Every lora_A has its lora_B with matching rank; returns the rank."""
    ranks = set()
    for k, a in state.items():
        if k.endswith('lora_A.weight'):
            b = state.get(k.replace('lora_A', 'lora_B'))
            if b is None:
                raise ValueError(f'missing lora_B for {k}')
            if a.shape[0] != b.shape[1]:
                raise ValueError(f'rank mismatch at {k}: {a.shape} vs {b.shape}')
            ranks.add(a.shape[0])
    if len(ranks) != 1:
        raise ValueError(f'expected one rank, got {sorted(ranks)}')
    return ranks.pop()


if __name__ == '__main__':
    from safetensors.numpy import load_file, save_file
    args = sys.argv[1:]
    alpha = float(args[args.index('--alpha') + 1]) if '--alpha' in args else None
    src, dst = [a for a in args if not a.startswith('--') and a != (str(alpha) if alpha is not None else None)][:2]
    state = load_file(src)
    out = convert(state, alpha)
    rank = check_pairs({k: v for k, v in out.items() if not k.endswith('alpha')})
    blocks = sorted({int(k.split('.')[2]) for k in out})
    save_file(out, dst, metadata={'format': 'comfyui-wan-lora', 'source': 'diffsynth-wan-animate-2', 'rank': str(rank)})
    print(f'converted {len(state)} tensors -> {dst} | rank {rank} | blocks {blocks[0]}..{blocks[-1]} ({len(blocks)})')
