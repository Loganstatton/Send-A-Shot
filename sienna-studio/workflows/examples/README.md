# Built-in ComfyUI workflows (API format)

These graphs ship as built-in workflows. Their **control → node-input** mapping lives in
[`lib/comfy/builtin-workflows.ts`](../../lib/comfy/builtin-workflows.ts). The node IDs are just the keys of
these files; the app never assumes fixed IDs.

| File | Role | Nodes outside stock ComfyUI |
|---|---|---|
| `sienna-sdxl-production.json` | **Primary** SDXL workflow | IPAdapter FaceID module only (ComfyUI_IPAdapter_plus) |
| `sienna-flux-production.json` | Primary Flux.1-dev workflow | PuLID-Flux module only (ComfyUI-PuLID-Flux) |
| `basic-sdxl-txt2img-lora.json` | Minimal fallback | none |

### Production graph layout

```
SDXL                                            Flux.1-dev
1  CheckpointLoaderSimple   (base model)        1  UNETLoader + 2 DualCLIPLoader + 3 VAELoader
2  LoraLoader               (Sienna LoRA)       4  LoraLoader            (Sienna LoRA)
3/4 CLIPTextEncode ±                            5/6 CLIPTextEncode ± ;  7 FluxGuidance
── face module (optional) ──                    ── face module (optional) ──
10 LoadImage "Sienna Face Reference"            10 LoadImage "Sienna Face Reference"
11 IPAdapterUnifiedLoaderFaceID                 11-13 PuLID-Flux loaders
12 IPAdapterFaceID                              14 ApplyPulidFlux
── pose module (optional) ──                    ── pose module (optional) ──
20 LoadImage "Pose Image"                       20 LoadImage "Pose Image"
21 ControlNetLoader                             21 ControlNetLoader → 23 SetUnionControlNetType
22 ControlNetApplyAdvanced                      22 ControlNetApplyAdvanced
── img2img module (optional) ──                 ── img2img module (optional) ──
30 LoadImage "Init Image" → 31 ImageScale → 32 VAEEncode     (same)
33 EmptyLatentImage (used when img2img is off)  33 EmptySD3LatentImage
40 KSampler → 41 VAEDecode → 42 SaveImage       40 KSampler (cfg stays 1.0) → 41 → 42
```

The filenames inside the JSON are placeholders: `sdxl_base.safetensors`, `flux1-dev.safetensors`,
`sdxl_openpose.safetensors` and so on. Set the real ones from what your server has in the app's
**Diagnostics → Model files used by this workflow**. The Sienna LoRA filename always comes from the Sienna
profile.

## Using your own workflow

1. Build and test it in ComfyUI.
2. Give LoadImage nodes descriptive titles so the auto-detector can tell them apart: titles containing
   `face` / `reference` → face reference, `pose` / `control` → pose image, `init` → img2img.
3. Export with **Workflow → Export (API)**. In the legacy UI: Settings → enable Dev mode → **Save (API Format)**.
4. In the app, go to **Library → Workflows → Choose .json file**. The mapping is auto-detected, and image modules
   that can be removed cleanly are marked optional. Review both in **Edit mapping**.
5. Run **Diagnostics** on it, then assign it to presets or make it the default.
