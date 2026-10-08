// Request-body validation for API routes.
import { z } from 'zod';
import { CONTROL_KEYS, REVIEW_ITEMS } from './types';
import { MIN_CHARACTER_AGE } from './defaults';

const str = (max = 4000) => z.string().max(max);

export const storedImageSchema = z.object({
  id: z.string().max(64),
  file: z.string().regex(/^[a-z0-9_-]+\.(png|jpg|webp)$/i),
  width: z.number().optional(),
  height: z.number().optional(),
  label: z.string().max(200).optional(),
  createdAt: z.string(),
});

export const fieldsSchema = z.object({
  outfit: str(),
  pose: str(),
  bodyPresentation: str(),
  expression: str(),
  setting: str(),
  lighting: str(),
  camera: str(),
  framing: str(),
  realism: str(),
  extra: str(),
});

export const paramsSchema = z.object({
  checkpoint: str(500),
  sampler: str(100),
  scheduler: str(100),
  seed: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER),
  width: z.number().int().min(64).max(4096),
  height: z.number().int().min(64).max(4096),
  steps: z.number().int().min(1).max(200),
  cfg: z.number().min(0).max(30),
  denoise: z.number().min(0).max(1),
  loraName: str(500),
  siennaModel: str(500).default(''),
  loraStrength: z.number().min(-2).max(2),
  loraClipStrength: z.number().min(-2).max(2),
  faceStrength: z.number().min(0).max(3),
  controlStrength: z.number().min(0).max(3),
  controlnetModel: str(500),
  batchSize: z.number().int().min(1).max(8),
  faceRefine: z.boolean().default(true),
  faceRefineDenoise: z.number().min(0.05).max(1).default(0.3),
  faceRefineThreshold: z.number().int().min(64).max(2048).default(384),
  outfitStrength: z.number().min(0).max(1.5).default(0.7),
  outfitMode: z.enum(['design', 'close']).default('design'),
  poseFit: z.enum(['crop', 'pad']).default('pad'),
  poseRetarget: z.number().min(0).max(1).default(0),
  hires: z.boolean().default(false),
  hiresScale: z.number().min(1).max(2).default(1.5),
  hiresDenoise: z.number().min(0.1).max(0.7).default(0.3),
  hiresLoraStrength: z.number().min(0).max(1.5).default(0.7),
  hiresSteps: z.number().int().min(4).max(60).default(20),
  promptCleanup: z.boolean().default(false),
  outfitIsolation: z.enum(['person', 'garment']).default('person'),
});

export const generateSchema = z.object({
  presetId: z.string().max(100).nullable(),
  workflowId: z.string().max(100).nullable(),
  siennaLock: z.boolean(),
  contentMode: z.enum(['sfw', 'adult']),
  fields: fieldsSchema,
  params: paramsSchema,
  images: z.object({
    initImage: storedImageSchema.nullable(),
    poseImage: storedImageSchema.nullable(),
    faceReferenceId: z.string().max(64).nullable(),
    outfitImage: storedImageSchema.nullable().default(null),
    outfitGarmentImage: storedImageSchema.nullable().default(null),
  }),
  parentId: z.string().max(64).optional(),
});

export const characterPatchSchema = z
  .object({
    name: str(80),
    triggerToken: str(200),
    loraFilename: str(500),
    loraWeight: z.number().min(-2).max(2),
    loraClipWeight: z.number().min(-2).max(2),
    age: z.number().int().min(MIN_CHARACTER_AGE, `Age must be at least ${MIN_CHARACTER_AGE}`).max(120),
    faceReference: storedImageSchema.nullable(),
    secondaryReferences: z.array(storedImageSchema).max(20),
    appearanceTraits: str(),
    defaultRealismPrompt: str(),
    defaultNegativePrompt: str(),
    defaultCameraStyle: str(),
    extraLockedTerms: z.array(str(100)).max(100),
    fictionalAttestation: z.boolean(),
  })
  .partial();

export const settingsPatchSchema = z
  .object({
    comfyUrl: z
      .string()
      .max(500)
      .refine((v) => v === '' || v.toLowerCase() === 'mock' || /^https?:\/\/[^\s]+$/i.test(v), 'Must be http(s)://… or "mock"'),
    setupComplete: z.boolean(),
    setupStep: z.number().int().min(0).max(10),
    defaultWorkflowId: z.string().max(100).nullable(),
    defaultParams: paramsSchema.partial(),
    contentMode: z.enum(['sfw', 'adult']),
    siennaLockDefault: z.boolean(),
    generationTimeoutSec: z.number().int().min(60).max(7200),
  })
  .partial();

const nodeRef = z.object({ nodeId: z.string().max(32), inputName: z.string().max(100) });
export const bindingsSchema = z.record(z.enum(CONTROL_KEYS), z.array(nodeRef).max(10));

export const workflowUpdateSchema = z
  .object({
    name: str(120),
    description: str(1000),
    bindings: bindingsSchema,
    outputNodeIds: z.array(z.string().max(32)).max(20),
    allowLoraInjection: z.boolean(),
    optionalModules: z.array(z.enum(['init_image', 'face_reference_image', 'pose_image', 'outfit_reference_image'])).max(4),
    graph: z.record(z.any()),
  })
  .partial();

export const presetSchema = z.object({
  id: z.string().max(100).optional(),
  name: str(80).min(1),
  emoji: str(16),
  fields: fieldsSchema,
  params: paramsSchema.partial(),
  workflowId: z.string().max(100).nullable(),
});

export const recordPatchSchema = z
  .object({
    favorite: z.boolean(),
    notes: str(4000),
    review: z.record(z.enum(REVIEW_ITEMS), z.enum(['ok', 'issue'])),
  })
  .partial();
