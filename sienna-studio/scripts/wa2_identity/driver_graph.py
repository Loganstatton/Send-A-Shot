"""ComfyUI API graph for a training DRIVER: a different woman in the target's exact pose and expression.

target image -> DWPose (body + hands + 68 face points: mouth opening, eyes, brows) -> OpenPose ControlNet (xinsir
SDXL, already installed by --with-pose) -> RealVisXL WITHOUT Sienna's LoRA, prompted as a different person in
different clothes and a different place. The target's identity never enters this graph except as keypoints.
QA after generation (qa_driver in build pipeline): her face score vs Sienna must be < 0.45 and the DWPose body/face
keypoints must match the target's (so pose and expression agree).
"""
import json, random, sys

PEOPLE = ['woman with short platinum blonde hair', 'woman with straight black hair in a ponytail', 'woman with curly red hair',
          'woman with a dark brown bob haircut', 'woman with braided black hair', 'woman with light brown shoulder-length hair',
          'woman with wavy auburn hair', 'woman with very short dark hair']
LOOKS = ['East Asian', 'Black', 'South Asian', 'Northern European', 'Latina', 'Middle Eastern', 'Mediterranean']
OUTFITS = ['denim overalls over a striped shirt', 'black hoodie and grey sweatpants', 'green athletic jacket and leggings', 'yellow raincoat',
           'red flannel shirt and jeans', 'navy blazer and white trousers', 'orange sundress', 'grey sweater and plaid skirt']
PLACES = ['busy city street', 'gym with mirrors', 'kitchen with wooden cabinets', 'library aisle', 'beach boardwalk', 'office lobby', 'garden patio']


def driver_graph(target_file, seed, ckpt='RealVisXL_V5.0_fp16.safetensors', cn='sdxl_openpose.safetensors', w=832, h=1216, strength=0.9):
    rnd = random.Random(seed)
    person = f"{rnd.choice(LOOKS)} {rnd.choice(PEOPLE)}, adult, wearing {rnd.choice(OUTFITS)}, in a {rnd.choice(PLACES)}"
    pos = f"realistic photo of a {person}, natural light, sharp focus"
    neg = 'freckles, long dark brown wavy hair, hazel-green eyes, cartoon, deformed, extra limbs, nude'
    return person, {
        'img': {'class_type': 'LoadImage', 'inputs': {'image': target_file}},
        'dw': {'class_type': 'DWPreprocessor', 'inputs': {'image': ['img', 0], 'detect_hand': 'enable', 'detect_body': 'enable', 'detect_face': 'enable',
                                                         'resolution': 1024, 'bbox_detector': 'yolox_l.onnx', 'pose_estimator': 'dw-ll_ucoco_384_bs5.torchscript.pt',
                                                         'scale_stick_for_xinsr_cn': 'enable'}},
        'ck': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': ckpt}},
        'po': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['ck', 1], 'text': pos}},
        'ne': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['ck', 1], 'text': neg}},
        'cl': {'class_type': 'ControlNetLoader', 'inputs': {'control_net_name': cn}},
        'ca': {'class_type': 'ControlNetApplyAdvanced', 'inputs': {'positive': ['po', 0], 'negative': ['ne', 0], 'control_net': ['cl', 0], 'image': ['dw', 0],
                                                                  'strength': strength, 'start_percent': 0.0, 'end_percent': 1.0}},
        'la': {'class_type': 'EmptyLatentImage', 'inputs': {'width': w, 'height': h, 'batch_size': 1}},
        'ks': {'class_type': 'KSampler', 'inputs': {'model': ['ck', 0], 'positive': ['ca', 0], 'negative': ['ca', 1], 'latent_image': ['la', 0], 'seed': seed,
                                                   'steps': 25, 'cfg': 5, 'sampler_name': 'dpmpp_2m', 'scheduler': 'karras', 'denoise': 1}},
        'de': {'class_type': 'VAEDecode', 'inputs': {'samples': ['ks', 0], 'vae': ['ck', 2]}},
        'sv': {'class_type': 'SaveImage', 'inputs': {'images': ['de', 0], 'filename_prefix': 'wa2drivers/d'}},
        'pv': {'class_type': 'PreviewImage', 'inputs': {'images': ['dw', 0]}},
    }


if __name__ == '__main__':
    person, g = driver_graph(sys.argv[1], int(sys.argv[2]))
    print(json.dumps({'person': person, 'graph': g}))
