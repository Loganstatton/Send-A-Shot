import type { AppSettings, CharacterProfile, GenerationParams, Preset, PromptFields } from './types';

export const MIN_CHARACTER_AGE = 21;

export const EMPTY_FIELDS: PromptFields = {
  outfit: '',
  pose: '',
  bodyPresentation: '',
  expression: '',
  setting: '',
  lighting: '',
  camera: '',
  framing: '',
  realism: '',
  extra: '',
  avoid: '',
};

/** Realism language favouring casual phone photography over glossy "AI" renders. */
export const DEFAULT_REALISM_PROMPT = [
  'realistic candid iPhone photo',
  'natural skin texture with subtle visible pores',
  'fine flyaway hair strands',
  'natural facial asymmetry',
  'believable ambient indoor lighting',
  'slight wide-angle phone lens distortion',
  'casual non-cinematic snapshot',
  'imperfect slightly off-center framing',
  'anatomically correct hands with five fingers',
  'believable reflections',
  'soft natural shadows',
].join(', ');

export const DEFAULT_NEGATIVE_PROMPT = [
  'over-smoothed skin',
  'airbrushed',
  'plastic skin',
  'waxy skin',
  'doll-like face',
  'cgi',
  '3d render',
  'illustration',
  'anime',
  'over-sharpened',
  'excessive HDR',
  'oversaturated',
  'perfect symmetry',
  'beauty filter',
  'extra fingers',
  'fused fingers',
  'deformed hands',
  'extra limbs',
  'bad anatomy',
  'distorted teeth',
  'warped background',
  'duplicate objects',
  'watermark',
  'text',
  'logo',
  'lowres',
  'blurry',
  'jpeg artifacts',
].join(', ');

/** Added to the negative prompt unless the user explicitly picks studio lighting. */
export const NON_STUDIO_NEGATIVE = 'studio lighting, glossy fashion editorial, cinematic color grading';

/** Always in the negative prompt — keeps output clearly adult. */
export const ADULT_ONLY_NEGATIVE = 'child, teen, minor, childlike, school uniform';

/**
 * Added when Sienna Lock is on. SDXL base models drift Sienna older than her
 * stated age; these terms hold her at it. (A "young-looking" negative made
 * the drift worse, so the adult-only terms above avoid it.)
 */
export const AGE_DRIFT_NEGATIVE = 'older woman, middle-aged, wrinkles, aged skin, mature face';
/**
 * Prompt cleanup (experimental): the same age guard without the terms that also penalise
 * natural skin texture ("wrinkles, aged skin" push the sampler toward smooth, airbrushed skin).
 */
export const AGE_DRIFT_NEGATIVE_CLEAN = 'older woman, middle-aged, mature face';

/** Added in SFW mode. */
/** Prepended when a request asks for a full-body shot; weaker wording came out as selfie crops. */
export const FULL_BODY_FRAMING = 'full body head to toe, entire body visible including feet and shoes, wide shot, camera several meters away';

/** Full-body mirror selfies: strengthen the reflected composition instead (no anti-selfie negative). */
export const MIRROR_FULL_BODY_FRAMING =
  'full-length mirror selfie, entire reflected body visible from head to toe including feet and shoes, tall mirror fully framing her body, phone visible in hand, camera far enough from the mirror to capture the entire reflection';
/** Camera line for (non-mirror) full-body shots, replacing the default phone-camera line. */
export const FULL_BODY_CAMERA = 'realistic iPhone photo taken by another person from several meters away, natural phone-camera processing';
/** Negative for (non-mirror) full-body shots. */
export const FULL_BODY_NEGATIVE = "arm's-length selfie, close-up crop, cropped legs, cropped feet";
/** Default realism fragment implying a close phone camera; dropped for full-body shots. */
export const CLOSE_CAMERA_REALISM = 'slight wide-angle phone lens distortion';

/** Sienna's eye wording; buildPrompt places it at the end of the positive prompt. */
export const EYE_TRAIT = 'natural hazel-green eyes with realistic muted iris color';
/** Eye wording saved in profiles before the prompt reorder; upgraded to EYE_TRAIT. */
export const LEGACY_EYE_TRAIT = 'natural light hazel-green eyes, muted realistic iris color';

export const SFW_NEGATIVE = 'nsfw, nude, nudity, topless, explicit, sexual, lingerie, see-through';

/** Added when Sienna Lock is on, to discourage identity drift. */
export const LOCK_NEGATIVE = 'different person, altered face, different face shape, different hair color, different eye color';

