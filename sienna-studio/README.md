# Sienna Studio

A mobile-first web app for generating **consistent images of a fictional adult character, Sienna**.
Her face and identity stay fixed while you change outfit, pose, setting, lighting, camera and framing.
Generation runs on a **remote ComfyUI** server: a cloud GPU, your own PC, or any host that exposes
the native ComfyUI API. The app is built with Next.js 14, TypeScript and Tailwind, and it has no database.
Data is JSON plus image files in `DATA_DIR`.

> **Content policy built in.** Sienna is fictional and always an adult (profile age ≥ 21, enforced).
> Prompts that suggest minors, or that reference a real person's likeness, look-alikes or face swaps,
> are **hard-blocked** on both the client and the server. Reference uploads require you to confirm they
> depict the fictional character. Adult (18+) mode stays off unless the server operator sets
> `ALLOW_ADULT_CONTENT=true`. Only do that when your model, LoRA and GPU provider all permit it.
> The app has no face-swap tooling.

---

## Features

| Area | What you get |
|---|---|
| **Sienna profile** | Trigger token, LoRA filename (picked from the server's list), LoRA model/CLIP weights, age, preferred face reference plus secondary references, core appearance traits, default realism, negative and camera prompts |
| **🔒 Sienna Lock** | Injects the LoRA (or splices a `LoraLoader` into graphs without one) and the trigger token, traits and face-reference conditioning, then **strips identity-altering phrases** from the prompt fields: hair/eye colour, skin tone/ethnicity, face shape, age, freckle removal, "different person", plus your own custom terms. You see a live warning before you generate |
| **Prompt builder** | Separate fields for outfit, pose, body presentation, expression, setting, lighting, camera, framing, realism and extra. These are assembled into the final prompt, with a preview and copy button |
| **Presets** | iPhone selfie, Mirror selfie, Bedroom, Car selfie, Bathroom mirror, Couch, Outdoor casual, Full-body casual, Studio neutral. Create, duplicate, edit and delete them, assign each its own workflow, and restore the built-ins |
| **Realism defaults** | Casual iPhone photo language (pores, flyaways, asymmetry, lens distortion, imperfect framing) and negatives against plastic or over-smoothed skin, HDR and symmetry. The anti-studio negative is dropped automatically when you pick studio lighting |
| **ComfyUI** | Connection test, live model/LoRA/sampler/scheduler/ControlNet lists from `/object_info`, image upload, txt2img, img2img plus denoise, face reference (IPAdapter/PuLID/InstantID), pose ControlNet, seed, size, steps, CFG/Flux guidance, batch |
| **Workflow manager** | Upload any number of API-format workflows, auto-detect the **control → node-input mapping**, edit it in a mobile editor, choose output nodes, replace or download JSON |
| **Gallery** | Every generation keeps its image(s), prompt, seed, workflow, LoRA and strength, references, and date. Favourite, regenerate with the same seed, roll a new seed, **edit & regenerate**, use as img2img init, delete |
| **Quality check** | An 11-item checklist per image (face drift, eyes, freckles, hairline, hands, teeth, jewelry, background, reflections, duplicates, anatomy). Each flagged item shows a fix hint, and the gallery can filter to "Flagged" |
| **Mobile UX** | Bottom navigation, sticky Generate bar, collapsible sections, 44px+ touch targets, 16px inputs (no iOS zoom), safe-area aware, portrait previews. **Save / Share** opens the iOS share sheet so you can tap "Save Image" to put it in Photos. Add to Home Screen gives a full-screen PWA |
| **Setup wizard** | 1) ComfyUI URL → 2) connection test → 3) references → 4) LoRA → 5) workflow → 6) first test generation |
| **Backup** | Export/import settings, profile (including reference images), presets and workflows as one JSON file |
| **Diagnostics** | Live checks for server, GPU, checkpoints, LoRAs, Sienna LoRA, custom nodes, IPAdapter/FaceID/PuLID/ControlNet, and a dry-run validation of the selected workflow, plus the first-real-generation test |
| **Mock mode** | `COMFYUI_URL=mock` runs everything with placeholder images, with an unmistakable MOCK MODE banner |
| **Security** | Optional password gate (`APP_PASSWORD`) on every page and API route. All ComfyUI credentials stay server-side |

---

## 1. Run it locally

Requires **Node 18.18+** (20 or 22 recommended).

