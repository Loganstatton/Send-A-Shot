// A tiny stand-in for a ComfyUI server, speaking the same HTTP API the app
// uses (/system_stats, /object_info/{cls}, /upload/image, /prompt, /queue,
// /history/{id}, /view). For exercising the real HTTP client + diagnostics
// without a GPU. NOT used in production.
//
//   node scripts/fake-comfyui.mjs [--port 8188] [--no-ipadapter] [--no-face-refine] [--no-lora] [--fail-exec] [--qwen-edit]
import http from 'node:http';
import { deflateSync } from 'node:zlib';

const arg = (n) => process.argv.includes(n);
const PORT = Number(process.argv[process.argv.indexOf('--port') + 1]) || 8188;

const MODELS = {
  ckpt_name: ['realvisxlV50.safetensors', 'sd_xl_base_1.0.safetensors', 'RealVisXL_V5.0_fp16.safetensors'],
  unet_name: ['flux1-dev-fp8.safetensors'],
  lora_name: arg('--no-lora') ? ['other_style.safetensors'] : ['sienna_v1.safetensors', 'sienna_v2.safetensors', 'other_style.safetensors'],
  control_net_name: ['OpenPoseXL2.safetensors'],
  vae_name: ['ae.safetensors'],
  clip_name: ['clip_l.safetensors', 't5xxl_fp8_e4m3fn.safetensors'],
};
const combo = (list) => [list];
const SPECS = {
  CheckpointLoaderSimple: { ckpt_name: combo(MODELS.ckpt_name) },
  UNETLoader: { unet_name: combo(MODELS.unet_name), weight_dtype: combo(['default', 'fp8_e4m3fn']) },
  DualCLIPLoader: { clip_name1: combo(MODELS.clip_name), clip_name2: combo(MODELS.clip_name), type: combo(['sdxl', 'sd3', 'flux']) },
  VAELoader: { vae_name: combo(MODELS.vae_name) },
  LoraLoader: { model: ['MODEL'], clip: ['CLIP'], lora_name: combo(MODELS.lora_name), strength_model: ['FLOAT'], strength_clip: ['FLOAT'] },
  CLIPTextEncode: { text: ['STRING'], clip: ['CLIP'] },
  FluxGuidance: { conditioning: ['CONDITIONING'], guidance: ['FLOAT'] },
  EmptyLatentImage: { width: ['INT'], height: ['INT'], batch_size: ['INT'] },
  EmptySD3LatentImage: { width: ['INT'], height: ['INT'], batch_size: ['INT'] },
  KSampler: {
    model: ['MODEL'], seed: ['INT'], steps: ['INT'], cfg: ['FLOAT'],
    sampler_name: combo(['euler', 'ddpm', 'dpmpp_2m', 'dpmpp_2m_sde']), scheduler: combo(['normal', 'karras', 'simple']),
    positive: ['CONDITIONING'], negative: ['CONDITIONING'], latent_image: ['LATENT'], denoise: ['FLOAT'],
  },
  VAEDecode: { samples: ['LATENT'], vae: ['VAE'] },
  VAEEncode: { pixels: ['IMAGE'], vae: ['VAE'] },
  SaveImage: { images: ['IMAGE'], filename_prefix: ['STRING'] },
  LoadImage: { image: [['example.png'], { image_upload: true }] },
  ImageScale: { image: ['IMAGE'], upscale_method: combo(['nearest-exact', 'bilinear', 'lanczos']), width: ['INT'], height: ['INT'], crop: combo(['disabled', 'center']) },
  ControlNetLoader: { control_net_name: combo(MODELS.control_net_name) },
  ControlNetApplyAdvanced: { positive: ['CONDITIONING'], negative: ['CONDITIONING'], control_net: ['CONTROL_NET'], image: ['IMAGE'], strength: ['FLOAT'], start_percent: ['FLOAT'], end_percent: ['FLOAT'] },
  SetUnionControlNetType: { control_net: ['CONTROL_NET'], type: combo(['auto', 'openpose', 'depth']) },
  CLIPVisionLoader: { clip_name: combo(['CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors']) },
};
if (!arg('--no-ipadapter')) {
  Object.assign(SPECS, {
    IPAdapterUnifiedLoaderFaceID: { model: ['MODEL'], preset: combo(['FACEID', 'FACEID PLUS V2']), lora_strength: ['FLOAT'], provider: combo(['CPU', 'CUDA']) },
    IPAdapterFaceID: {
      model: ['MODEL'], ipadapter: ['IPADAPTER'], image: ['IMAGE'], weight: ['FLOAT'], weight_faceidv2: ['FLOAT'],
      weight_type: combo(['linear']), combine_embeds: combo(['concat']), start_at: ['FLOAT'], end_at: ['FLOAT'], embeds_scaling: combo(['V only', 'K+V']),
    },
    IPAdapterModelLoader: { ipadapter_file: combo(['ip-adapter-faceid-plusv2_sdxl.bin']) },
  });
}
if (!arg('--no-face-refine')) {
  Object.assign(SPECS, {
    UltralyticsDetectorProvider: { model_name: combo(['bbox/face_yolov8m.pt']) },
    FaceDetailer: {
      image: ['IMAGE'], model: ['MODEL'], clip: ['CLIP'], vae: ['VAE'], positive: ['CONDITIONING'], negative: ['CONDITIONING'],
      bbox_detector: ['BBOX_DETECTOR'], guide_size: ['FLOAT'], guide_size_for: ['BOOLEAN'], max_size: ['FLOAT'], seed: ['INT'],
      steps: ['INT'], cfg: ['FLOAT'], sampler_name: combo(['euler', 'ddpm', 'dpmpp_2m']), scheduler: combo(['normal', 'karras']),
      denoise: ['FLOAT'], feather: ['INT'], noise_mask: ['BOOLEAN'], force_inpaint: ['BOOLEAN'],
    },
  });
}
if (arg('--qwen-edit')) {
  // Edit Outfit: Qwen-Image-Edit-2509 files + core Qwen nodes + Sienna chin crop + Impact bbox mask.
  MODELS.unet_name.push('qwen_image_edit_2509_fp8_e4m3fn.safetensors');
  MODELS.vae_name.push('qwen_image_vae.safetensors');
  Object.assign(SPECS, {
    CLIPLoader: { clip_name: combo(['qwen_2.5_vl_7b_fp8_scaled.safetensors']), type: combo(['qwen_image', 'sdxl']), device: combo(['default', 'cpu']) },
    TextEncodeQwenImageEditPlus: { clip: ['CLIP'], vae: ['VAE'], prompt: ['STRING'] },
    ModelSamplingAuraFlow: { model: ['MODEL'], shift: ['FLOAT'] },
    CFGNorm: { model: ['MODEL'], strength: ['FLOAT'] },
    BboxDetectorCombined_v2: { bbox_detector: ['BBOX_DETECTOR'], image: ['IMAGE'], threshold: ['FLOAT'], dilation: ['INT'] },
    SiennaChinCrop: { image: ['IMAGE'], margin: ['FLOAT'], min_keep: ['FLOAT'] },
  });
}
// (PuLID-Flux deliberately absent, to exercise "missing custom node" paths.)

