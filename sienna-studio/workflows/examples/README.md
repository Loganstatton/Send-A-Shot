# Example ComfyUI workflows (API format)

These graphs ship as built-in workflows. Their **node ID → control** mapping
lives in [`lib/comfy/builtin-workflows.ts`](../../lib/comfy/builtin-workflows.ts).

| File | Nodes you need | Mapped controls |
|---|---|---|
| `sdxl-txt2img-lora.json` | stock ComfyUI only | prompt, negative, checkpoint, LoRA + strengths, seed, size, batch, steps, CFG, sampler, scheduler |
| `sdxl-img2img-lora.json` | stock ComfyUI only | the above + **init image** (node 11) + **denoise** |
| `sdxl-faceid-pose.json` | [ComfyUI_IPAdapter_plus](https://github.com/cubiq/ComfyUI_IPAdapter_plus) + insightface + FaceID Plus V2 models; an SDXL OpenPose ControlNet | the above + **face reference** (node 21), **face weight** (22), **pose image** (30), **pose strength** (32), ControlNet model (31) |
| `flux-dev-lora.json` | stock ComfyUI with Flux.1-dev UNET, `t5xxl` + `clip_l`, `ae.safetensors` | prompt, UNET, LoRA, seed, size, steps, **guidance** (FluxGuidance 26); KSampler CFG stays 1.0 |

The filenames inside the JSON (`sd_xl_base_1.0.safetensors`, `sienna_v1.safetensors`,
`OpenPoseXL2.safetensors`…) are only placeholders. The app overwrites the mapped
ones (checkpoint, LoRA, ControlNet model) with whatever you pick. **Unmapped**
filenames, such as the VAE or CLIP files in the Flux graph, must exist on your
server, so edit them in ComfyUI and re-export if yours differ.

## Using your own workflow

1. Build and test it in ComfyUI.
2. Rename LoadImage nodes so the auto-detector can tell them apart. Titles containing
   `face` / `reference` → face reference, `pose` / `control` → pose image, `init` → img2img.
3. Export it with **Workflow → Export (API)**. In the legacy UI: Settings → enable Dev mode → **Save (API Format)**.
4. In the app go to **Library → Workflows → Choose .json file**. The mapping is auto-detected.
   Review it in **Edit mapping** and fix anything the detector got wrong.
5. Assign it to presets (Library → Presets → Workflow) or make it the default.