```bash
cd sienna-studio
cp .env.example .env.local      # defaults: mock mode, no password
npm install
npm run dev                     # http://localhost:3000
```

**From your iPhone on the same Wi-Fi:** `npm run dev` listens on all interfaces, so open
`http://<your-computer's-LAN-IP>:3000` in Safari.

Production build:

```bash
npm run build
npm start                       # PORT=3000 by default
```

Checks:

```bash
npm test          # unit tests: prompt builder, guard, workflow adapter
npm run lint      # TypeScript type-check
npm run smoke     # end-to-end against a running server (start it with COMFYUI_URL=mock)
```

---

## 2. Environment variables

See [`.env.example`](.env.example). **None of these reach the browser.**

| Variable | Purpose |
|---|---|
| `APP_PASSWORD` | Password for the whole app. **Set it whenever the app is on the internet.** |
| `SESSION_SECRET` | Signs the login cookie (`openssl rand -hex 32`). |
| `COMFYUI_URL` | Default ComfyUI base URL, or `mock`. Can be overridden in Settings. |
| `COMFYUI_API_KEY` | Optional. Sent as `Authorization: Bearer …` for ComfyUI behind an auth proxy. |
| `COMFYUI_EXTRA_HEADERS` | Optional JSON of extra headers (basic auth, Cloudflare Access…). |
| `ALLOW_ADULT_CONTENT` | `true` enables the Adult 18+ mode toggle. Default `false` forces SFW. |
| `DATA_DIR` | Storage folder (default `./data`). Must be persistent in production. |
| `INSECURE_COOKIES` | `true` only if you serve production over plain HTTP (e.g. a LAN or Tailscale IP). |
| `SIENNA_OUTFIT_EDIT` | `true` turns on the optional **Edit Outfit** button (Qwen-Image-Edit-2509). Default off. See §5. |

---

## 3. Deploy

The app needs **one Node process plus a persistent disk** for `DATA_DIR`. Serverless hosts with
ephemeral filesystems, such as plain Vercel, will lose your history and are **not** recommended.

### Option A: Docker (any VPS, home server or NAS)

```bash
cd sienna-studio
cp .env.example .env            # set APP_PASSWORD, SESSION_SECRET, COMFYUI_URL
docker compose up -d --build    # http://<host>:3000, data in the "sienna-data" volume
```

Put it behind HTTPS (Caddy, Cloudflare Tunnel or Tailscale Serve) before using it from your phone over the internet.

### Option B: Render (Blueprint)

1. Push this repo to GitHub.
2. In Render, go to **New → Blueprint**, select the repo, and set **Blueprint Path** to `sienna-studio/render.yaml`.
   It creates a Docker web service with a 5 GB persistent disk at `/data` (paid plan, since disks need one).
3. Set `APP_PASSWORD` (and `COMFYUI_URL`, or set the URL later in the wizard).
4. Open the `onrender.com` URL on your iPhone, then Share → **Add to Home Screen**.

### Option C: Railway / Fly.io / any Docker host

Deploy the `sienna-studio/Dockerfile`, attach a volume at `/data`, and set the environment variables above.

### Option D: Your own PC