const uploads = new Set();
const jobs = new Map();
let counter = 0;

function png() {
  const w = 64, h = 96;
  const raw = Buffer.alloc((w * 3 + 1) * h, 120);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const table = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const readBody = (req) => new Promise((r) => { const parts = []; req.on('data', (d) => parts.push(d)); req.on('end', () => r(Buffer.concat(parts))); });

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (process.env.FAKE_AUTH && req.headers.authorization !== `Bearer ${process.env.FAKE_AUTH}`) return send(res, 401, { error: 'unauthorized' });
    if (p === '/system_stats') {
      return send(res, 200, { system: { comfyui_version: '0.3.99-fake', python_version: '3.11' }, devices: [{ name: 'cuda:0 NVIDIA Fake 24GB', type: 'cuda', vram_total: 24 * 1024 ** 3, vram_free: 20 * 1024 ** 3 }] });
    }
    if (p.startsWith('/object_info/')) {
      const cls = decodeURIComponent(p.slice('/object_info/'.length));
      if (!SPECS[cls]) return send(res, 200, {});
      return send(res, 200, { [cls]: { input: { required: SPECS[cls] }, output: [], python_module: 'nodes' } });
    }
    if (p === '/upload/image' && req.method === 'POST') {
      const body = (await readBody(req)).toString('latin1');
      const name = /filename="([^"]+)"/.exec(body)?.[1] ?? 'upload.png';
      uploads.add(`sienna/${name}`);
      return send(res, 200, { name, subfolder: 'sienna', type: 'input' });
    }
    if (p === '/prompt' && req.method === 'POST') {
      const { prompt } = JSON.parse((await readBody(req)).toString());
      const node_errors = {};
      for (const [id, n] of Object.entries(prompt)) {
        if (!SPECS[n.class_type]) {
          return send(res, 400, { error: { type: 'invalid_prompt', message: `Cannot execute because node ${n.class_type} does not exist.`, details: `Node ID '#${id}'` }, node_errors: {} });
        }
        const errs = [];
        for (const [k, spec] of Object.entries(SPECS[n.class_type])) {
          const v = n.inputs[k];
          if (v === undefined) errs.push({ type: 'required_input_missing', message: 'Required input is missing', details: k });
          else if (n.class_type === 'LoadImage' && k === 'image') { if (!uploads.has(v)) errs.push({ type: 'custom_validation_failed', message: 'Custom validation failed for node', details: `image - Invalid image file: ${v}` }); }
          else if (Array.isArray(spec[0]) && !spec[0].includes(v)) errs.push({ type: 'value_not_in_list', message: 'Value not in list', details: `${k}: '${v}' not in ${JSON.stringify(spec[0])}` });
        }
        if (errs.length) node_errors[id] = { errors: errs, dependent_outputs: [], class_type: n.class_type };
      }
      if (Object.keys(node_errors).length) {
        return send(res, 400, { error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation', details: '' }, node_errors });
      }
      const id = `fake-${++counter}`;
      jobs.set(id, { at: Date.now(), prompt });
      return send(res, 200, { prompt_id: id, number: counter, node_errors: {} });
    }
    if (p === '/queue') {
      const running = [...jobs].filter(([, j]) => Date.now() - j.at < 1500).map(([id], i) => [i, id, {}, {}, []]);
      return send(res, 200, { queue_running: running, queue_pending: [] });
    }
    if (p.startsWith('/history/')) {
      const id = p.slice('/history/'.length);
      const j = jobs.get(id);
      if (!j || Date.now() - j.at < 1500) return send(res, 200, {});
      if (arg('--fail-exec')) {
        return send(res, 200, {
          [id]: {
            outputs: {},
            status: {
              status_str: 'error', completed: false,
              messages: [['execution_error', { node_id: '40', node_type: 'KSampler', exception_type: 'torch.OutOfMemoryError', exception_message: 'CUDA out of memory.', traceback: ['  File "x.py", line 1'] }]],
            },
          },
        });
      }
      const outputs = {};
      for (const [k, n] of Object.entries(j.prompt)) {
        if (n.class_type === 'SaveImage') outputs[k] = { images: [{ filename: `${id}_${k}.png`, subfolder: 'sienna', type: 'output' }] };
        if (n.class_type === 'SiennaChinCrop') outputs[k] = { text: [JSON.stringify({ mode: 'cropped', cut: 0.21 })] };
      }
      return send(res, 200, { [id]: { outputs, status: { status_str: 'success', completed: true, messages: [] } } });
    }
    if (p === '/view') return send(res, 200, png(), 'image/png');
    if (p === '/interrupt') return send(res, 200, {});
    send(res, 404, { error: 'not found' });
  })
  .listen(PORT, () => console.log(`fake ComfyUI on :${PORT}`));
