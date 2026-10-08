// Which custom-node package provides a node class, so diagnostics can say
// exactly what to install. Classes not matched here are assumed to be core
// ComfyUI (or unknown — diagnostics then just reports the class name).

export interface NodePackage {
  name: string;
  repo: string;
  /** Model files / folders the package needs, for the docs + diagnostics. */
  notes: string;
}

const PACKAGES: { test: RegExp; pkg: NodePackage }[] = [
  {
    test: /^IPAdapter/,
    pkg: {
      name: 'ComfyUI_IPAdapter_plus',
      repo: 'https://github.com/cubiq/ComfyUI_IPAdapter_plus',
      notes:
        'Outfit reference needs: models/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors and models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors (scripts/comfyui-bootstrap.sh --with-outfit). FaceID needs: models/ipadapter/ip-adapter-faceid-plusv2_sdxl.bin, models/loras/ip-adapter-faceid-plusv2_sdxl_lora.safetensors, models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors, plus the Python package insightface (antelopev2/buffalo_l downloads to models/insightface).',
    },
  },
  {
    test: /Pulid.*Flux|PulidFlux/,
    pkg: {
      name: 'ComfyUI-PuLID-Flux',
      repo: 'https://github.com/balazik/ComfyUI-PuLID-Flux',
      notes:
        'Needs models/pulid/pulid_flux_v0.9.1.safetensors, insightface + facexlib Python packages, AntelopeV2 in models/insightface/models/antelopev2. EVA-CLIP downloads automatically on first run.',
    },
  },
  {
    test: /^(ApplyPulid|PulidModelLoader|PulidInsightFaceLoader|PulidEvaClipLoader)/,
    pkg: { name: 'PuLID_ComfyUI', repo: 'https://github.com/cubiq/PuLID_ComfyUI', notes: 'SDXL PuLID. Needs models/pulid/ip-adapter_pulid_sdxl_fp16.safetensors.' },
  },
  {
    test: /InstantID/,
    pkg: { name: 'ComfyUI_InstantID', repo: 'https://github.com/cubiq/ComfyUI_InstantID', notes: 'Needs models/instantid/ip-adapter.bin and an InstantID ControlNet.' },
  },
  {
    test: /Preprocessor$|^DWPreprocessor|^OpenposePreprocessor|^AIO_Preprocessor/,
    pkg: {
      name: 'comfyui_controlnet_aux',
      repo: 'https://github.com/Fannovel16/comfyui_controlnet_aux',
      notes:
        'Pose copying: DWPreprocessor turns a reference photo into a skeleton (pose only, no face or body). Install with scripts/comfyui-bootstrap.sh --with-pose, which also downloads models/controlnet/sdxl_openpose.safetensors.',
    },
  },
  {
    test: /^ACN_/,
    pkg: { name: 'ComfyUI-Advanced-ControlNet', repo: 'https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet', notes: '' },
  },
  {
    test: /^(FaceDetailer|SAMLoader|BboxDetector|SegmDetector)/,
    pkg: {
      name: 'ComfyUI-Impact-Pack',
      repo: 'https://github.com/ltdrdata/ComfyUI-Impact-Pack',
      notes: 'Face refinement. Also needs ComfyUI-Impact-Subpack (face detector) and models/ultralytics/bbox/face_yolov8m.pt.',
    },
  },
  {
    test: /^UltralyticsDetectorProvider$/,
    pkg: {
      name: 'ComfyUI-Impact-Subpack',
      repo: 'https://github.com/ltdrdata/ComfyUI-Impact-Subpack',
      notes:
        'Needs models/ultralytics/bbox/face_yolov8m.pt; the outfit reference also needs models/ultralytics/segm/person_yolov8m-seg.pt (both from https://huggingface.co/Bingsu/adetailer).',
    },
  },
  {
    test: /^(DownloadAndLoadFlorence2Model|Florence2Run|Florence2ModelLoader)$/,
    pkg: {
      name: 'ComfyUI-Florence2',
      repo: 'https://github.com/kijai/ComfyUI-Florence2',
      notes: 'Outfit analysis. microsoft/Florence-2-large is downloaded to models/LLM/Florence-2-large by scripts/comfyui-bootstrap.sh --with-outfit.',
    },
  },
  {
    test: /^(GetImageSizeAndCount)$/,
    pkg: { name: 'ComfyUI-KJNodes', repo: 'https://github.com/kijai/ComfyUI-KJNodes', notes: 'Image size helper used by the outfit garment isolation.' },
  },
  {
    test: /^SiennaTextOutput$/,
    pkg: {
      name: 'sienna_text_output (written by scripts/comfyui-bootstrap.sh --with-outfit)',
      repo: 'scripts/comfyui-bootstrap.sh',
      notes: 'Tiny output node that returns the outfit description to the app.',
    },
  },
  {
    test: /GGUF/,
    pkg: { name: 'ComfyUI-GGUF', repo: 'https://github.com/city96/ComfyUI-GGUF', notes: 'For quantised Flux UNETs in models/unet.' },
  },
];

export function packageFor(classType: string): NodePackage | null {
  return PACKAGES.find((p) => p.test.test(classType))?.pkg ?? null;
}

/** Classes the app treats as the "identity" / "control" families for diagnostics. */
export const IDENTITY_CLASSES = ['IPAdapterUnifiedLoaderFaceID', 'IPAdapterFaceID', 'IPAdapterAdvanced', 'ApplyPulidFlux', 'ApplyPulid', 'ApplyInstantID'];
export const CONTROLNET_CLASSES = ['ControlNetLoader', 'ControlNetApplyAdvanced', 'SetUnionControlNetType', 'DWPreprocessor'];