`npm run build && npm start`. To reach it from your phone anywhere, install
[Tailscale](https://tailscale.com) on the PC and the phone and open `http://<pc-tailscale-ip>:3000`.
Set `INSECURE_COOKIES=true` if you use plain HTTP with a password.

---

## 4. Connect a real ComfyUI server (any provider)

The app talks to **any reachable ComfyUI HTTP endpoint**: a cloud GPU from any provider, your own PC, or a
managed service exposing the native API. There is nothing provider-specific in the code. It uses only
ComfyUI's own endpoints: `/system_stats`, `/object_info`, `/upload/image`, `/prompt`, `/queue`, `/history`,
`/view` and `/interrupt`.

1. Run ComfyUI with `python main.py --listen 0.0.0.0 --port 8188` and make port 8188 reachable **from the app
   server**, through your provider's HTTPS proxy, a port mapping, a tunnel (`cloudflared tunnel --url http://localhost:8188`)
   or Tailscale.
2. If it's behind an auth proxy, set `COMFYUI_API_KEY` (sent as `Authorization: Bearer …`) and/or
   `COMFYUI_EXTRA_HEADERS` (any JSON headers) on the app server.
3. Put the URL in **Settings → ComfyUI backend** (or `COMFYUI_URL`) and tap **Test**.
4. Open **Settings → Open diagnostics** (or tap the MOCK / ComfyUI badge on Create).

**📁 Exactly where models, LoRAs, IPAdapter, ControlNet files and workflow JSON go:
[`docs/COMFYUI_SETUP.md`](docs/COMFYUI_SETUP.md).**

### Diagnostics screen (`/diagnostics`)

It runs against the live server and the selected workflow:

| Check | What it verifies |
|---|---|
| Server reachable | `/system_stats` answers (shows version and latency; 401 → API key hint) |
| GPU detected | a non-CPU device (CUDA / ROCm / MPS) with its VRAM |
| Checkpoints / base models | files in `models/checkpoints` (SDXL) or `models/diffusion_models` (Flux) |
| LoRAs | files in `models/loras` |
| Sienna LoRA | the profile's LoRA filename exists on the server (suggests near matches) |
| Custom nodes | every node class in the workflow, split into **core** and each **optional module**, with the package to install |
| Identity nodes | IPAdapter / FaceID / PuLID / InstantID availability, plus IPAdapter, CLIP-Vision and PuLID model files |
| ControlNet | ControlNet nodes, models, and whether a pose preprocessor exists |
| Workflow executable | **dry-runs the exact graph the first test would send** and validates every node class, required input and model-file value against the server |

Below the checks, **Model files used by this workflow** lets you pick the base checkpoint, VAE, encoders and
ControlNet from what's actually on the server. Your choice is saved as the workflow default.

### First real generation test

Also on the Diagnostics screen (and in the setup wizard). It uses a fixed request: preset **Studio Neutral**,
**Sienna Lock on**, **LoRA strength 1.0**, **fixed seed 424242**, no pose, no img2img, SFW, one 896×1152
portrait. A face reference is used if you uploaded one and the identity nodes are installed. The card shows the
image and **all metadata**: prompt ID, seed, model, LoRA and strength, sampler, size, modules used or skipped,
warnings, the exact graph sent, and any ComfyUI error, including validation `node_errors` or the execution
exception and traceback. Failed attempts are kept in the gallery too.

### Other backends

A service with its *own* API (custom job endpoints instead of `/prompt`) needs a class implementing
`ComfyBackend` in [`lib/comfy/client.ts`](lib/comfy/client.ts) (`systemInfo`, `inputChoices`, `nodeInfo`,
`uploadImage`, `queuePrompt`, `jobState`, `fetchImage`, `interrupt`), returned from `createBackend()`.

---

## 5. The Sienna LoRA (trained separately)

Training is **not** part of this app. The current LoRA is `sienna_v2.safetensors` (SDXL, RealVisXL V5.0 base,
trigger `sienna_v1`, 2800 steps). To install it:

1. Copy it to `ComfyUI/models/loras/sienna_v2.safetensors`. A subfolder also works; it then appears as
   `subfolder/sienna_v2.safetensors`.
2. In the app, go to **Sienna → Sienna LoRA** and pick it from the list. Default strength is **1.0**.
3. Set the **trigger token** to the exact token used in training. The default is `sienna_v1`; change it if yours differs.
   Sienna Lock sends it as `sienna_v1 woman`, matching the training captions.
4. Make sure the LoRA's base family matches the workflow: an **SDXL LoRA** goes with *Sienna Production · SDXL*,
   a **Flux LoRA** with *Sienna Production · Flux.1-dev*.
5. **Diagnostics → Sienna LoRA** should show ✓. Then run the first generation test.

Tested defaults for `sienna_v2` (chosen by side-by-side comparison against the reference photos):
LoRA **1.0**, sampler **ddpm**, scheduler **normal**, **30 steps**, CFG 5, and **no face reference** (IPAdapter
FaceID off; it caused blotchy skin and glassy eyes in testing). With Sienna Lock on, the negative prompt adds
`older woman, middle-aged, wrinkles, aged skin, mature face` to hold her stated age; `dpmpp_2m/karras` and a
"young-looking" negative both made her look older.

### Face refinement for small faces (SDXL)

In full-body and mirror shots Sienna's face covers only a few pixels, so SDXL draws a more generic face.
**Advanced → Face refinement for small faces** adds a second pass (FaceDetailer from ComfyUI-Impact-Pack):

1. a face detector (`face_yolov8m.pt`) finds the face in the first-pass image;
2. faces whose bounding box is **under the threshold (384 px)** are cropped, enlarged to it, and redrawn
   with the **same checkpoint, Sienna LoRA, prompt, negative prompt, seed and sampler** at low denoise
   (default **0.30**; 0.20–0.35 tested);
3. only the face area is masked and blended back with a feathered edge, so pose, expression, hair and
   lighting stay as they were. Larger faces (close-up selfies) are left untouched.

It is **on by default** (denoise 0.30, threshold 384 px) and can be switched off per generation in
**Advanced**. It never uses a face reference or FaceID. If the nodes or the detector model are missing, the
pass is skipped with a warning and the image is generated normally. **Diagnostics → Face refinement** says
whether it is ready. Setup, including the one-command installer for fresh cloud Pods
(`scripts/comfyui-bootstrap.sh`): see `docs/COMFYUI_SETUP.md` §2.

Tuning: changing LoRA strength between 0.9 and 1.1 barely changes the face. If outfits or settings get ignored
or images look burned, lower it.


### Edit Outfit (optional, Qwen-Image-Edit-2509)

Changes the clothes on an **existing** image and saves the result as a **new** gallery image; the original is
never modified. Separate from the generator and Outfit Reference (both unchanged). Off unless
`SIENNA_OUTFIT_EDIT=true`.

Gallery → image → **👗 Edit outfit**: add a clothing photo, describe it (or **Describe from photo** for a
draft), pick **Entire outfit / Top only / Bottom only**, footwear (**Keep current / Barefoot / From photo**) and
**Sienna face restore** (Off / Standard 0.3 / Strong 0.45). The pipeline (`lib/outfit-edit.ts`):

1. the clothing photo is cropped just below the chin (`SiennaChinCrop` + the face detector) so the editor can't
   copy that person's face; the full width and everything below is kept. **Crop by hand** overrides it;
2. Qwen-Image-Edit-2509 edits the image at the source's exact aspect ratio, told to remove the old outfit
   (the record's outfit text) and match the photo piece by piece;
3. the result is scaled back to the source size and Sienna's production FaceDetailer (same settings as the
   generator's face refinement, Sienna LoRA) redraws the face at 0.3 or 0.45.

The description matters: Qwen follows the **text over the photo** (a detail that isn't in the photo gets
added). Needs a 24 GB+ GPU and ~30 GB of models: `comfyui-bootstrap.sh --with-qwen-edit`. The edit screen
lists anything missing. Speed measured: ~100 s per edit on an L40S, ~7.5 min on an RTX 3090.

**Body protection (experimental, `SIENNA_EXPERIMENTAL=true`, all off by default).** Qwen tends to give Sienna
the clothing model's figure, or a generic one, where clothes come off. Three options in **Edit outfit → Body
protection**, not yet proven on the GPU:

- **Use Sienna's body references** — 3–4 approved images (Sienna page → *Body references*, added from the
  gallery with *Use as body reference*; only `sienna_v2` generations made without an outfit reference, init
  image or Edit Outfit are accepted) are stitched into one image and given to the editor as image 3, with an
  instruction to keep her proportions.
- **Clothing only** — `SiennaGarmentOnly` keeps every non-skin pixel on the person (so straps, ties and strings
  survive), removes the model's skin, figure outline, feet and background, checks each expected piece (top /
  bottom) is present, and otherwise falls back to the chin crop.
