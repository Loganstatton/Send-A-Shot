// Shared types used by both the browser UI and the server API routes.

/** An image stored by this app (in DATA_DIR/images). */
export interface StoredImage {
  id: string;
  /** File name inside DATA_DIR/images, e.g. "ref_ab12cd.png". Served at /api/files/<file>. */
  file: string;
  width?: number;
  height?: number;
  label?: string;
  createdAt: string;
}

export type ContentMode = 'sfw' | 'adult';

/** The persistent identity profile for the fictional character. */
export interface CharacterProfile {
  name: string;
  /** Token the LoRA was trained on, e.g. "sienna_v1". Injected first in the prompt. */
  triggerToken: string;
  /** Exact LoRA filename as ComfyUI lists it, e.g. "sienna_v1.safetensors" or "people/sienna_v1.safetensors". */
  loraFilename: string;
  /** Default LoRA model strength (0–2). */
  loraWeight: number;
  /** Default LoRA CLIP strength (0–2). */
  loraClipWeight: number;
  /** Stated age of the fictional character. Must be >= 21 (enforced). */
  age: number;
  faceReference: StoredImage | null;
  secondaryReferences: StoredImage[];
  /** Core fixed appearance traits — face, hair colour, eyes, freckles, build. */
  appearanceTraits: string;
  defaultRealismPrompt: string;
  defaultNegativePrompt: string;
  defaultCameraStyle: string;
  /** Extra words that Sienna Lock should strip from free-text fields. */
  extraLockedTerms: string[];
  /** User confirmed reference images depict this fictional character, not a real person. */
  fictionalAttestation: boolean;
  /** Approved Sienna images that define her body (experimental Edit Outfit body protection). */
  bodyReferences?: import('./body-refs').BodyReference[];
  updatedAt: string;
}

/** The free-text prompt builder fields. */
export interface PromptFields {
  outfit: string;
  pose: string;
  bodyPresentation: string;
  expression: string;
  setting: string;
  lighting: string;
  camera: string;
  framing: string;
  realism: string;
  extra: string;
  /** Things the image should not have, comma separated: sent to the negative prompt only. */
  avoid?: string;
}

export const PROMPT_FIELD_KEYS: (keyof PromptFields)[] = [
  'outfit',
  'pose',
  'bodyPresentation',
  'expression',
  'setting',
  'lighting',
  'camera',
  'framing',
  'realism',
  'extra',
];

export const PROMPT_FIELD_LABELS: Record<keyof PromptFields, string> = {
  outfit: 'Outfit',
  pose: 'Pose',
  bodyPresentation: 'Body presentation',
  expression: 'Expression',
  setting: 'Setting / background',
  lighting: 'Lighting',
  camera: 'Camera type',
  framing: 'Framing',
  realism: 'Realism details',
  extra: 'Anything else',
  avoid: 'Avoid',
};

/** Numeric/enum generation parameters. */
export interface GenerationParams {
  checkpoint: string;
  sampler: string;
  scheduler: string;
  /** -1 = random */
  seed: number;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  /** 1.0 for txt2img; lower for img2img. */
  denoise: number;
  /** LoRA filename used when Sienna Lock is OFF (when ON, the profile's LoRA or the siennaModel A/B choice is used). */
  loraName: string;
  /**
   * Sienna Lock A/B: an approved Sienna LoRA (see SIENNA_MODELS) to use instead
   * of the profile's for this generation. Empty = the profile's LoRA.
   */
  siennaModel?: string;
  loraStrength: number;
  loraClipStrength: number;
  /** IPAdapter / face-reference weight. */
  faceStrength: number;
  /** ControlNet / pose strength. */
  controlStrength: number;
  controlnetModel: string;
  batchSize: number;
  /**
   * Second pass that redraws small faces (full-body, mirror shots) with the
   * same model, LoRA and prompts. Faces already larger than the threshold are
   * left untouched. No reference image is used.
   */
  faceRefine: boolean;
  /** Denoise for the face redraw — low values keep pose, expression and lighting. */
  faceRefineDenoise: number;
  /** Faces smaller than this (px, shorter bbox side) are enlarged to it and redrawn. */
  faceRefineThreshold: number;
  /** With style packs: the face redraw uses Sienna's LoRA alone, so outfit packs don't pull her face away (off by default). */
  faceKeepsSiennaLora?: boolean;
  /** The face reference shapes only the face redraw (with Sienna's LoRA alone); body, outfit and scene come from the main pass (off by default). */
  faceRefFacePassOnly?: boolean;
  /** Hand touch-up: finds hands after the face pass and redraws them in more detail (needs the face pass). */
  handRefine?: boolean;
  /** Face check: redo photos whose face doesn't look enough like Sienna (Sienna Lock only). */
  faceCheck?: boolean;
  /** Pose preset id (lib/pose-presets.ts): its skeleton drives the pose ControlNet when no pose photo is set. */
  posePreset?: string | null;
  /** Outfit-reference conditioning weight (independent of the LoRA strength). */
  outfitStrength?: number;
  /**
   * 'design': copy the garment's look but take pose and background from the prompt.
   * 'close': follow the reference more closely, including its composition.
   */
  outfitMode?: OutfitMode;

