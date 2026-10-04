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
| **Mock mode** | `COMFYUI_URL=mock` runs everything end-to-end with generated placeholder images. No GPU needed |
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

## 4. Connect a ComfyUI cloud GPU

The **app server** (not your phone) talks to ComfyUI over HTTP, using only ComfyUI's own endpoints:
`/system_stats`, `/object_info`, `/upload/image`, `/prompt`, `/queue`, `/history`, `/view`, `/interrupt`.

### RunPod (example)

1. Deploy a pod from a **ComfyUI template**. A 24 GB GPU (RTX 4090 / A5000 / L4) handles SDXL and Flux-fp8 comfortably.
2. Make sure **HTTP port 8188** is exposed in the pod settings.
3. Your URL is `https://<POD_ID>-8188.proxy.runpod.net`. Paste it in **Settings → ComfyUI** (or the wizard) and tap **Test**.
4. Put models on the pod's volume:
   - checkpoints → `ComfyUI/models/checkpoints/` (e.g. an SDXL photoreal model)
   - LoRAs → `ComfyUI/models/loras/`
   - ControlNet → `ComfyUI/models/controlnet/` (for the pose workflow)
   - IPAdapter/FaceID → per the ComfyUI_IPAdapter_plus README (for the FaceID workflow)
5. Install any custom nodes your workflows need, using ComfyUI-Manager on the pod.

### Vast.ai / Lambda / Paperspace / others

Any pod running ComfyUI works if the app server can reach port 8188. Use the provider's HTTPS
proxy or open port, or a Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:8188`).
If you put an auth proxy in front, set `COMFYUI_API_KEY` or `COMFYUI_EXTRA_HEADERS`.

### Your own GPU PC later

Start ComfyUI with `python main.py --listen 0.0.0.0 --port 8188` and point the app at
`http://<pc-ip>:8188`, or your Tailscale IP if the app is hosted elsewhere. Nothing else changes.

### Hosted "serverless ComfyUI" services

Services that expose the **native ComfyUI API** work unchanged. Services with their own API
(custom `/run` endpoints, job IDs, webhooks) need a small adapter: implement the `ComfyBackend`
interface in [`lib/comfy/client.ts`](lib/comfy/client.ts) (`systemInfo`, `inputChoices`,
`uploadImage`, `queuePrompt`, `jobState`, `fetchImage`, `interrupt`) and return it from `createBackend()`.
The rest of the app is backend-agnostic.

> **Cold starts:** the first job on a freshly started GPU can take minutes while models load.
> The job timeout is set in Settings (default 15 min).

---

## 5. Add a trained Sienna LoRA

1. **Train** a LoRA on 20–40 varied, high-quality images of Sienna **as generated by you**, for example
   renders curated from this app with the Studio-neutral and casual presets. Vary angle, lighting and
   outfit, and keep the face consistent. Use a rare trigger token such as `sienna_v1`. Typical tools are
   kohya_ss / OneTrainer / ai-toolkit for SDXL or Flux. Train it **for the same base family**
   you'll generate with: an SDXL LoRA goes with SDXL workflows, a Flux LoRA with the Flux workflow.
2. **Upload** `sienna_v1.safetensors` to `ComfyUI/models/loras/` on the GPU server. A subfolder is fine;
   ComfyUI lists it as `subfolder/sienna_v1.safetensors`.
3. In the app go to **Sienna → Sienna LoRA**, pick the file from the list (or type the exact name), set the
   default strength (start at 0.8), and set the **trigger token** to the token you trained with.
4. Keep **Sienna Lock** on. Generate **Studio neutral**, then tune:
   - face drifts → raise LoRA strength by +0.1, or add a face reference with the FaceID workflow
   - outfits/settings get ignored or images look "burned" → lower the strength
5. Use the **Quality check** to flag drift across a batch, and favourite the best seeds.

Versioning tip: keep `sienna_v1`, `sienna_v2` side by side and switch in the profile. The gallery
records which LoRA and strength produced each image.

---

## 6. Workflows and node mapping

ComfyUI graphs are in **API format**: `{ "<nodeId>": { class_type, inputs } }`. The app stores, per
workflow, a **bindings** table that maps each UI control to `nodeId.inputName`:

```ts
// lib/comfy/builtin-workflows.ts (example adapter for the SDXL graph)
positive_prompt: [{ nodeId: '6',  inputName: 'text' }],
seed:            [{ nodeId: '3',  inputName: 'seed' }],
lora_name:       [{ nodeId: '10', inputName: 'lora_name' }],
face_reference_image: [{ nodeId: '21', inputName: 'image' }],   // a LoadImage node
```

- **Built-in examples:** [`workflows/examples/`](workflows/examples/), with notes in [its README](workflows/examples/README.md).
- **Auto-detection and the full explanation of where node IDs come from:**
  [`lib/comfy/adapter.ts`](lib/comfy/adapter.ts) (header comment).
- **Uploaded workflows:** map them in the app (**Library → Workflows → Edit mapping**). No code needed.

Behaviour notes:

- Unmapped controls are not sent, so the workflow's own value is used.
- No LoRA selected → the template's LoRA node is **bypassed** (rewired around), so ComfyUI never tries
  to load a missing file.
- Sienna Lock on and no LoRA node in the graph → a `LoraLoader` is **spliced in** after the checkpoint/UNET
  loader. You can turn this off per workflow.
- A workflow with a mapped face/init/pose input *requires* that image. The app tells you before submitting.

---

## Project structure

```
sienna-studio/
├─ app/                      Next.js App Router
│  ├─ page.tsx               Create (prompt builder + generate)
│  ├─ gallery/               history grid + detail/review
│  ├─ character/             Sienna profile
│  ├─ library/               presets + workflows (+ mapping editor)
│  ├─ settings/  setup/  login/
│  └─ api/                   route handlers (generate, history, workflows, presets, uploads, comfy, export/import…)
├─ components/               UI kit, CreateScreen, CharacterEditor, ImagePicker, JobCard…
├─ lib/
│  ├─ types.ts  defaults.ts  schemas.ts  review.ts
│  ├─ prompt.ts  guard.ts    prompt assembly, Sienna Lock filtering, content guard
│  ├─ comfy/adapter.ts       bindings, auto-detect, LoRA inject/bypass
│  ├─ comfy/client.ts        ComfyUI HTTP client + mock backend
│  ├─ comfy/builtin-workflows.ts  example adapters (explicit node-ID maps)
│  └─ server/                store (JSON + files), generation pipeline, PNG encoder
├─ workflows/examples/       API-format ComfyUI graphs
├─ scripts/smoke.mjs         end-to-end smoke test
├─ Dockerfile  docker-compose.yml  render.yaml  .env.example
```

## Limits & notes

- Run **one** app instance per `DATA_DIR`. Writes are serialised in-process.
- Progress is polled (`/api/history/:id/status`) rather than streamed over websockets. That works through
  every proxy and survives the phone locking. Images are copied into `DATA_DIR/images` when a job finishes.
- iPhone HEIC photos: Safari normally converts them to JPEG on upload. If not, set
  Settings → Camera → Formats → Most Compatible.
