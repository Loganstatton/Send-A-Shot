"""ComfyUI graphs for driver animation.

source_graph: a NEW different-looking woman from the base model (RealVisXL, no Sienna LoRA), neutral and mouth closed,
  used as the LivePortrait source (her face, hair, body, clothes and background stay hers).
lp_graph: LivePortrait (ComfyUI-LivePortraitKJ, MediaPipe cropper; no InsightFace) applies the TARGET photo's head
  rotation and expression to the source woman ('single_frame' = absolute rotation + expression of the driving image,
  source's own face shape and scale). Two variants: A plain, B with eye + lip retargeting (matches eye openness and
  lip opening ratios from the target's 203-point landmarks).
"""
CKPT = 'RealVisXL_V5.0_fp16.safetensors'
NEG = ('freckles, long dark brown wavy hair, green eyes, smiling, open mouth, teeth, nude, cleavage, lingerie, cartoon, '
       'illustration, 3d render, deformed, blurry, extra fingers, watermark, text')


def source_graph(prompt, seed, prefix, w=832, h=1216, neg=None):
    return {'1': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': CKPT}},
            '2': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['1', 1], 'text': prompt}},
            '3': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['1', 1], 'text': neg or NEG}},
            '4': {'class_type': 'EmptyLatentImage', 'inputs': {'width': w, 'height': h, 'batch_size': 1}},
            '5': {'class_type': 'KSampler', 'inputs': {'model': ['1', 0], 'positive': ['2', 0], 'negative': ['3', 0], 'latent_image': ['4', 0],
                                                       'seed': seed, 'steps': 28, 'cfg': 5.0, 'sampler_name': 'dpmpp_2m', 'scheduler': 'karras', 'denoise': 1.0}},
            '6': {'class_type': 'VAEDecode', 'inputs': {'samples': ['5', 0], 'vae': ['1', 2]}},
            '7': {'class_type': 'SaveImage', 'inputs': {'images': ['6', 0], 'filename_prefix': prefix}}}


def lp_graph(source_image, driving_image, prefix):
    crop = lambda img: {'class_type': 'LivePortraitCropper', 'inputs': {
        'pipeline': ['pipe', 0], 'cropper': ['cropper', 0], 'source_image': [img, 0], 'dsize': 512, 'scale': 2.3,
        'vx_ratio': 0.0, 'vy_ratio': -0.125, 'face_index': 0, 'face_index_order': 'large-small', 'rotate': True}}
    proc = lambda retarget: {'class_type': 'LivePortraitProcess', 'inputs': {
        'pipeline': ['pipe', 0], 'crop_info': ['scrop', 1], 'source_image': ['src', 0], 'driving_images': ['dcrop', 0],
        'lip_zero': False, 'lip_zero_threshold': 0.03, 'stitching': True, 'delta_multiplier': 1.0, 'mismatch_method': 'constant',
        'relative_motion_mode': 'single_frame', 'driving_smooth_observation_variance': 3e-6,
        **({'opt_retargeting_info': ['rt', 0]} if retarget else {})}}
    g = {'pipe': {'class_type': 'DownloadAndLoadLivePortraitModels', 'inputs': {'precision': 'fp16', 'mode': 'human'}},
         'cropper': {'class_type': 'LivePortraitLoadMediaPipeCropper', 'inputs': {'landmarkrunner_onnx_device': 'CPU', 'keep_model_loaded': True}},
         'src': {'class_type': 'LoadImage', 'inputs': {'image': source_image}},
         'drv': {'class_type': 'LoadImage', 'inputs': {'image': driving_image}},
         'scrop': crop('src'), 'dcrop': crop('drv'),
         'rt': {'class_type': 'LivePortraitRetargeting', 'inputs': {'driving_crop_info': ['dcrop', 1], 'eye_retargeting': True,
                'eyes_retargeting_multiplier': 1.0, 'lip_retargeting': True, 'lip_retargeting_multiplier': 1.0}},
         'pA': proc(False), 'pB': proc(True)}
    for v in ('A', 'B'):
        g[f'c{v}'] = {'class_type': 'LivePortraitComposite', 'inputs': {'source_image': ['src', 0], 'cropped_image': [f'p{v}', 0], 'liveportrait_out': [f'p{v}', 1]}}
        g[f's{v}'] = {'class_type': 'SaveImage', 'inputs': {'images': [f'c{v}', 0], 'filename_prefix': f'{prefix}_{v}'}}
    return g