  // ── Phase 1 quality options (experimental; defaults reproduce the previous behaviour) ──
  /**
   * How a pose photo whose shape differs from the output is fitted. 'crop' (previous):
   * ComfyUI centre-crops the pose map, cutting off the head/feet. 'pad': the photo is padded
   * to the output's aspect ratio first, so the whole skeleton is kept.
   */
  poseFit?: 'crop' | 'pad';
  /** Rescale the pose skeleton's bones toward Sienna's proportions (0 = off, 1 = full). Angles are kept. */
  poseRetarget?: number;
  /** Optional high-resolution refinement pass (upscale + low-denoise re-render). */
  hires?: boolean;
  hiresScale?: number;
  hiresDenoise?: number;
  /** LoRA strength in the refinement pass (lower lets the base model's photographic texture through). */
  hiresLoraStrength?: number;
  hiresSteps?: number;
  /** Experimental negative-prompt cleanup (see buildPrompt). */
  promptCleanup?: boolean;
  /**
   * What the clothing adapter sees. 'person' (previous): whole person minus the face box.
   * 'garment': the garment-only crop from outfit analysis (skin replaced by a flat silhouette).
   */
  outfitIsolation?: 'person' | 'garment';
  /** Style pack strengths by pack id (see lib/style-packs.ts); 0 or missing = off. */
  stylePacks?: Record<string, number>;
}

export type OutfitMode = 'design' | 'close';

/** Optional images supplied per generation. */
export interface GenerationImages {
  /** Image for img2img. */
  initImage: StoredImage | null;
  /** Pose / ControlNet guide image. */
  poseImage: StoredImage | null;
  /** Face reference override when Sienna Lock is OFF (or to use a secondary reference). */
  faceReferenceId: string | null;
  /** Photo of an outfit to put on Sienna (face, hair and background are masked out first). */
  outfitImage?: StoredImage | null;
  /** Garment-only crop produced by outfit analysis (used when params.outfitIsolation = 'garment'). */
  outfitGarmentImage?: StoredImage | null;
}

export interface Preset {
  id: string;
  name: string;
  emoji: string;
  builtIn: boolean;
  fields: PromptFields;
  /** Partial overrides applied on top of the global default params. */
  params: Partial<GenerationParams>;
  /** Workflow to use with this preset. Falls back to the default workflow. */
  workflowId: string | null;
  updatedAt: string;
}

// ── Workflow mapping ─────────────────────────────────────────

/**
 * Every UI control that can be wired into a ComfyUI workflow.
 * A workflow "binding" says: write this control's value into
 * input <inputName> of node <nodeId>.
 */
