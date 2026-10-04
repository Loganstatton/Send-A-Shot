# ComfyUI setup for real Sienna generation

Sienna Studio works with **any reachable ComfyUI server**: a cloud GPU from any provider, your own PC,
or a managed service that exposes the native ComfyUI HTTP API. It never assumes a particular provider,
fixed node IDs or fixed filenames. Everything below is about what goes *inside* the ComfyUI install.

`ComfyUI/` means the ComfyUI root folder on the GPU machine. It's the folder containing `main.py`, `models/`
and `custom_nodes/`. Some cloud images put it at `/workspace/ComfyUI` or `/opt/ComfyUI`.

---

## 1. Where every file goes

```
ComfyUI/
├─ models/
│  ├─ checkpoints/                 ← SDXL base checkpoint (.safetensors)       [SDXL workflow: REQUIRED]
│  │     e.g. realvisxlV50.safetensors, juggernautXL_v9.safetensors, sd_xl_base_1.0.safetensors
│  │
│  ├─ diffusion_models/            ← Flux.1-dev UNET                           [Flux workflow: REQUIRED]
│  │     flux1-dev.safetensors  (or flux1-dev-fp8.safetensors)
│  │     (older ComfyUI versions use models/unet/ — both are scanned)
│  ├─ text_encoders/               ← Flux text encoders                        [Flux workflow: REQUIRED]
│  │     clip_l.safetensors, t5xxl_fp8_e4m3fn.safetensors
│  │     (older versions: models/clip/)
│  ├─ vae/                         ← Flux VAE                                  [Flux workflow: REQUIRED]
│  │     ae.safetensors
│  │
│  ├─ loras/                       ← THE SIENNA LoRA                           [REQUIRED for identity]
│  │     sienna_v1.safetensors
│  │     ip-adapter-faceid-plusv2_sdxl_lora.safetensors   (IPAdapter FaceID helper LoRA, SDXL face module)
│  │
│  ├─ ipadapter/                   ← IPAdapter models (create the folder)      [SDXL face module: optional]
│  │     ip-adapter-faceid-plusv2_sdxl.bin
│  ├─ clip_vision/                 ← image encoder used by IPAdapter           [SDXL face module: optional]
│  │     CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors
│  ├─ insightface/models/          ← face-analysis models                      [face modules: optional]
│  │     buffalo_l/     (IPAdapter FaceID — downloaded automatically on first use if the server has internet)
│  │     antelopev2/    (PuLID-Flux — place manually: 1k3d68.onnx, 2d106det.onnx, genderage.onnx, glintr100.onnx, scrfd_10g_bnkps.onnx)
│  ├─ pulid/                       ← PuLID-Flux weights (create the folder)    [Flux face module: optional]
│  │     pulid_flux_v0.9.1.safetensors
│  │
│  └─ controlnet/                  ← pose ControlNet models                    [pose module: optional]
│        SDXL: an OpenPose SDXL ControlNet, e.g. OpenPoseXL2.safetensors (thibaud) or controlnet-openpose-sdxl-1.0 (xinsir)
│        Flux: a Flux union ControlNet, e.g. FLUX.1-dev-ControlNet-Union-Pro (Shakker-Labs)
│
├─ custom_nodes/                   ← custom node packages (see §2)
└─ user/default/workflows/         ← (optional) UI-format copies to open in ComfyUI's own editor
```

**Workflow JSON does not go into ComfyUI.** The app keeps its workflows and sends the graph with each request:

- Built-in production workflows ship in this repo: `sienna-studio/workflows/examples/*.json`.
- Your own workflows: export from ComfyUI with **Workflow → Export (API)** and upload them in the app under
  **Library → Workflows → Choose .json file**. They are stored in the app's `DATA_DIR/config.json`.
- To open a workflow in ComfyUI's editor for tweaking, drag the JSON onto the ComfyUI canvas. You can keep
  UI-format copies in `ComfyUI/user/default/workflows/`, but the app does not read them.

**Filenames are not fixed.** After copying files, open **Diagnostics** in the app. The "Model files used by
this workflow" section lists every model input in the selected workflow, with a dropdown of what your
server actually has. Pick the file and it becomes the workflow default.

---

## 2. Custom nodes

| Needed for | Package | Install into `ComfyUI/custom_nodes/` |
|---|---|---|
| Core SDXL / Flux + LoRA, img2img, ControlNet apply | **none** — stock ComfyUI | — |
| SDXL face reference (IPAdapter FaceID) | **ComfyUI_IPAdapter_plus** | `git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus` and `pip install insightface onnxruntime-gpu` in ComfyUI's Python env |
| Flux face reference (PuLID-Flux) | **ComfyUI-PuLID-Flux** | `git clone https://github.com/balazik/ComfyUI-PuLID-Flux` then `pip install -r requirements.txt` (insightface, facexlib, onnxruntime-gpu…) |
| Making pose skeletons *from photos* (optional) | comfyui_controlnet_aux | `git clone https://github.com/Fannovel16/comfyui_controlnet_aux` and its requirements |

ComfyUI-Manager can install all of these from the ComfyUI web UI as well. **Restart ComfyUI after installing
nodes**, then re-run Diagnostics. The app caches node lookups for 5 minutes, so restart the app if you need to
re-check immediately.

The face-reference and pose modules are **optional**. If their nodes or models are missing, the app removes
those branches from the graph automatically and says so in the generation's warnings. You can run real
Sienna generations with only a base model and `sienna_v1.safetensors`.

If your GPU is not NVIDIA, change `provider: CUDA` on the IPAdapter/PuLID loader nodes to `CPU` (or `ROCM` for
PuLID) in **Library → Workflows → Edit mapping → Nodes**, or edit the JSON and re-upload it.

---

## 3. Making the server reachable

The **app server** (not your phone) calls ComfyUI. Any of these work:

- **Cloud GPU (any provider):** start ComfyUI with `python main.py --listen 0.0.0.0 --port 8188` and expose
  port 8188 through the provider's HTTPS proxy, port mapping or public IP. Or run a tunnel on the GPU machine,
  e.g. `cloudflared tunnel --url http://localhost:8188`.
- **Your own PC:** same `--listen` flag, then use the LAN IP or a Tailscale IP, e.g. `http://100.x.y.z:8188`.
- **Managed ComfyUI service:** use it if it exposes the native endpoints (`/system_stats`, `/object_info`,
  `/upload/image`, `/prompt`, `/history`, `/view`). Services with a different API need a small adapter
  (see "Other backends" in the README).

**Auth:** if ComfyUI sits behind an auth proxy, set on the app server:

```
COMFYUI_API_KEY=...                                   # sent as Authorization: Bearer ...
COMFYUI_EXTRA_HEADERS={"X-Api-Key":"...","CF-Access-Client-Id":"...","CF-Access-Client-Secret":"..."}
```

Then enter the URL in **Settings → ComfyUI backend**, or set `COMFYUI_URL` in the environment.

---

## 4. Testing without a GPU

- **Mock mode** (`COMFYUI_URL=mock`): the whole app runs with placeholder images. A striped **MOCK MODE**
  banner sits on every page, mock images carry a hazard band, and gallery items are tagged MOCK.
- **Protocol test server** (developers): `node scripts/fake-comfyui.mjs --port 8199` is a tiny stand-in that
  speaks the ComfyUI HTTP API and validates graphs the same way. Use it to exercise the real client and
  Diagnostics (`--no-ipadapter`, `--no-lora` and `--fail-exec` simulate common problems). It is not ComfyUI and
  makes no real images.