# 16 clearly different women (all adults, clothed), varied hair, skin tone and framing. None resembles Sienna
# (long dark-brown wavy hair, green eyes, freckles), which the negative prompt also excludes.
_SELFIE = 'close-up phone selfie photo of a {who}, head and shoulders, facing the camera, neutral relaxed expression, mouth closed, {top}, {place}, natural light, realistic photo'
_TQ = 'head and shoulders photo of a {who}, body and head turned three-quarter to the {side}, neutral expression, mouth closed, {top}, {place}, realistic photo'
_WAIST = 'waist-up photo of a {who} walking toward the camera on a city sidewalk, neutral expression, mouth closed, {top}, daylight, realistic photo'
SOURCES = [
    ('sel01', _SELFIE.format(who='30 year old Nordic woman with platinum blonde chin-length bob', top='black t-shirt', place='kitchen')),
    ('sel02', _SELFIE.format(who='27 year old Irish woman with curly copper red shoulder-length hair', top='green sweater', place='living room')),
    ('sel03', _SELFIE.format(who='33 year old Korean woman with short black pixie cut', top='white blouse', place='office')),
    ('sel04', _SELFIE.format(who='38 year old woman with straight silver grey long hair', top='navy cardigan', place='bedroom')),
    ('sel05', _SELFIE.format(who='29 year old Black woman with natural afro hair', top='yellow top', place='bright room')),
    ('sel06', _SELFIE.format(who='26 year old Indian woman with long black hair in a single braid', top='maroon top', place='balcony')),
    ('sel07', _SELFIE.format(who='35 year old German woman with honey blonde hair in a high ponytail', top='grey hoodie', place='gym')),
    ('sel08', _SELFIE.format(who='31 year old Japanese woman with straight black hair and blunt bangs', top='beige trench coat', place='street')),
    ('sel09', _SELFIE.format(who='28 year old Brazilian woman with short platinum buzz cut', top='denim jacket', place='cafe')),
    ('sel10', _SELFIE.format(who='34 year old Black woman with long box braids', top='orange dress', place='garden')),
    ('sel11', _SELFIE.format(who='25 year old Swedish woman with strawberry blonde straight hair', top='striped shirt', place='car interior')),
    ('sel12', _SELFIE.format(who='36 year old Mexican woman with short auburn curly hair', top='white turtleneck', place='library')),
    ('tqR1', _TQ.format(who='32 year old woman with short ash blonde hair', side='right', top='blue shirt', place='plain grey wall')),
    ('tqR2', _TQ.format(who='29 year old East Asian woman with black bob haircut', side='right', top='red sweater', place='park')),
    ('tqL1', _TQ.format(who='30 year old Black woman with short natural curls', side='left', top='cream sweater', place='cafe')),
    ('wlk1', _WAIST.format(who='28 year old woman with short red hair', top='white t-shirt and black jacket')),
]


def lp_graph_relative(source_image, neutral_image, target_image, prefix, multipliers=(1.0, 1.3)):
    """Relative mode: driving = [Sienna neutral, Sienna target]. LivePortrait applies (target - neutral) expression and
    rotation to the source woman, so Sienna's own face shape cancels out of the motion. Choose the neutral photo with a
    head angle close to the source's, so rotation(out) = R_target R_neutral^T R_source ~ R_target. The second saved
    frame of each variant is the driver."""
    crop = lambda img: {'class_type': 'LivePortraitCropper', 'inputs': {
        'pipeline': ['pipe', 0], 'cropper': ['cropper', 0], 'source_image': [img, 0], 'dsize': 512, 'scale': 2.3,
        'vx_ratio': 0.0, 'vy_ratio': -0.125, 'face_index': 0, 'face_index_order': 'large-small', 'rotate': True}}
    g = {'pipe': {'class_type': 'DownloadAndLoadLivePortraitModels', 'inputs': {'precision': 'fp16', 'mode': 'human'}},
         'cropper': {'class_type': 'LivePortraitLoadMediaPipeCropper', 'inputs': {'landmarkrunner_onnx_device': 'CPU', 'keep_model_loaded': True}},
         'src': {'class_type': 'LoadImage', 'inputs': {'image': source_image}},
         'neu': {'class_type': 'LoadImage', 'inputs': {'image': neutral_image}},
         'tgt': {'class_type': 'LoadImage', 'inputs': {'image': target_image}},
         'scrop': crop('src'), 'ncrop': crop('neu'), 'tcrop': crop('tgt'),
         'drv': {'class_type': 'ImageBatch', 'inputs': {'image1': ['ncrop', 0], 'image2': ['tcrop', 0]}}}
    for i, m in enumerate(multipliers):
        v = 'AB'[i]
        g[f'p{v}'] = {'class_type': 'LivePortraitProcess', 'inputs': {
            'pipeline': ['pipe', 0], 'crop_info': ['scrop', 1], 'source_image': ['src', 0], 'driving_images': ['drv', 0],
            'lip_zero': False, 'lip_zero_threshold': 0.03, 'stitching': True, 'delta_multiplier': m, 'mismatch_method': 'constant',
            'relative_motion_mode': 'relative', 'driving_smooth_observation_variance': 3e-6}}
        g[f'c{v}'] = {'class_type': 'LivePortraitComposite', 'inputs': {'source_image': ['src', 0], 'cropped_image': [f'p{v}', 0], 'liveportrait_out': [f'p{v}', 1]}}
        g[f's{v}'] = {'class_type': 'SaveImage', 'inputs': {'images': [f'c{v}', 0], 'filename_prefix': f'{prefix}_{v}'}}
    return g