export const CONTROL_KEYS = [
  'positive_prompt',
  'negative_prompt',
  'checkpoint',
  'lora_name',
  'lora_strength',
  'lora_clip_strength',
  'seed',
  'width',
  'height',
  'batch_size',
  'steps',
  'cfg',
  'guidance',
  'sampler',
  'scheduler',
  'denoise',
  'init_image',
  'face_reference_image',
  'face_strength',
  'pose_image',
  'control_strength',
  'controlnet_model',
  'outfit_reference_image',
  'outfit_strength',
  'outfit_weight_type',
  'pose_pad_left',
  'pose_pad_top',
  'pose_pad_right',
  'pose_pad_bottom',
  'pose_retarget_strength',
  'pose_proportions',
  'hires_scale',
  'hires_denoise',
  'hires_lora_strength',
  'hires_steps',
  'face_refine_denoise',
  'face_refine_threshold',
  'filename_prefix',
] as const;

export type ControlKey = (typeof CONTROL_KEYS)[number];

export interface NodeInputRef {
  nodeId: string;
  inputName: string;
}

export type WorkflowBindings = Partial<Record<ControlKey, NodeInputRef[]>>;

/** ComfyUI "API format" workflow: { "<nodeId>": { class_type, inputs, _meta? } } */
export type ComfyGraph = Record<string, ComfyNode>;

export interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  graph: ComfyGraph;
  bindings: WorkflowBindings;
  /** Restrict which output nodes' images are collected. Empty = all SaveImage-type outputs. */
  outputNodeIds: string[];
  /** If the workflow has no LoRA loader, Sienna Lock may splice one in automatically. */
  allowLoraInjection: boolean;
  /**
   * Image modules that are removed from the graph when not used for a generation
   * (or when the server lacks their nodes). See lib/comfy/modules.ts.
   * Modules NOT listed here are required: generation fails without their image.
   */
  optionalModules: ('init_image' | 'face_reference_image' | 'pose_image' | 'outfit_reference_image')[];
  /** Base model family — informs defaults and diagnostics. */
  family?: 'sdxl' | 'flux' | 'other';
  builtIn: boolean;
  updatedAt: string;
}

// ── Generation history ───────────────────────────────────────

export type GenerationStatus = 'queued' | 'running' | 'done' | 'error';

export const REVIEW_ITEMS = [
  'face_drift',
  'eye_mismatch',
  'freckles_changed',
  'hairline_changed',
  'hands',
  'teeth',
  'jewelry',
  'warped_background',
  'reflections',
  'duplicated_objects',
  'anatomy',
] as const;

export type ReviewItem = (typeof REVIEW_ITEMS)[number];
export type ReviewMark = 'ok' | 'issue';

export interface GenerationRecord {
  id: string;
  createdAt: string;
  completedAt?: string;
  status: GenerationStatus;
  error?: string;
  backend: 'comfyui' | 'mock';
  promptId?: string;
  clientId?: string;
  queuePosition?: number;

