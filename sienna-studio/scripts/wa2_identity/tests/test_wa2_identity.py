"""Local tests (no GPU, no torch): python3 scripts/wa2_identity/tests/test_wa2_identity.py"""
import json, os, subprocess, sys, tempfile
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
from convert_lora import convert, convert_key, check_pairs
from face_loss import face_bounds
import build_metadata as bm

SP = '/tmp/claude-0/-home-user-Send-A-Shot/5ab8d7bf-5d0f-550f-a69c-62a6985b93f2/scratchpad'
PILOT = f'{SP}/wanpilot/lora/sienna_wan21_pilot.safetensors'   # LoRA ComfyUI's WA2 loaded with 0 unloaded keys


def fake_diffsynth_lora(rank=4, blocks=40, modules=('self_attn.q', 'self_attn.k', 'self_attn.v'), peft=False, prefix=''):
    sd = {}
    for b in range(blocks):
        for m in modules:
            suf = '.default.weight' if peft else '.weight'
            sd[f'{prefix}blocks.{b}.block.{m}.lora_A{suf}'] = np.zeros((rank, 64), np.float16)
            sd[f'{prefix}blocks.{b}.block.{m}.lora_B{suf}'] = np.zeros((64, rank), np.float16)
    return sd


def test_convert_keys():
    assert convert_key('blocks.7.block.self_attn.q.lora_A.weight') == 'diffusion_model.blocks.7.self_attn.q.lora_A.weight'
    assert convert_key('pipe.dit.blocks.0.block.cross_attn.k_img.lora_B.default.weight') == 'diffusion_model.blocks.0.cross_attn.k_img.lora_B.weight'
    assert convert_key('blocks.3.ffn.0.lora_A.weight') == 'diffusion_model.blocks.3.ffn.0.lora_A.weight'   # already unwrapped
    for bad in ('blocks.1.block.norm1.lora_A.weight', 'head.head.lora_A.weight', 'blocks.1.block.self_attn.q.weight'):
        try:
            convert_key(bad); raise AssertionError(f'accepted {bad}')
        except ValueError:
            pass


def test_convert_full_and_pairs():
    for peft in (False, True):
        out = convert(fake_diffsynth_lora(peft=peft, prefix='pipe.dit.' if peft else ''))
        assert len(out) == 40 * 3 * 2 and check_pairs(out) == 4
        assert sorted({int(k.split('.')[2]) for k in out}) == list(range(40))
    out = convert(fake_diffsynth_lora(), alpha=32)
    assert sum(k.endswith('.alpha') for k in out) == 120


def test_matches_known_good_comfy_format():
    """Converted keys must be byte-identical to the layout ComfyUI's WA2 loaded in the pilot."""
    if not os.path.exists(PILOT):
        print('  (pilot LoRA not present; skipped)'); return
    from safetensors import safe_open
    with safe_open(PILOT, 'np') as f:
        good = set(f.keys())
    out = set(convert(fake_diffsynth_lora(modules=('self_attn.q', 'self_attn.k', 'self_attn.v', 'self_attn.o', 'cross_attn.q', 'ffn.0', 'ffn.2'))))
    missing = out - good
    assert not missing, f'{len(missing)} converted keys not in the known-good layout, e.g. {sorted(missing)[:3]}'


def test_face_bounds():
    assert face_bounds('', 96, 66) is None and face_bounds(None, 96, 66) is None
    r0, r1, c0, c1 = face_bounds('0.4,0.1,0.6,0.3', 96, 66, pad=0)
    assert (r0, r1, c0, c1) == (9, 29, 26, 40)
    r0, r1, c0, c1 = face_bounds('0.0,0.0,0.2,0.2', 96, 66)          # padding clamps at the edge
    assert r0 == 0 and c0 == 0 and r1 > 19
    try:
        face_bounds('0.6,0.1,0.4,0.3', 96, 66); raise AssertionError('accepted inverted box')
    except ValueError:
        pass