export const DEFAULT_CHARACTER: CharacterProfile = {
  name: 'Sienna',
  triggerToken: 'sienna_v1',
  loraFilename: 'sienna_v2.safetensors',
  loraWeight: 1,
  loraClipWeight: 1,
  age: 24,
  faceReference: null,
  secondaryReferences: [],
  appearanceTraits: `fictional adult woman, long dark-brown wavy hair with lighter caramel ends, light freckles across nose and cheeks, ${EYE_TRAIT}`,
  defaultRealismPrompt: DEFAULT_REALISM_PROMPT,
  defaultNegativePrompt: DEFAULT_NEGATIVE_PROMPT,
  defaultCameraStyle: 'shot on iPhone 15 Pro, 24mm main camera, natural phone processing',
  extraLockedTerms: [],
  fictionalAttestation: false,
  updatedAt: new Date(0).toISOString(),
};

export const DEFAULT_PARAMS: GenerationParams = {
  checkpoint: '',
  sampler: 'ddpm',
  scheduler: 'normal',
  seed: -1,
  width: 832,
  height: 1216,
  steps: 30,
  cfg: 5,
  denoise: 1,
  loraName: '',
  siennaModel: '',
  loraStrength: 1,
  loraClipStrength: 1,
  faceStrength: 0.8,
  controlStrength: 0.65,
  controlnetModel: '',
  batchSize: 1,
  faceRefine: true,
  faceRefineDenoise: 0.3,
  faceRefineThreshold: 384,
  outfitStrength: 0.7,
  outfitMode: 'design',
  poseFit: 'pad',
  poseRetarget: 0,
  hires: false,
  hiresScale: 1.5,
  hiresDenoise: 0.3,
  hiresLoraStrength: 0.7,
  hiresSteps: 20,
  promptCleanup: false,
  outfitIsolation: 'person',
  stylePacks: {},
};

export const DEFAULT_SETTINGS: AppSettings = {
  comfyUrl: '',
  setupComplete: false,
  setupStep: 0,
  defaultWorkflowId: 'sienna-sdxl-production',
  defaultParams: DEFAULT_PARAMS,
  contentMode: 'sfw',
  siennaLockDefault: true,
  generationTimeoutSec: 900,
  updatedAt: new Date(0).toISOString(),
};

/** Portrait aspect ratios sized for SDXL / Flux (~1MP). */
export const SIZE_PRESETS: { label: string; width: number; height: number }[] = [
  { label: 'Portrait 2:3', width: 832, height: 1216 },
  { label: 'Phone 9:16', width: 768, height: 1344 },
  { label: 'Portrait 3:4', width: 896, height: 1152 },
  { label: 'Square 1:1', width: 1024, height: 1024 },
  { label: 'Landscape 3:2', width: 1216, height: 832 },
];

type BuiltinPresetSeed = Omit<Preset, 'builtIn' | 'updatedAt' | 'workflowId' | 'fields'> & {
  fields: Partial<PromptFields>;
};

