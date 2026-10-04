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
        'FaceID needs: models/ipadapter/ip-adapter-faceid-plusv2_sdxl.bin, models/loras/ip-adapter-faceid-plusv2_sdxl_lora.safetensors, models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors, plus the Python package insightface (antelopev2/buffalo_l downloads to models/insightface).',
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
      notes: 'Only needed if you feed photos instead of ready-made OpenPose skeleton images.',
    },
  },
  {
    test: /^ACN_/,
    pkg: { name: 'ComfyUI-Advanced-ControlNet', repo: 'https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet', notes: '' },
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