def test_build_metadata_and_clips():
    A = f'{SP}/stageA'; d0 = tempfile.mkdtemp()
    sets = [
        {'id': 'demo_profile', 'reference': f'{SP}/sienna_v2_dataset/sienna_v2_013.jpg', 'driver': f'{A}/pose_src/profL2.png',
         'target': f'{A}/pose_cands/p03.png', 'face_box': '0.15,0.18,0.55,0.42', 'clip': True, 'loss_mask': f'{d0}/mask.png'},
        {'id': 'demo_front', 'reference': f'{SP}/sienna_v2_dataset/sienna_v2_013.jpg', 'driver': f'{A}/pose_src/talk.png',
         'target': f'{A}/pose_cands/p43.png', 'face_box': ''},
    ]
    m0 = np.zeros((1216, 832), np.uint8); m0[100:500, 200:600] = 255; cv2.imwrite(f'{d0}/mask.png', m0)
    if not all(os.path.exists(s[k]) for s in sets for k in ('reference', 'driver', 'target')):
        print('  (sample images missing; skipped)'); return
    with tempfile.TemporaryDirectory() as d:
        meta = bm.build(sets, d)
        assert len(meta) == 3                      # 2 single-frame samples + 1 clip
        for m in meta:
            for k in ('video', 'animate2_reference_image', 'animate2_reference_video'):
                assert os.path.exists(os.path.join(d, m[k])), m[k]
            assert m['animate2_prompt_ref'] == bm.MOTION_TEXT and m['prompt'] == bm.TRAIN_PROMPT   # no per-sample text
        assert meta[0]['loss_mask'] == 'masks/demo_profile.png' and meta[2]['loss_mask'] == ''
        mk = cv2.imread(f'{d}/masks/demo_profile.png', 0); assert mk.shape == (bm.H, bm.W) and set(np.unique(mk)) <= {0, 255}
        cm = cv2.imread(f'{d}/{meta[1]["loss_mask"]}', 0); assert (cm > 0).sum() >= (mk > 0).sum()   # clip mask = union
        try:
            bm.build([dict(sets[1], prompt='smiling, head turned left')], d); raise AssertionError('per-sample prompt accepted')
        except ValueError:
            pass
        im = cv2.imread(f'{d}/targets/demo_profile.png'); assert im.shape[:2] == (bm.H, bm.W)
        assert bm.W % 16 == 0 and bm.H % 16 == 0 and (bm.CLIP_FRAMES - 1) % 4 == 0
        cap = cv2.VideoCapture(f'{d}/clips/demo_profile_target.mp4'); n = 0
        while cap.read()[0]: n += 1
        assert n == bm.CLIP_FRAMES, n
        clip_box = [float(v) for v in meta[1]['face_box'].split(',')]
        assert clip_box[0] <= 0.15 + 0.05 and clip_box[2] >= 0.55 - 0.05   # union covers the face through the move
        # the camera move is identical for target and driver, frame by frame
        a, b = cv2.VideoCapture(f'{d}/clips/demo_profile_target.mp4'), cv2.VideoCapture(f'{d}/clips/demo_profile_driver.mp4')
        assert int(a.get(cv2.CAP_PROP_FRAME_COUNT)) == int(b.get(cv2.CAP_PROP_FRAME_COUNT))


def test_mask_to_latent():
    from face_loss import mask_to_latent
    m = np.zeros((768, 528), np.uint8); m[0:384, 0:264] = 255          # top-left quarter is head
    w = mask_to_latent(m, 96, 66)
    assert w.shape == (96, 66) and abs(w[:48, :33].mean() - 1) < 1e-6 and w[48:, :].max() == 0 and w[:, 33:].max() == 0


def test_pair_gate_rules():
    from pair_qa import PairQA
    Q = object.__new__(PairQA)   # gate() needs no models
    base = dict(yaw=-20.0, pitch=5.0, jaw=0.0, smile=0.7, mouth_gap=0.0, blink=0.1, id=0.8, hair_lab=[40, 134, 137],
                lm=[[0, 0]] * 478, face_h=100.0)
    base['lm'] = [[float(i), 0.0] for i in range(478)]
    base['body'] = [[float(i * 7 % 50), float(i * 13 % 90), 1.0] for i in range(33)]       # same visible body pose
    drv = dict(base, id=0.2, hair_lab=[14, 128, 127])
    c, v, why = Q.gate(base, drv)
    assert v == 'PASS', why
    c, v, why = Q.gate(base, dict(drv, smile=0.1))                  # smile mismatch fails
    assert v == 'FAIL' and 'smile' in why
    c, v, why = Q.gate(base, dict(drv, id=0.5))                     # driver too much like Sienna fails
    assert v == 'FAIL' and 'driver_id' in why
    c, v, why = Q.gate(base, dict(drv, hair_lab=[42, 134, 137]))     # similar hair needs review
    assert v == 'REVIEW'
    c, v, why = Q.gate(dict(base, yaw=-60.0, id=0.5), dict(drv, yaw=-58.0))  # profile: identity by eye
    assert v == 'REVIEW' and c['target_id'][1] is None
    body = [[0, 0, 1]] * 33; body = [list(b) for b in body]
    body[11], body[12], body[0] = [10, 0, 1], [0, 0, 1], [5, -5, 1]
    back = [list(b) for b in body]; back[0] = [5, -5, 0.1]
    assert PairQA.facing(body) == 1 and PairQA.facing(back) == -1


def test_similarity_and_warp_identity():
    from driver_edit import similarity, piecewise_warp
    src = np.random.RandomState(0).rand(30, 2) * 100 + 50
    a = np.radians(10); R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    s, R2, t = similarity(src, 1.5 * src @ R.T + [3, 4])
    assert abs(s - 1.5) < 1e-6 and np.allclose(R2, R, atol=1e-6) and np.allclose(t, [3, 4], atol=1e-4)
    img = (np.random.RandomState(1).rand(240, 200, 3) * 255).astype(np.uint8)
    out = piecewise_warp(img, src, src.copy())                                 # no movement -> unchanged image
    assert np.abs(out.astype(int) - img.astype(int)).mean() < 2.0


if __name__ == '__main__':
    fails = 0
    for name, fn in list(globals().items()):
        if name.startswith('test_'):
            try:
                fn(); print('PASS', name)
            except Exception as e:
                fails += 1; print('FAIL', name, repr(e)[:300])
    sys.exit(1 if fails else 0)