const BUILTIN_PRESET_SEEDS: BuiltinPresetSeed[] = [
  {
    id: 'iphone-selfie',
    name: 'iPhone selfie',
    emoji: '🤳',
    fields: {
      outfit: 'oversized cream knit sweater',
      pose: 'holding the phone at arm’s length, head tilted slightly',
      expression: 'relaxed soft smile, looking into the lens',
      setting: 'lived-in apartment living room, a little cluttered',
      lighting: 'soft daylight from a nearby window',
      camera: 'iPhone front camera selfie, wide-angle lens, slight distortion near frame edges',
      framing: 'close-up head and shoulders, slightly off-center, shoulder of the arm holding the phone visible',
    },
    params: { width: 832, height: 1216 },
  },
  {
    id: 'mirror-selfie',
    name: 'Mirror selfie',
    emoji: '🪞',
    fields: {
      outfit: 'fitted ribbed tank top and high-waisted jeans',
      pose: 'standing, taking a mirror selfie with an iPhone held at chest height, phone partially covering the chin',
      expression: 'neutral confident expression, looking at the phone screen',
      setting: 'bedroom full-length mirror, slightly smudged glass, clothes on a chair in the background',
      lighting: 'warm ceiling light mixed with evening window light',
      camera: 'iPhone rear camera photographed in the mirror, phone visible in reflection',
      framing: 'three-quarter body, mirror edge visible, slightly tilted horizon',
    },
    params: { width: 768, height: 1344 },
  },
  {
    id: 'bedroom',
    name: 'Bedroom',
    emoji: '🛏️',
    fields: {
      outfit: 'soft cotton pajama set',
      pose: 'sitting cross-legged on an unmade bed',
      expression: 'sleepy half smile',
      setting: 'cozy bedroom, rumpled linen sheets, bedside lamp, plants on the windowsill',
      lighting: 'warm bedside lamp light with cool morning light from the window',
      camera: 'iPhone photo taken by a friend',
      framing: 'medium shot, casual composition',
    },
    params: {},
  },
  {
    id: 'car-selfie',
    name: 'Car selfie',
    emoji: '🚗',
    fields: {
      outfit: 'denim jacket over a white t-shirt',
      pose: 'sitting in the driver’s seat, seatbelt on, car parked',
      expression: 'playful grin',
      setting: 'inside a parked car, dashboard and headrest visible, street outside the window',
      lighting: 'daylight through the windshield, soft shadows on face',
      camera: 'iPhone front camera selfie, wide-angle lens',
      framing: 'close-up, slightly low angle, car interior framing the face',
    },
    params: {},
  },
  {
    id: 'bathroom-mirror',
    name: 'Bathroom mirror',
    emoji: '🚿',
    fields: {
      outfit: 'white fluffy bathrobe, hair loosely clipped up',
      pose: 'standing at the sink, taking a mirror selfie',
      expression: 'soft natural expression',
      setting: 'small apartment bathroom, tiled wall, toiletries on the counter, slightly fogged mirror edges',
      lighting: 'overhead vanity light, slightly warm, realistic bathroom reflections',
      camera: 'iPhone rear camera photographed in the mirror',
      framing: 'waist-up, mirror frame visible',
    },
    params: {},
  },
  {
    id: 'couch',
    name: 'Couch',
    emoji: '🛋️',
    fields: {
      outfit: 'comfy hoodie and lounge shorts, fuzzy socks',
      pose: 'curled up on the couch with knees up, holding a mug',
      expression: 'small natural laugh, mouth slightly open, looking off-camera',
      setting: 'living room couch with throw blanket and cushions, TV glow in the background',
      lighting: 'warm lamp light, evening ambience',
      camera: 'iPhone photo taken from across the couch',
      framing: 'medium-wide shot, natural candid framing',
    },
    params: {},
  },
  {
    id: 'outdoor-casual',
    name: 'Outdoor casual',
    emoji: '🌳',
    fields: {
      outfit: 'light sundress with a cardigan, small crossbody bag',
      pose: 'walking, glancing back over her shoulder',
      expression: 'small natural laugh, mouth slightly open',
      setting: 'tree-lined city sidewalk, parked cars and storefronts slightly out of focus',
      lighting: 'late afternoon golden sunlight, natural lens flare',
      camera: 'iPhone 1x main camera photo taken by a friend',
      framing: 'three-quarter body, subject slightly off-center',
    },
    params: {},
  },
  {
    id: 'full-body-casual',
    name: 'Full-body casual',
    emoji: '🧍‍♀️',
    fields: {
      outfit: 'white sneakers, straight-leg jeans, cropped grey sweatshirt',
      pose: 'standing relaxed, weight on one leg, hands in pockets',
      expression: 'friendly smile',
      setting: 'apartment hallway with a wooden floor',
      lighting: 'mixed daylight and warm interior light',
      camera: 'iPhone 0.5x ultra-wide photo, slight perspective stretch',
      framing: 'full body head to toe, feet visible, camera at chest height',
    },
    params: { width: 768, height: 1344 },
  },
  {
    id: 'studio-neutral',
    name: 'Studio neutral',
    emoji: '📷',
    fields: {
      outfit: 'plain black fitted t-shirt',
      pose: 'standing facing the camera, shoulders relaxed',
      expression: 'neutral expression, mouth closed',
      setting: 'plain seamless light-grey studio backdrop',
      lighting: 'soft even studio softbox lighting',
      camera: '85mm portrait lens, reference-sheet style photo',
      framing: 'head and shoulders, centered',
    },
    params: { width: 896, height: 1152 },
  },
];

export function builtinPresets(): Preset[] {
  return BUILTIN_PRESET_SEEDS.map((p) => ({
    ...p,
    fields: { ...EMPTY_FIELDS, ...p.fields },
    builtIn: true,
    workflowId: null,
    updatedAt: new Date(0).toISOString(),
  }));
}