- **Check her body afterwards** — `SiennaBodyMeasure` / `SiennaBodyCheck` (DWPose + person mask) compare leg
  lengths and bare-skin widths before/after, skipping anything a pose change, camera angle, arms touching the
  body, a footwear change or a skirt makes unfair; parts the edit uncovered are compared with the *range* of
  the approved references (at least two, never one). It also flags edits that replaced the whole scene.

They need `comfyui-bootstrap.sh --with-qwen-edit` (adds DWPose and the person segmenter).
---

## 6. Workflows

### Primary production workflows (built in)

| Workflow | Base | Core (always) | Optional modules (auto-removed when unused / unavailable) |
|---|---|---|---|
| **Sienna Production · SDXL** (default) | SDXL checkpoint | Sienna LoRA, trigger token, ± prompt, seed, size, steps, CFG, sampler/scheduler | img2img (init image + denoise) · IPAdapter FaceID identity · OpenPose ControlNet |
| **Sienna Production · Flux.1-dev** | Flux UNET + T5/CLIP-L + VAE | Sienna LoRA, trigger token, prompt (negative ignored at cfg 1), seed, size, steps, **Flux guidance** | img2img · PuLID-Flux identity · union ControlNet (openpose) |
| Basic SDXL · text-to-image | SDXL | stock nodes only | — (fallback for isolating problems) |

