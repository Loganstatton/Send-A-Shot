/**
 * Connection & workflow diagnostics against the live ComfyUI server.
 * Everything here is read-only except nothing: diagnostics never queue a job.
 */

import 'server-only';
import { comboOptions, ComfyBackend, createBackend, isMockUrl, NodeInfo } from '../comfy/client';
import { bypassNodeIds, MODULE_KEYS, MODULE_LABELS, moduleNodeIds } from '../comfy/modules';
import { CONTROLNET_CLASSES, IDENTITY_CLASSES, packageFor } from '../comfy/packages';
import { builtinPresets, DEFAULT_PARAMS, EMPTY_FIELDS } from '../defaults';
import type { ComfyGraph, GenerateRequest, WorkflowTemplate } from '../types';
import { prepareGeneration } from './generate';
import { getCharacter, getComfyUrl, getSettings, getWorkflow } from './store';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  items?: string[];
  fix?: string;
}

/** A file/enum input in the workflow template whose default can be changed in diagnostics. */
export interface ModelInput {
  nodeId: string;
  nodeTitle: string;
  classType: string;
  inputName: string;
  value: string;
  options: string[];
  valid: boolean;
  module: string | null;
}

export interface DiagnosticsReport {
  url: string;
  mock: boolean;
  workflowId: string;
  workflowName: string;
  checks: Check[];
  modelInputs: ModelInput[];
  dryRun: { warnings: string[]; prunedModules: string[]; problems: string[]; nodeCount: number } | null;
  ranAt: string;
}

export const FIRST_TEST_SEED = 424242;

const MODEL_FILE_RE = /\.(safetensors|ckpt|pt|pth|bin|gguf|sft|onnx)$/i;

/** The fixed "first real generation" request: Studio Neutral, Sienna Lock, LoRA 1.0, fixed seed, no pose, SFW. */
export async function firstTestRequest(workflowId: string | null): Promise<GenerateRequest> {
  const settings = await getSettings();
  const preset = builtinPresets().find((p) => p.id === 'studio-neutral')!;
  return {
    presetId: preset.id,
    workflowId: workflowId || settings.defaultWorkflowId,
    siennaLock: true,
    contentMode: 'sfw',
    fields: { ...EMPTY_FIELDS, ...preset.fields },
    params: {
      ...DEFAULT_PARAMS,
      ...settings.defaultParams,
      ...preset.params,
      checkpoint: '', // use the workflow's base-model default (set on the Diagnostics screen)
      loraName: '',
      loraStrength: 1,
      loraClipStrength: 1,
      seed: FIRST_TEST_SEED,
      batchSize: 1,
      denoise: 1,
    },
    images: { initImage: null, poseImage: null, faceReferenceId: null },
  };
}

async function safeInfo(backend: ComfyBackend, cls: string): Promise<NodeInfo | null | 'error'> {
  try {
    return await backend.nodeInfo(cls);
  } catch {
    return 'error';
  }
}

function specFor(info: NodeInfo, input: string): unknown {
  return info.input?.required?.[input] ?? info.input?.optional?.[input];
}

/** Validate an API graph against the server's node definitions. */
export async function validateGraph(backend: ComfyBackend, graph: ComfyGraph): Promise<string[]> {
  const problems: string[] = [];
  const classes = [...new Set(Object.values(graph).map((n) => n.class_type))];
  const infos = new Map<string, NodeInfo | null | 'error'>();
  await Promise.all(classes.map(async (c) => infos.set(c, await safeInfo(backend, c))));
  for (const [id, node] of Object.entries(graph)) {
    const info = infos.get(node.class_type);
    const title = node._meta?.title ? ` “${node._meta.title}”` : '';
    if (info === 'error') continue;
    if (!info) {
      const pkg = packageFor(node.class_type);
      problems.push(`Node ${id}${title}: class ${node.class_type} is not installed${pkg ? ` — install ${pkg.name}` : ''}.`);
      continue;
    }
    for (const req of Object.keys(info.input?.required ?? {})) {
      if (!(req in node.inputs)) problems.push(`Node ${id}${title}: required input “${req}” is missing.`);
    }
    for (const [k, v] of Object.entries(node.inputs)) {
      if (typeof v !== 'string') continue;
      if (node.class_type === 'LoadImage' && k === 'image') continue; // uploaded at run time
      const opts = comboOptions(specFor(info, k));
      if (opts.length && !opts.includes(v)) {
        problems.push(`Node ${id}${title}: ${k} = “${v}” is not on the server (${opts.length} option${opts.length === 1 ? '' : 's'} available).`);
      }
    }
  }
  return problems;
}

