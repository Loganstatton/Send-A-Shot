"""(1) bf16 training checkpoint vs int8 Copy Motion checkpoint: names, shapes, unquantized tensors, and layer
outputs through ComfyUI's own int8 ops. (2) Load the converted LoRA onto the int8 model with ComfyUI's loader."""
import sys, json, struct, logging, io, glob, torch, torch.nn.functional as F
COMFY = '/workspace/runpod-slim/ComfyUI'; sys.path.insert(0, COMFY)
bf16 = glob.glob('/workspace/m/Wan-AI/Wan2.2-Animate-2-14B/**/wan_animate_2_bf16.safetensors', recursive=True)[0]
int8 = glob.glob('/workspace/m/Comfy-Org/Wan-Animate-2/**/wan_animate_2_int8_convrot.safetensors', recursive=True)[0]
lora_path = sys.argv[1]
def header(p):
    with open(p, 'rb') as f: n = struct.unpack('<Q', f.read(8))[0]; return json.loads(f.read(n))
hb, hi = header(bf16), header(int8); hb.pop('__metadata__', None); hi.pop('__metadata__', None)
norm = lambda k: k.replace('.block.', '.', 1) if k.startswith('blocks.') else k
kb = {norm(k): v for k, v in hb.items()}
print('CHECK bf16 tensors', len(hb), '| int8 file tensors', len(hi), '| int8 dtypes', sorted({v['dtype'] for v in hi.values()}))
pref = lambda k: k[len('diffusion_model.'):] if k.startswith('diffusion_model.') else k
ki = {pref(k): v for k, v in hi.items()}
w_b = {k for k in kb if k.endswith('.weight')}; w_i = {k for k in ki if k.endswith('.weight')}
print('CHECK weight names only in bf16:', len(w_b - w_i), sorted(w_b - w_i)[:4], '| only in int8:', len(w_i - w_b), sorted(w_i - w_b)[:4])
shape_bad = [k for k in w_b & w_i if kb[k]['shape'] != ki[k]['shape'] and ki[k]['dtype'] not in ('I8', 'U8')]
print('CHECK shape mismatches (non-int8 tensors):', len(shape_bad), shape_bad[:3])
from safetensors import safe_open
fb, fi = safe_open(bf16, 'pt'), safe_open(int8, 'pt')
inv = {norm(k): k for k in hb}; invi = {pref(k): k for k in hi}
same = [k for k in w_b & w_i if ki[k]['dtype'] in ('BF16', 'F16', 'F32')] + [k for k in kb if k.endswith('.bias') and k in ki][:200]
worst = 0.0
for k in same[:400]:
    a = fb.get_tensor(inv[k]).float(); b = fi.get_tensor(invi[k]).float()
    if a.shape == b.shape: worst = max(worst, (a - b).abs().max().item() / (a.abs().max().item() + 1e-8))
print(f'CHECK {min(400, len(same))} unquantized tensors compared, worst relative diff {worst:.2e}')
logs = io.StringIO(); h = logging.StreamHandler(logs); logging.getLogger().addHandler(h); logging.getLogger().setLevel(logging.INFO)
import comfy.sd, comfy.utils
model = comfy.sd.load_diffusion_model(int8)
dm = model.model.diffusion_model
print('CHECK ComfyUI loaded', type(dm).__name__, 'blocks', len(dm.blocks))
for name in ('blocks.0.self_attn.q', 'blocks.20.ffn.0', 'blocks.39.cross_attn.o'):
    mod = dm.get_submodule(name).to('cuda')
    W = fb.get_tensor(inv[name + '.weight']).cuda(); B = fb.get_tensor(inv[name + '.bias']).cuda()
    x = torch.randn(1, 64, W.shape[1], device='cuda', dtype=torch.bfloat16)
    y_q = mod(x).float(); y_b = F.linear(x, W.to(torch.bfloat16), B.to(torch.bfloat16)).float()
    cos = F.cosine_similarity(y_q.flatten(), y_b.flatten(), dim=0).item(); rel = ((y_q - y_b).norm() / y_b.norm()).item()
    print(f'CHECK layer {name}: int8 vs bf16 output cosine {cos:.5f}, relative error {rel:.4f}')
    mod.to('cpu')
lora = comfy.utils.load_torch_file(lora_path)
m2, _ = comfy.sd.load_lora_for_models(model, None, lora, 1.0, 0)
txt = logs.getvalue(); miss = txt.count('lora key not loaded')
pk = [k for k in m2.patches]
print(f'CHECK LoRA tensors {len(lora)} | ComfyUI patched weights {len(pk)} | "lora key not loaded" lines {miss}')
print('CHECK patched e.g.', sorted(pk)[:2])