# Expression sources: the woman is generated WITH the target's natural expression; LivePortrait then only matches
# head rotation ('off' mode = rotation and translation from the driving image, expression and face shape from the source).
NEG_EXPR = ('freckles, long dark brown wavy hair, green eyes, grimace, distorted teeth, deformed mouth, asymmetric face, '
            'nude, cleavage, lingerie, cartoon, illustration, 3d render, deformed, blurry, extra fingers, watermark, text')


def lp_graph_rotation(source_image, target_image, prefix):
    crop = lambda img: {'class_type': 'LivePortraitCropper', 'inputs': {
        'pipeline': ['pipe', 0], 'cropper': ['cropper', 0], 'source_image': [img, 0], 'dsize': 512, 'scale': 2.3,
        'vx_ratio': 0.0, 'vy_ratio': -0.125, 'face_index': 0, 'face_index_order': 'large-small', 'rotate': True}}
    return {'pipe': {'class_type': 'DownloadAndLoadLivePortraitModels', 'inputs': {'precision': 'fp16', 'mode': 'human'}},
            'cropper': {'class_type': 'LivePortraitLoadMediaPipeCropper', 'inputs': {'landmarkrunner_onnx_device': 'CPU', 'keep_model_loaded': True}},
            'src': {'class_type': 'LoadImage', 'inputs': {'image': source_image}},
            'tgt': {'class_type': 'LoadImage', 'inputs': {'image': target_image}},
            'scrop': crop('src'), 'tcrop': crop('tgt'),
            'p': {'class_type': 'LivePortraitProcess', 'inputs': {
                'pipeline': ['pipe', 0], 'crop_info': ['scrop', 1], 'source_image': ['src', 0], 'driving_images': ['tcrop', 0],
                'lip_zero': False, 'lip_zero_threshold': 0.03, 'stitching': True, 'delta_multiplier': 1.0, 'mismatch_method': 'constant',
                'relative_motion_mode': 'off', 'driving_smooth_observation_variance': 3e-6}},
            'c': {'class_type': 'LivePortraitComposite', 'inputs': {'source_image': ['src', 0], 'cropped_image': ['p', 0], 'liveportrait_out': ['p', 1]}},
            's': {'class_type': 'SaveImage', 'inputs': {'images': ['c', 0], 'filename_prefix': prefix}}}


_WHO = ['28 year old Scandinavian woman with platinum blonde pixie cut', '31 year old Black woman with short natural curls',
        '26 year old Korean woman with straight black shoulder-length hair', '35 year old Irish woman with copper red bob',
        '29 year old Indian woman with black hair in a high bun', '33 year old woman with ash blonde shoulder-length straight hair',
        '27 year old Brazilian woman with short dyed burgundy hair', '30 year old Japanese woman with black hair and blunt bangs',
        '34 year old Black woman with long box braids', '25 year old Polish woman with honey blonde braid',
        '32 year old Mexican woman with short black curly hair', '36 year old woman with silver grey bob']
_TOP = ['white t-shirt', 'navy sweater', 'green blouse', 'black turtleneck', 'red hoodie', 'striped shirt']
_PLACE = ['kitchen', 'living room', 'bedroom by a window', 'cafe', 'office', 'city street']
# target -> (expression, head/framing), written from the approved photo; yaw sign: + = face turned toward image right
EXPR_TARGETS = {
    'O-002': ('big natural smile showing upper teeth, eyes smiling', 'close-up phone selfie, facing the camera, head tilted slightly'),
    'O-011': ('big natural toothy smile, eyes crinkled', 'close-up phone selfie, facing the camera, head slightly tilted'),
    'R1-09': ('laughing out loud with mouth open, genuine laughter', 'head and shoulders photo, facing the camera, head slightly tilted'),
    'R1-11': ('big open smile showing teeth, joyful', 'head and shoulders photo, head tilted to one side, facing the camera'),
    'P43':   ('talking with mouth open mid-sentence, teeth visible, friendly', 'chest-up candid photo, facing the camera, one hand raised near her cheek'),
    'O-005': ('soft closed-mouth smile', 'close-up phone selfie, head turned three-quarter to the side and tilted'),
    'O-007': ('soft closed-mouth smile', 'close-up phone selfie, head strongly tilted to one side'),
    'O-013': ('soft closed-mouth smile, warm eyes', 'close-up phone selfie, facing the camera'),
    'O-025': ('gentle closed-mouth smile', 'close-up phone selfie, head tilted to one side'),
    'P7':    ('warm closed-mouth smile', 'head and shoulders photo, body and face turned three-quarter to the right, seen from her left side'),
}


def expr_prompt(i, expr, frame):
    kind, pose = frame.split(', ', 1)
    return (f'{kind} of a {_WHO[i % len(_WHO)]}, {expr}, {pose}, wearing a {_TOP[i % len(_TOP)]}, in a {_PLACE[(i // 2) % len(_PLACE)]}, '
            'natural light, realistic photo, natural skin texture')