/** Enum inputs in the template (model files etc.) with the server's options. */
async function collectModelInputs(backend: ComfyBackend, wf: WorkflowTemplate): Promise<ModelInput[]> {
  const runtimeBound = new Set(
    (['lora_name', 'sampler', 'scheduler'] as const).flatMap((k) => (wf.bindings[k] ?? []).map((r) => `${r.nodeId}.${r.inputName}`)),
  );
  const moduleOf = new Map<string, string>();
  for (const key of MODULE_KEYS) for (const id of moduleNodeIds(wf.graph, wf.bindings, key)) moduleOf.set(id, MODULE_LABELS[key]);

  const out: ModelInput[] = [];
  for (const [id, node] of Object.entries(wf.graph)) {
    const info = await safeInfo(backend, node.class_type);
    if (!info || info === 'error') continue;
    for (const [k, v] of Object.entries(node.inputs)) {
      if (typeof v !== 'string' || runtimeBound.has(`${id}.${k}`)) continue;
      if (node.class_type === 'LoadImage') continue;
      const options = comboOptions(specFor(info, k));
      // Only model files (checkpoints, VAEs, encoders, ControlNets, PuLID…), not plain enums.
      if (!options.length || ![v, ...options].some((o) => MODEL_FILE_RE.test(o))) continue;
      out.push({
        nodeId: id,
        nodeTitle: node._meta?.title ?? node.class_type,
        classType: node.class_type,
        inputName: k,
        value: v,
        options,
        valid: options.includes(v),
        module: moduleOf.get(id) ?? null,
      });
    }
  }
  return out;
}

