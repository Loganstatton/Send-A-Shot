# Lead Rescue Ad — Preview & Assets

This folder holds the deliverables for the "Missed Call" cinematic ad concept (see `SCRIPT.md` for the full shot-by-shot script).

## What's here

- **`SCRIPT.md`** — production-ready script/storyboard: scene breakdown, timing, on-screen text, and sound design notes. Hand this to an animator, or use it as the prompt basis for a text-to-video AI tool.
- **`preview.mp4`** — a real, playable rendering of a working motion-graphics approximation of the ad (dark 3D-style unbranded phone, cinematic push, all four scenes, vertical 9:16, ~22.5s). This is **not** a photoreal 3D render — it's a CSS/HTML motion-graphics build that follows the script beat-for-beat, useful for reviewing pacing, story clarity, and copy before commissioning a full 3D render.
- **`../../public/ads/lead-rescue-cinematic-ad.html`** — the live source for that preview. Open it directly in any browser to see it loop in real time.

## Why an HTML build instead of a 3D render

Producing a true photoreal 3D render (Cinema 4D/Blender/Runway-style) isn't something this environment can output directly. Instead, the animation was built as a self-contained, dependency-free HTML/CSS page — a realistic-enough unbranded phone mockup, dark SaaS lighting, and the full missed-call → rescue → recovered story — so the concept, timing, and copy can be reviewed and iterated on immediately, and then handed to a 3D animator (using `SCRIPT.md`) or an AI video tool for the final photoreal pass.

## Re-generating `preview.mp4`

The HTML page animates via CSS keyframes on a shared 20s timeline and loops forever in a browser. To re-capture it as a video after making edits:

```bash
# 1. Record a real-time pass of the page with Playwright (produces a .webm)
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 540, height: 960 },
    recordVideo: { dir: './video', size: { width: 540, height: 960 } },
  });
  const page = await context.newPage();
  await page.goto('file://' + process.cwd() + '/public/ads/lead-rescue-cinematic-ad.html');
  await page.addStyleTag({ content: '.hint{display:none} body{padding:0}' });
  await page.waitForTimeout(20200);
  await context.close();
  await browser.close();
})();
"

# 2. Transcode the .webm to a social-ready H.264 mp4
ffmpeg -i video/<generated>.webm -c:v libx264 -pix_fmt yuv420p -crf 18 \
  -movflags +faststart marketing/lead-rescue-cinematic-ad/preview.mp4
```

Because the page uses `document.getAnimations()`-compatible CSS animations, you can also scrub to an exact moment for a still frame:

```js
document.getAnimations().forEach(a => { a.pause(); a.currentTime = 9500; }); // 9.5s mark
```

Note: real-time capture can run slightly longer than the nominal 20s CSS duration depending on machine load during recording — always verify the loop point (a near-black frame near both the start and the end) before treating a re-render as final, and adjust the trim `-ss`/`-to` in step 2 accordingly.