  presetId: string | null;
  presetName: string | null;
  workflowId: string;
  workflowName: string;
  siennaLock: boolean;
  contentMode: ContentMode;
  fields: PromptFields;
  params: GenerationParams;
  /** The seed actually used (resolved from -1). */
  seed: number;
  positivePrompt: string;
  negativePrompt: string;
  /** LoRA actually applied (or null). */
  lora: { name: string; strength: number; clipStrength: number; injected: boolean } | null;
  faceReference: StoredImage | null;
  initImage: StoredImage | null;
  poseImage: StoredImage | null;
  /** Outfit reference used for this run, with the conditioning that was applied. */
  outfitReference?: { image: StoredImage; strength: number; mode: OutfitMode } | null;
  /** Style packs that were applied, after availability checks. */
  stylePacks?: { id: string; label: string; file: string; strength: number }[];
  warnings: string[];
  /** Optional modules removed for this run (unused or missing nodes). */
  prunedModules?: string[];
  /** Small-face refinement pass: whether it was in the graph and with which settings. */
  faceRefine?: { status: 'on' | 'off' | 'skipped'; denoise?: number; threshold?: number; reason?: string; siennaLoraOnly?: boolean; faceReferenceOnly?: boolean };
  handRefine?: { status: 'on' | 'off' | 'skipped'; reason?: string };
  /** Photo checks: each photo is checked (top check when the outfit has a top, face check with Sienna Lock) and
   * redone with a new seed when one fails. Named for the first check it had. */
  exposureGuard?: {
    status: 'on' | 'unavailable';
    reason?: string;
    /** Which checks are running. Missing = top check only (records from before the face check). */
    checks?: { top: boolean; face: boolean };
    maxAttempts: number;
    attempts: {
      seed: number;
      exposed: boolean;
      score: number;
      similarity?: number | null;
      faceOk?: boolean;
      identity?: 'verified' | 'mismatch' | 'inconclusive' | 'unchecked';
      identityReason?: string;
      framingOk?: boolean;
      images: { filename: string; subfolder: string; type: string; nodeId: string }[];
    }[];
  };
  /** Set on every record made by this release or later (1 = every finished photo records an identityCheck). A
   * finished photo without it is a legacy photo from before face verification, never treated as verified. */
  identityPolicy?: 1;
  /** Edit Outfit only: whether the face check was added to the edit's graph, or why not. */
  editFaceCheck?: { status: 'on' } | { status: 'unavailable'; reason: string };
  /** Face check of the photo that was kept. Only 'verified' means the face was confirmed as Sienna's; the gallery
   * flags anything else so the user can decide whether to keep the image. */
  identityCheck?: {
    /** verified: matched Sienna. unconfirmed: no attempt matched. unchecked: face not detected / too small.
     * unavailable: the face check could not run. inconclusive: experimental pose-aware rule only.
     * not_applicable: Sienna Lock off (not meant to be Sienna). */
    status: 'verified' | 'inconclusive' | 'unconfirmed' | 'unchecked' | 'unavailable' | 'not_applicable';
    similarity: number | null;
    reason?: string;
  };
  /** The exact API-format graph sent to ComfyUI (for debugging). */
  submittedGraph?: ComfyGraph;
  /** Structured ComfyUI error details (node_errors / execution_error). */
  errorDetails?: unknown;

  images: StoredImage[];
  favorite: boolean;
  review: Partial<Record<ReviewItem, ReviewMark>>;
  notes: string;
  /** If this was a regenerate/edit of another record. */
  parentId?: string;
  /** Set when this image was made by Edit Outfit (Qwen-Image-Edit) from another record's image. */
  outfitEdit?: OutfitEditInfo;
  /** Set for Video Studio results: `images` holds the poster frame, the video is `video.result`. */
  video?: VideoInfo;
}

/** A video file inside DATA_DIR/images (H.264 MP4, served with byte ranges at /api/files/<file>). */
export interface StoredVideo {
  id: string;
  file: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
  seconds: number;
  bytes: number;
  createdAt: string;
}

/** How a Video Studio result was made. The source photo's record is never modified. */
export interface VideoInfo {
  mode: import('./video').VideoMode;
  model: 'wan2.2-i2v-14b' | 'wan2.2-animate-14b' | 'wan2.2-animate-2-14b';
  sourceId: string;
  sourceImage: StoredImage;
  quality: import('./video').VideoQuality;
  resolution: import('./video').VideoResolution;
  width: number;
  height: number;
  frames: number;
  seconds: number;
  /** Animate Image: what she does and how the camera moves. */
  motion?: string;
  camera?: import('./video').CameraMove;
  /** Copy Motion: the driving video (normalised to 16 fps) and the part of it that was copied. */
  drive?: { video: StoredVideo; poster: StoredImage; start: number; seconds: number };
  scene?: string;
  /** Copy Motion: 'away' = rear-view prompt (back to the camera for the whole clip). */
  facing?: import('./video').Facing;
  chunks?: number;
  estimateMinutes: number;
  /** Whether the frame face check was in the graph, or why not. */
  faceCheck: { status: 'on' } | { status: 'unavailable'; reason: string };
  frameFaces?: import('./video').FrameFace[];
  result?: StoredVideo | null;
  /** Safe framing: room added around her for the movement (filled from the photo's edges; her pixels unchanged). */
  safeFraming?: { movement: import('./video-framing').MovementKind; status: 'on'; report?: SafeFrameReport | null; framedImage?: StoredImage | null };
  /**
   * Lock Camera was requested: 'on' while running, then the node's verdict. `result` is the stabilized copy (only when
   * applied); the natural video stays in `video.result` either way.
   */
  lockCamera?: { status: 'on' | import('./video').LockCameraStatus; reason?: string; report?: import('./video').LockCameraReport | null; result?: StoredVideo | null };
  /**
   * Made on the on-demand video GPU (VIDEO_GPU=runpod): the record waits ('starting') until the GPU is ready, is then
   * submitted, and gets its GPU cost when it finishes.
   */
  gpu?: {
    phase: 'starting' | 'submitted' | 'failed';
    requestedAt: string;
    /** What the GPU is doing while the video waits (booting, downloading models…). */
    waitingFor?: string;
    url?: string;
    submittedAt?: string;
    /** usd = gpuSeconds at `rate` + startupUsd (only for the video that started the GPU). */
    cost?: { usd: number; gpuSeconds: number; startupUsd: number; rate: number; gpu: string };
  };
  /** The request, kept until the video is submitted to the on-demand GPU (internal). */
  request?: Record<string, unknown>;
}