export async function runDiagnostics(workflowId: string | null): Promise<DiagnosticsReport> {
  const [settings, character, url] = await Promise.all([getSettings(), getCharacter(), getComfyUrl()]);
  const mock = isMockUrl(url);
  const backend = createBackend(url);
  const wfId = workflowId || settings.defaultWorkflowId || '';
  const wf = wfId ? await getWorkflow(wfId) : null;
  const checks: Check[] = [];
  const report: DiagnosticsReport = {
    url,
    mock,
    workflowId: wf?.id ?? wfId,
    workflowName: wf?.name ?? '(none)',
    checks,
    modelInputs: [],
    dryRun: null,
    ranAt: new Date().toISOString(),
  };

  if (mock) {
    checks.push({
      id: 'mock',
      label: 'Backend mode',
      status: 'warn',
      detail: 'MOCK MODE — no real server is contacted. Results below are simulated; set a real ComfyUI URL in Settings.',
    });
  }

  // 1. Reachable
  let gpuDevices: { name: string; type: string; vramTotal?: number }[] = [];
  try {
    const started = Date.now();
    const info = await backend.systemInfo();
    gpuDevices = info.devices;
    checks.push({
      id: 'reachable',
      label: 'Server reachable',
      status: 'pass',
      detail: `${mock ? 'Mock backend' : `ComfyUI ${info.comfyuiVersion ?? '(version unknown)'}`} answered in ${Date.now() - started} ms.`,
    });
  } catch (e: any) {
    checks.push({
      id: 'reachable',
      label: 'Server reachable',
      status: 'fail',
      detail: e.message,
      fix: 'Check the URL in Settings, that ComfyUI is running, that its port is exposed to the app server, and any auth headers (COMFYUI_API_KEY / COMFYUI_EXTRA_HEADERS).',
    });
    for (const label of ['GPU detected', 'Checkpoints', 'LoRAs', 'Sienna LoRA', 'Custom nodes', 'Identity nodes', 'ControlNet', 'Workflow executable']) {
      checks.push({ id: label, label, status: 'skip', detail: 'Server not reachable.' });
    }
    return report;
  }

  // 2. GPU
  const gpus = gpuDevices.filter((d) => d.type && d.type !== 'cpu');
  checks.push(
    gpus.length
      ? {
          id: 'gpu',
          label: 'GPU detected',
          status: mock ? 'warn' : 'pass',
          detail: gpus.map((d) => `${d.name}${d.vramTotal ? ` · ${(d.vramTotal / 1024 ** 3).toFixed(1)} GB VRAM` : ''}`).join('; '),
        }
      : {
          id: 'gpu',
          label: 'GPU detected',
          status: 'fail',
          detail: gpuDevices.length ? `Only CPU devices reported (${gpuDevices.map((d) => d.name).join(', ')}).` : 'No devices reported.',
          fix: 'Run ComfyUI on a machine with an NVIDIA (CUDA), AMD (ROCm) or Apple (MPS) GPU and the matching PyTorch build.',
        },
  );

  const choices = async (cls: string, input: string) => {
    try {
      return await backend.inputChoices(cls, input);
    } catch {
      return [];
    }
  };

  // 3. Checkpoints (SDXL) / diffusion models (Flux)
  const [ckpts, unets, loras] = await Promise.all([
    choices('CheckpointLoaderSimple', 'ckpt_name'),
    choices('UNETLoader', 'unet_name'),
    choices('LoraLoader', 'lora_name'),
  ]);
  const flux = wf?.family === 'flux';
  const baseList = flux ? unets : ckpts;
  checks.push({
    id: 'checkpoints',
    label: flux ? 'Base models (models/diffusion_models)' : 'Checkpoints (models/checkpoints)',
    status: baseList.length ? 'pass' : 'fail',
    detail: `${ckpts.length} checkpoint(s), ${unets.length} diffusion model(s) found.`,
    items: baseList,
    fix: baseList.length
      ? undefined
      : flux
        ? 'Put flux1-dev (or an fp8 variant) in ComfyUI/models/diffusion_models/ (older installs: models/unet/).'
        : 'Put an SDXL checkpoint (.safetensors) in ComfyUI/models/checkpoints/.',
  });

  // 4. LoRAs
  checks.push({
    id: 'loras',
    label: 'LoRAs (models/loras)',
    status: loras.length ? 'pass' : 'warn',
    detail: `${loras.length} LoRA file(s) found.`,
    items: loras,
  });

  // 5. Sienna LoRA
  const want = character.loraFilename.trim();
  if (!want) {
    checks.push({
      id: 'sienna-lora',
      label: 'Sienna LoRA',
      status: 'warn',
      detail: 'No LoRA filename set in the Sienna profile yet.',
      fix: 'Copy sienna_v2.safetensors to ComfyUI/models/loras/ and select it on the Sienna tab.',
    });
  } else if (loras.includes(want)) {
    checks.push({ id: 'sienna-lora', label: 'Sienna LoRA', status: 'pass', detail: `“${want}” is installed.` });
  } else {
    const near = loras.filter((l) => l.toLowerCase().includes('sienna') || l.toLowerCase().endsWith(want.toLowerCase().split('/').pop()!));
    checks.push({
      id: 'sienna-lora',
      label: 'Sienna LoRA',
      status: 'fail',
      detail: `“${want}” was not found on the server.${near.length ? ` Similar: ${near.join(', ')}` : ''}`,
      items: near,
      fix: 'Copy the file to ComfyUI/models/loras/ (names are case-sensitive; subfolders appear as “folder/name.safetensors”), then re-run diagnostics.',
    });
  }

  if (!wf) {
    checks.push({ id: 'workflow', label: 'Workflow', status: 'fail', detail: `Workflow ${wfId || '(none)'} not found.` });
    return report;
  }

  // 6. Custom nodes used by the workflow, split into core vs optional modules
  const allClasses = [...new Set(Object.values(wf.graph).map((n) => n.class_type))];
  const missing: string[] = [];
  await Promise.all(
    allClasses.map(async (c) => {
      const i = await safeInfo(backend, c);
      if (i === null) missing.push(c);
    }),
  );
  const moduleClass = new Map<string, string>();
  for (const key of MODULE_KEYS) {
    for (const id of moduleNodeIds(wf.graph, wf.bindings, key)) moduleClass.set(wf.graph[id].class_type, key);
  }
  const refineId = wf.bindings.face_refine_denoise?.[0]?.nodeId;
  const refineIds = refineId && wf.graph[refineId] ? [...new Set([refineId, ...bypassNodeIds(wf.graph, refineId)])] : [];
  for (const id of refineIds) moduleClass.set(wf.graph[id].class_type, 'face_refine');
  const coreMissing = missing.filter((c) => !moduleClass.has(c));
  const items: string[] = [];
  for (const key of ['core', ...MODULE_KEYS, 'face_refine'] as const) {
    const label = key === 'core' ? 'Core (base model + LoRA + sampler)' : key === 'face_refine' ? 'Face refinement' : MODULE_LABELS[key];
    const miss = key === 'core' ? coreMissing : missing.filter((c) => moduleClass.get(c) === key);
    const hasModule = key === 'core' || (key === 'face_refine' ? refineIds.length > 0 : (wf.bindings[key]?.length ?? 0) > 0);
    if (!hasModule) continue;
    items.push(
      miss.length
        ? `✗ ${label}: missing ${miss.map((c) => `${c}${packageFor(c) ? ` (${packageFor(c)!.name})` : ''}`).join(', ')}`
        : `✓ ${label}: all nodes installed`,
    );
  }
  checks.push({
    id: 'custom-nodes',
    label: 'Custom nodes for this workflow',
    status: coreMissing.length ? 'fail' : missing.length ? 'warn' : 'pass',
    detail: coreMissing.length
      ? 'Core nodes are missing — this workflow cannot run.'
      : missing.length
        ? 'Optional modules with missing nodes will be skipped automatically.'
        : `All ${allClasses.length} node types are installed.`,
    items,
    fix: missing.length
      ? [...new Set(missing.map((c) => packageFor(c)).filter(Boolean).map((p) => `${p!.name}: ${p!.repo}`))].join('  ·  ') || undefined
      : undefined,
  });

  // 7. Identity nodes (IPAdapter / FaceID / PuLID / InstantID) + their model folders
  const installed = async (list: string[]) => {
    const flags = await Promise.all(list.map(async (c) => ({ c, i: await safeInfo(backend, c) })));
    return flags.filter((f) => f.i && f.i !== 'error').map((f) => f.c);
  };
  const idPresent = await installed(IDENTITY_CLASSES);
  const [ipaFiles, clipVision, pulidFiles] = await Promise.all([
    choices('IPAdapterModelLoader', 'ipadapter_file'),
    choices('CLIPVisionLoader', 'clip_name'),
    choices('PulidFluxModelLoader', 'pulid_file'),
  ]);
  const needIdentity = flux ? ['ApplyPulidFlux'] : ['IPAdapterUnifiedLoaderFaceID', 'IPAdapterFaceID'];
  const identityOk = needIdentity.every((c) => idPresent.includes(c));
  checks.push({
    id: 'identity',
    label: 'Identity nodes (IPAdapter / FaceID / PuLID)',
    status: identityOk ? 'pass' : 'warn',
    detail: `${idPresent.length ? `Available: ${idPresent.sort().join(', ')}.` : 'No identity-conditioning nodes installed.'} ${
      flux ? `PuLID files: ${pulidFiles.length}.` : `IPAdapter files: ${ipaFiles.length}, CLIP-Vision files: ${clipVision.length}.`
    }`,
    items: flux ? pulidFiles : [...ipaFiles, ...clipVision],
    fix: identityOk
      ? undefined
      : `Optional. Without it the face reference is skipped and identity relies on the LoRA. Install ${packageFor(needIdentity[0])?.name}: ${packageFor(needIdentity[0])?.notes}`,
  });

  // 8. ControlNet
  const cnPresent = await installed(CONTROLNET_CLASSES);
  const cnModels = await choices('ControlNetLoader', 'control_net_name');
  checks.push({
    id: 'controlnet',
    label: 'ControlNet / pose',
    status: cnPresent.includes('ControlNetApplyAdvanced') && cnModels.length ? 'pass' : 'warn',
    detail: `Nodes: ${cnPresent.sort().join(', ') || 'none'}. ControlNet models: ${cnModels.length}.${
      cnPresent.includes('DWPreprocessor') ? '' : ' (No pose preprocessor — supply ready-made OpenPose skeleton images.)'
    }`,
    items: cnModels,
    fix: cnModels.length ? undefined : 'Optional. Put a pose ControlNet in ComfyUI/models/controlnet/ to use pose images.',
  });

  // 8b. Face refinement (FaceDetailer + face detector model)
  if (refineIds.length) {
    const settings = await getSettings();
    const enabled = settings.defaultParams.faceRefine;
    const missingNodes = [...new Set(refineIds.map((id) => wf.graph[id].class_type))].filter((c) => missing.includes(c));
    const detectorIds = refineIds.filter((id) => typeof wf.graph[id].inputs.model_name === 'string');
    const missingModels: string[] = [];
    for (const id of detectorIds) {
      const file = wf.graph[id].inputs.model_name as string;
      const list = await choices(wf.graph[id].class_type, 'model_name');
      if (!missingNodes.includes(wf.graph[id].class_type) && !list.includes(file)) missingModels.push(file);
    }
    const ready = !missingNodes.length && !missingModels.length;
    const problems = [
      ...missingNodes.map((c) => `missing node ${c}${packageFor(c) ? ` (${packageFor(c)!.name})` : ''}`),
      ...missingModels.map((f) => `missing model models/ultralytics/${f}`),
    ];
    checks.push({
      id: 'face-refine',
      label: 'Face refinement (small faces)',
      status: ready ? 'pass' : enabled ? 'warn' : 'skip',
      detail: ready
        ? `Ready — FaceDetailer and ${detectorIds.map((id) => wf.graph[id].inputs.model_name).join(', ')} are installed. ${enabled ? 'On by default' : 'Off by default'} (denoise ${settings.defaultParams.faceRefineDenoise}, faces under ${settings.defaultParams.faceRefineThreshold}px).`
        : `Not ready: ${problems.join('; ')}. ${enabled ? 'Generations will skip the refinement pass (with a warning) until this is fixed.' : 'It is switched off by default.'}`,
      items: problems,
      fix: ready
        ? undefined
        : 'On the GPU machine run scripts/comfyui-bootstrap.sh --restart from the Sienna Studio repo (see docs/COMFYUI_SETUP.md, “After a fresh Pod start”), then re-run Diagnostics.',
    });
  }

  // 9. Model-file defaults in the template
  report.modelInputs = await collectModelInputs(backend, wf);

  // 10. Executable: dry-run the first-test request and validate the resulting graph
  try {
    const prep = await prepareGeneration(await firstTestRequest(wf.id), { dryRun: true });
    const problems = await validateGraph(backend, prep.graph);
    report.dryRun = {
      warnings: prep.record.warnings,
      prunedModules: prep.record.prunedModules ?? [],
      problems,
      nodeCount: Object.keys(prep.graph).length,
    };
    checks.push({
      id: 'executable',
      label: 'Selected workflow executable',
      status: problems.length ? 'fail' : 'pass',
      detail: problems.length
        ? `${problems.length} problem(s) in the graph the first test would send.`
        : `The first-test graph (${Object.keys(prep.graph).length} nodes) validates against the server.`,
      items: problems,
      fix: problems.length ? 'Fix model-file defaults below, install missing nodes, or adjust the mapping in Library → Workflows.' : undefined,
    });
  } catch (e: any) {
    report.dryRun = { warnings: [], prunedModules: [], problems: [e.message], nodeCount: 0 };
    checks.push({ id: 'executable', label: 'Selected workflow executable', status: 'fail', detail: e.message });
  }

  return report;
}