**How optional modules work** ([`lib/comfy/modules.ts`](lib/comfy/modules.ts)): each production graph has every
module wired in. Per generation, if a module's image isn't supplied, or the server lacks its nodes, that
branch is cut out of a copy of the graph. IPAdapter/PuLID/ControlNet nodes are bypassed, and img2img falls
back to the empty latent. Unused loaders are dropped. This is driven by class types and the binding table,
never by fixed node IDs. In **Library → Workflows → Edit mapping** you can mark each module optional or
required.

### Node mapping (no fixed IDs)

Each workflow stores a **bindings** table mapping app controls to `nodeId.inputName`. Built-ins define it in
[`lib/comfy/builtin-workflows.ts`](lib/comfy/builtin-workflows.ts). Uploaded workflows get it auto-detected
from class types and node titles, and you can edit it in the mapping screen. Re-exporting a graph from ComfyUI
can renumber nodes; re-run **Auto-detect** or fix the mapping by hand. Both are covered in
[`lib/comfy/adapter.ts`](lib/comfy/adapter.ts) (header comment) and
[`workflows/examples/README.md`](workflows/examples/README.md).

Other behaviour:

- No LoRA selected → the LoRA node is bypassed, so ComfyUI never loads a missing file.
- Sienna Lock on with no LoRA node in the graph → a `LoraLoader` is spliced in (configurable per workflow).
- Unmapped controls keep the workflow's own value.

---

## 7. Mock mode

`COMFYUI_URL=mock` (the default in `.env.example`), or "mock" in Settings, runs everything without a GPU.
It is deliberately hard to miss:

- a **striped MOCK MODE banner** on every page (tap it to go to Settings),
- the Create button reads **Generate (MOCK)** and the header badge reads **MOCK**,
- mock images have a yellow/black hazard band, and gallery and metadata label them **MOCK**,
- Diagnostics flags that its results are simulated.

Switching to a real URL in Settings removes all of these immediately.

## Project structure

```
sienna-studio/
├─ app/                      Next.js App Router
│  ├─ page.tsx               Create (prompt builder + generate)
│  ├─ gallery/               history grid + detail/review
│  ├─ character/             Sienna profile
│  ├─ library/               presets + workflows (+ mapping editor)
│  ├─ diagnostics/           live server checks + first real generation test
│  ├─ settings/  setup/  login/
│  └─ api/                   route handlers (generate, history, workflows, presets, uploads, comfy, export/import…)
├─ components/               UI kit, CreateScreen, CharacterEditor, ImagePicker, JobCard…
├─ lib/
│  ├─ types.ts  defaults.ts  schemas.ts  review.ts
│  ├─ prompt.ts  guard.ts    prompt assembly, Sienna Lock filtering, content guard
│  ├─ comfy/adapter.ts       bindings, auto-detect, LoRA inject/bypass
│  ├─ comfy/modules.ts       optional-module pruning (img2img / identity / pose)
│  ├─ comfy/packages.ts      node class → custom-node package hints
│  ├─ comfy/client.ts        ComfyUI HTTP client + mock backend
│  ├─ comfy/builtin-workflows.ts  example adapters (explicit node-ID maps)
│  └─ server/                store, generation pipeline, diagnostics, PNG encoder
├─ workflows/examples/       API-format ComfyUI graphs (Sienna Production SDXL/Flux, Basic SDXL)
├─ docs/COMFYUI_SETUP.md     exact ComfyUI folders, custom nodes, reachability
├─ scripts/smoke.mjs         end-to-end smoke test
├─ scripts/fake-comfyui.mjs  ComfyUI-protocol test double (for testing the real client without a GPU)
├─ Dockerfile  docker-compose.yml  render.yaml  .env.example
```

## Limits & notes

- Run **one** app instance per `DATA_DIR`. Writes are serialised in-process.
- Progress is polled (`/api/history/:id/status`) rather than streamed over websockets. That works through
  every proxy and survives the phone locking. Images are copied into `DATA_DIR/images` when a job finishes.
- iPhone HEIC photos: Safari normally converts them to JPEG on upload. If not, set
  Settings → Camera → Formats → Most Compatible.
