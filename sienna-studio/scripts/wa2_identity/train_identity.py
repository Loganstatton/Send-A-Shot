"""DiffSynth's examples/wanvideo/model_training/train.py with the identity loss swapped in for `sft` tasks.
Run from the DiffSynth-Studio checkout with the same arguments as train.py.
SMOKE=1 adds checks for the smoke test: loss shapes with/without the reference slot, which LoRA tensors get
gradients, whether the optimizer step changes them, peak VRAM / RAM and step time (lines start with 'SMOKE ')."""
import os, runpy, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import face_loss
from face_loss import FlowMatchIdentityLoss

if os.environ.get('SMOKE'):
    import torch
    state = {'calls': 0, 'hooks': False, 'grads': {}, 'before': {}, 't': None}

    def log(*a):
        print('SMOKE', *a, flush=True)

    def lora_params(pipe):
        return [(n, p) for n, p in pipe.dit.named_parameters() if 'lora_' in n]

    def smoke_loss(pipe, **inputs):
        state['calls'] += 1; c = state['calls']
        lp = lora_params(pipe)
        if c == 1:
            trainable = [n for n, p in pipe.dit.named_parameters() if p.requires_grad]
            log('trainable params', len(trainable), '| all LoRA:', all('lora_' in n for n in trainable), '| e.g.', trainable[:2])
            log('lora tensors', len(lp), '| modules', sorted({n.split('.lora_')[0].split('.block.')[-1] for n, _ in lp}))
            for n, p in lp:
                state['before'][n] = p.detach().float().norm().item()
                p.register_hook(lambda g, n=n: state['grads'].__setitem__(n, g.detach().float().norm().item()))
            torch.cuda.reset_peak_memory_stats()
        else:
            got = {n: g for n, g in state['grads'].items() if g > 0}
            blocks = sorted({int(n.split('blocks.')[1].split('.')[0]) for n in got})
            log(f'after step {c - 1}: LoRA tensors with nonzero grad {len(got)}/{len(lp)} | blocks {blocks[:1]}..{blocks[-1:]} ({len(blocks)})')
            changed = sum(1 for n, p in lp if abs(p.detach().float().norm().item() - state['before'].get(n, 0)) > 0)
            log(f'LoRA tensors changed by the optimizer step: {changed}/{len(lp)}')
            log(f'step time {time.time() - state["t"]:.1f}s | peak VRAM {torch.cuda.max_memory_allocated() / 2**30:.1f} GB')
            try:
                import psutil; log(f'process RAM {psutil.Process().memory_info().rss / 2**30:.1f} GB')
            except Exception:
                pass
            state['grads'].clear()
        # loss with and without the reference slot, on the same noise (shows the exclusion)
        lat = inputs['input_latents']; log(f'call {c}: input_latents {tuple(lat.shape)} (frame 0 = reference slot) | face_box {inputs.get("face_box")!r}')
        b = face_loss.face_bounds(inputs.get('face_box'), lat.shape[-2], lat.shape[-1])
        log(f'face weight cells {b} of grid {lat.shape[-2]}x{lat.shape[-1]}')
        state['t'] = time.time()
        loss = FlowMatchIdentityLoss(pipe, **inputs)
        log(f'call {c}: identity loss {loss.item():.4f}')
        return loss
    active_loss = smoke_loss
else:
    active_loss = FlowMatchIdentityLoss

import diffsynth.diffusion.loss as dl
dl.FlowMatchSFTLoss = active_loss                    # train.py's task_to_loss lambdas resolve this name at call time
import diffsynth.diffusion as dd
if hasattr(dd, 'FlowMatchSFTLoss'):
    dd.FlowMatchSFTLoss = active_loss
runpy.run_path('examples/wanvideo/model_training/train.py', init_globals={'FlowMatchSFTLoss': active_loss}, run_name='__main__')
