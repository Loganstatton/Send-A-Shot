import sys, torch, types; sys.path.insert(0, '/workspace/wa2_identity'); import face_loss as fl
class Sched:
    timesteps = torch.tensor([500.0]); training = True
    def add_noise(self, x, n, t): return x
    def training_target(self, x, n, t): return x
    def training_weight(self, t): return 1.0
lat = torch.zeros(1, 16, 2, 96, 66)
def run(pred_fn, box):
    pipe = types.SimpleNamespace(scheduler=Sched(), torch_dtype=torch.float32, device='cpu', in_iteration_models=[], model_fn=lambda **k: pred_fn())
    return fl.FlowMatchIdentityLoss(pipe, input_latents=lat.clone(), face_box=box).item()
slot_err = lambda: torch.cat([torch.full((1, 16, 1, 96, 66), 10.0), torch.zeros(1, 16, 1, 96, 66)], 2)   # error only in the reference slot
print('LOSSCHECK error only in reference slot -> identity loss', run(slot_err, '0.4,0.1,0.6,0.3'), '| stock-style loss', ((slot_err() - lat) ** 2).mean().item())
face = torch.zeros(1, 16, 2, 96, 66); face[:, :, 1, 9:29, 26:40] = 1.0; bg = torch.zeros(1, 16, 2, 96, 66); bg[:, :, 1, 60:80, 26:40] = 1.0
a, b = run(lambda: face, '0.4,0.1,0.6,0.3'), run(lambda: bg, '0.4,0.1,0.6,0.3')
print(f'LOSSCHECK same-size error in face region {a:.5f} vs background {b:.5f} -> ratio {a / b:.2f}')
w = fl.face_weight_map('0.4,0.1,0.6,0.3', 96, 66, 'cpu', torch.float32); print('LOSSCHECK weight map mean', round(w.mean().item(), 4), '| face/background weight', round((w.max() / w.min()).item(), 2))