/** What SiennaSafeFrame measured and added (pixels of the source photo). */
export interface SafeFrameReport {
  available: boolean;
  error?: string;
  plan: { top: number; bottom: number; left: number; right: number; capped: boolean; changed: boolean } | null;
  source: [number, number] | null;
  padded: [number, number] | null;
}

/** How an Edit Outfit result was made. The source record and its image are never modified. */
export interface OutfitEditInfo {
  model: 'qwen-image-edit-2509';
  sourceId: string;
  /** The image that was edited (belongs to the source record). */
  sourceImage: StoredImage;
  /** Clothing photo as uploaded (or as cropped by hand in the editor). */
  reference: StoredImage;
  manualCrop: boolean;
  /** The clothing photo exactly as the editor saw it (after the automatic below-the-chin crop). */
  referenceCrop?: StoredImage | null;
  crop?: { mode: 'cropped' | 'no-face' | 'face-too-low'; cut: number } | null;
  scope: import('./outfit-edit').OutfitEditScope;
  footwear: import('./outfit-edit').OutfitEditFootwear;
  face: import('./outfit-edit').OutfitEditFace;
  description: string;
  /** What she wore in the source image (named in the prompt so it gets removed). */
  originalOutfit: string;
  /** Experimental body protection used for this edit (absent = none). */
  protect?: import('./outfit-edit').BodyProtect;
  /** Body references given to the editor / checker (ids of the approved images). */
  bodyRefIds?: string[];
  /** Clothing-only isolation result ('garment-only', or 'fallback-chin-crop' with the reason). */
  isolation?: { mode: string; reason?: string } | null;
  bodyCheck?: import('./outfit-edit').BodyCheckReport | null;
  /** Things to keep out of the result (the Avoid box); sent to the editor's negative prompt. */
  avoid?: string;
  /** Garment-only redraw: only the clothing region was changed. */
  redraw?: { grow: import('./outfit-edit').RedrawGrow; info?: import('./outfit-edit').RedrawInfo | null; preview?: StoredImage | null };
}

export interface AppSettings {
  /** Overrides COMFYUI_URL env when non-empty. */
  comfyUrl: string;
  setupComplete: boolean;
  setupStep: number;
  defaultWorkflowId: string | null;
  defaultParams: GenerationParams;
  contentMode: ContentMode;
  siennaLockDefault: boolean;
  /** Seconds after which a generation that never shows up in ComfyUI history is marked failed. */
  generationTimeoutSec: number;
  updatedAt: string;
}

/** Request body for POST /api/generate */
export interface GenerateRequest {
  presetId: string | null;
  workflowId: string | null;
  siennaLock: boolean;
  contentMode: ContentMode;
  fields: PromptFields;
  params: GenerationParams;
  images: GenerationImages;
  parentId?: string;
}

/** Full settings export. */
export interface ExportBundle {
  app: 'sienna-studio';
  version: 1;
  exportedAt: string;
  settings: AppSettings;
  character: CharacterProfile;
  workflows: WorkflowTemplate[];
  presets: Preset[];
  /** file name → base64 bytes for reference images */
  files: Record<string, string>;
}
