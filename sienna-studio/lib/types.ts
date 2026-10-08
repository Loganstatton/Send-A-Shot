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
  /** Outfit-reference conditioning weight (independent of the LoRA strength). */
  outfitStrength?: number;
  /**
   * 'design': copy the garment's look but take pose and background from the prompt.
   * 'close': follow the reference more closely, including its composition.
   */
  outfitMode?: OutfitMode;
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
  warnings: string[];
  /** Optional modules removed for this run (unused or missing nodes). */
  prunedModules?: string[];
  /** Small-face refinement pass: whether it was in the graph and with which settings. */
  faceRefine?: { status: 'on' | 'off' | 'skipped'; denoise?: number; threshold?: number; reason?: string };
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
