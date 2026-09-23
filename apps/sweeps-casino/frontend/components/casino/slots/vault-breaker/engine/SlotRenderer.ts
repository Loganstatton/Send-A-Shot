"use client";

// Top-level Pixi orchestrator — REBUILD (V4), real-art + environment depth
// pass (V5). Owns the Application/stage lifecycle and layers the whole game
// surface as ONE continuous PixiJS scene (spec point 3/4): BACKGROUND ->
// MACHINE FRAME (behind) -> REEL BACKGROUND -> SYMBOL SPRITES -> REEL
// DIVIDERS -> WIN FX -> FOREGROUND GLASS -> MACHINE FRAME (bezel, in front,
// creating depth) -> HUD/overlays. React never touches Pixi objects
// directly — this class is the only bridge (VaultBreakerGame.tsx drives it
// through this small imperative API: spinToResult, celebrateWin,
// playBonusTransition, etc).
//
// V5 NOTES (real symbol art now wired in via symbolAssets.ts — see that
// file; nothing in THIS file changed for that swap, which is the point):
//  - Still no backdrop PHOTO and no "painted machine" canvas art — no real
//    background/frame art exists yet (see art/environmentAssets.ts for the
//    named future paths). The background is a richer radial vignette
//    (buildBackground, using buildRadialVignetteTexture) and the frame is
//    thicker flat metal-toned Graphics/gradient bars with a thin
//    bevel/highlight stroke (buildFrame) — still never bolts/lights/
//    reflections/painted metal texture. This is "not bare black", not
//    "final art".
//  - Every layer below is its own Container/Sprite in a clearly-named slot
//    (this.backgroundLayer, this.frameTop, this.frameLeft, ...) specifically
//    so real art (PNG/JPG layers, see environmentAssets.ts) can later
//    replace a Graphics/gradient fill in that same slot with ZERO changes
//    to layout/z-order/animation code.
//  - The reel VIEWPORT is one continuous surface: a single dark backing
//    panel + subtle vertical gradient behind all 5 reels, with only faint
//    1px dividers between reels — never 20 bordered/boxed cells (spec
//    point 1).
import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { SlotPaylineWin, SlotSymbolId } from "@/lib/types";
import { buildSymbolTextures } from "../art/symbolAssets";
import { buildVerticalGradientTexture, buildRadialVignetteTexture, getGlowTexture } from "../art/fx";
import { ReelStrip } from "./ReelStrip";
import { WinPresentation, type WinTier } from "./WinPresentation";
import { FreeSpinsTransition } from "./FreeSpinsTransition";
import { easeOutBack, tween, REEL_PERSONALITY } from "./animUtils";

const ANTICIPATION_HOLD_MS = 650;

export interface SpinPresentationOptions {
  minScatterCount: number;
  onReelStop?: (index: number) => void;
  onAnticipationStart?: (index: number) => void;
}

export interface FreeSpinsHudInfo {
  index: number;
  total: number;
  multiplier: number;
}

export interface BonusTransitionCallbacks {
  onLocksRelease?: () => void;
  onDoorsOpen?: () => void;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The background layer's procedural fill (see art/environmentAssets.ts for
 * the real-art swap point) — a warm-dark radial vignette with a hint of the
 * vault-teal accent bleeding in at the corners. Depth shading only: three
 * gradient stops, no illustrated detail.
 */
function buildBackgroundTexture(width: number, height: number): Texture {
  return buildRadialVignetteTexture(width, height, [
    { offset: 0, color: "#181119" },
    { offset: 0.55, color: "#0a0c13" },
    { offset: 1, color: "#050f0e" },
  ]);
}

/** Draws a small flat mechanical gear/wheel directly with Graphics (rim + spokes + hub, flat colors only — no gradients/bolts/lights) so it can be rotated in place without regenerating a texture. Reused by the free-spins HUD dial. */
function drawGear(g: Graphics, radius: number) {
  g.clear();
  g.circle(0, 0, radius).fill({ color: 0x1c2230 }).stroke({ width: Math.max(1.5, radius * 0.09), color: 0x2dbfb0, alpha: 0.8 });
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    g.moveTo(0, 0).lineTo(Math.sin(a) * radius * 0.82, -Math.cos(a) * radius * 0.82).stroke({
      width: Math.max(1.5, radius * 0.1),
      color: 0xd4af37,
      cap: "round",
    });
  }
  g.circle(0, 0, radius * 0.28).fill({ color: 0xeafffb, alpha: 0.9 });
}

export class SlotRenderer {
  readonly app: Application;
  /** Everything lives under this container so camera shake/push-in can transform the whole scene at once. */
  private world!: Container;
  private reels: ReelStrip[] = [];
  private reelsContainer!: Container;

  // ---- layer slots (see file header — each is a clearly-named drop-in
  // point a future real-art pass can swap Graphics/Sprite content for). ----
  private backgroundLayer!: Sprite;
  private reelBacking!: Sprite;
  private topShadow!: Sprite;
  private bottomShadow!: Sprite;
  private dividers!: Graphics;
  private glassSheen!: Sprite;
  private frameTop!: Sprite;
  private frameLeft!: Sprite;
  private frameRight!: Sprite;
  private frameBase!: Sprite;
  private frameBezel!: Graphics;
  private frameAccentTop!: Graphics;
  /** Thin bevel highlight/shadow strokes drawn ON TOP of the four frame bar sprites (still behind the reel window) — the cheap "real metal" cue: a bright edge catching light + a dark edge in shadow, never a painted texture. */
  private frameHighlights!: Graphics;

  private anticipationGlows = new Map<number, Sprite>();
  private anticipationDim = 0;
  private win!: WinPresentation;
  private bonus!: FreeSpinsTransition;
  private fsHud!: Container;
  private fsHudSpinsText!: Text;
  private fsHudMultText!: Text;
  private fsHudGear!: Graphics;
  private fsHudPlate!: Graphics;
  private lastHudMultiplier = 0;
  private textures: Record<SlotSymbolId, Texture>;
  private reelsCount: number;
  private rows: number;
  private width = 0;
  private height = 0;
  private cellWidth = 0;
  private cellHeight = 0;
  private bigWin!: Container;
  private bigWinScrim!: Graphics;
  private bigWinLabel!: Text;
  private bigWinAmount!: Text;
  private bigWinParticles: { g: Sprite; vx: number; vy: number; life: number; maxLife: number; active: boolean }[] = [];
  private bigWinRaf = 0;
  private winRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private freeSpinsActive = false;

  // ---- idle ambience ----
  private idle = false;
  private idleElapsed = 0;
  private dustSprites: Sprite[] = [];
  private dustState: { vx: number; vy: number; phase: number }[] = [];
  private tickerFn: ((ticker: { deltaMS: number }) => void) | null = null;

  private constructor(app: Application, reelsCount: number, rows: number, textures: Record<SlotSymbolId, Texture>) {
    this.app = app;
    this.reelsCount = reelsCount;
    this.rows = rows;
    this.textures = textures;
  }

  static async create(
    parent: HTMLElement,
    opts: { reels: number; rows: number; width: number; height: number }
  ): Promise<SlotRenderer> {
    const app = new Application();
    await app.init({
      width: opts.width,
      height: opts.height,
      backgroundAlpha: 1,
      background: 0x05070c,
      antialias: false,
      resolution: Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1),
      autoDensity: true,
      powerPreference: "high-performance",
      // Without this, some browsers/compositors (notably headless Chromium
      // under software WebGL, as used for automated recording/screenshots)
      // clear the WebGL drawing buffer before the page compositor reads it,
      // so a canvas that renders perfectly fine on-screen captures as
      // blank/black in a screenshot or video. Carried forward from V3 QA.
      preserveDrawingBuffer: true,
    });
    (app.canvas as HTMLCanvasElement).style.display = "block";
    (app.canvas as HTMLCanvasElement).style.width = "100%";
    (app.canvas as HTMLCanvasElement).style.height = "100%";
    parent.appendChild(app.canvas as HTMLCanvasElement);

    // Real symbol textures — the ONLY image assets this renderer loads.
    // Background/frame/reel-backing are all generated Graphics/gradients
    // (see buildBackground/buildFrame/buildReelBacking below), per this
    // pass's placeholder policy (no real background/frame art exists yet).
    const textures = await buildSymbolTextures();

    const renderer = new SlotRenderer(app, opts.reels, opts.rows, textures);
    renderer.buildScene(opts.width, opts.height);
    renderer.startTicker();
    return renderer;
  }

  /**
   * The reel window fills the FULL available width AND height budget —
   * never just the width, leaving blank canvas above/below (that exact
   * "too much dead space" was one of the product owner's explicit V3
   * complaints). Cells are therefore NOT forced square: cellWidth =
   * availW/reels (reels fill ~94-96% of phone width, spec point 8),
   * cellHeight = availH/rows independently. On a narrow-tall phone with a
   * 5-wide x 4-tall grid this makes rows taller than they are wide — a
   * normal shape for a portrait mobile slot. Symbols themselves stay
   * square/uniform regardless (ReelStrip sizes them off
   * min(cellWidth,cellHeight) — see FILL in ReelStrip.ts), so this never
   * stretches artwork to fill the taller cell.
   */
  private computeLayout(width: number, height: number) {
    // Frame chrome sized to read as a real mounted bezel (product owner:
    // V4's near-zero frame "went too far") while keeping the reel window at
    // ~94-96% of width (spec point 8) — sideW below keeps that ratio.
    const topBeam = Math.max(30, height * 0.065);
    const bottomBase = Math.max(14, height * 0.028);
    const sideW = Math.max(8, width * 0.026);
    // Without this, the frame bars + reel window tile the canvas 100% edge
    // to edge and the background layer (however richly it's built) is
    // NEVER actually visible — a real bug this pass found: V4's frame sat
    // flush against the canvas edges, so the "restore the machine
    // environment" background work would have had zero visible effect.
    // This margin is deliberately a hairline (not the ~40% dead space the
    // product owner rejected in V3, and thin enough to leave the reel
    // window's own width ratio — see below — inside spec) — just enough
    // that the radial vignette's teal-tinted corners read as "the cabinet
    // sits in a room" around the whole machine, without eating into the
    // width budget the thicker frame chrome below already spends.
    const outerMargin = Math.max(1.5, Math.min(width, height) * 0.004);
    const availW = Math.max(1, width - outerMargin * 2 - sideW * 2);
    const availH = Math.max(1, height - outerMargin * 2 - topBeam - bottomBase);
    const cellWidth = availW / this.reelsCount;
    const cellHeight = availH / this.rows;
    const reelWindowWidth = cellWidth * this.reelsCount;
    const reelWindowHeight = cellHeight * this.rows;
    const machineWidth = sideW * 2 + reelWindowWidth;
    const machineHeight = topBeam + reelWindowHeight + bottomBase;
    const machineX = (width - machineWidth) / 2;
    const machineY = outerMargin;
    const originX = machineX + sideW;
    const originY = machineY + topBeam;
    return {
      cellWidth,
      cellHeight,
      originX,
      originY,
      reelWindowWidth,
      reelWindowHeight,
      topBeam,
      bottomBase,
      sideW,
      machineX,
      machineY,
      machineWidth,
      machineHeight,
    };
  }

  private buildScene(width: number, height: number) {
    this.width = width;
    this.height = height;

    this.world = new Container();
    this.world.pivot.set(width / 2, height / 2);
    this.world.position.set(width / 2, height / 2);
    this.app.stage.addChild(this.world);

    // ---- 1. BACKGROUND: a calm, dark radial vignette with a hint of the
    // vault-teal accent at the edges — depth shading, not a painted scene
    // (see art/environmentAssets.ts for the real-art swap point). Still
    // deliberately the LEAST visually important layer (spec point 15). ----
    this.backgroundLayer = new Sprite(buildBackgroundTexture(width, height));
    this.backgroundLayer.width = width;
    this.backgroundLayer.height = height;
    this.world.addChild(this.backgroundLayer);

    // Ambient dust — always present, subtly brighter/faster once idle (see startTicker/tick).
    const dustLayer = new Container();
    dustLayer.eventMode = "none";
    for (let i = 0; i < 16; i++) {
      const s = new Sprite(getGlowTexture());
      s.anchor.set(0.5);
      s.tint = Math.random() > 0.5 ? 0xf2d98a : 0x8ef2e6;
      const size = 2 + Math.random() * 3.5;
      s.width = size;
      s.height = size;
      s.alpha = 0;
      s.x = Math.random() * width;
      s.y = Math.random() * height;
      dustLayer.addChild(s);
      this.dustSprites.push(s);
      this.dustState.push({ vx: (Math.random() - 0.5) * 0.06, vy: -0.05 - Math.random() * 0.09, phase: Math.random() * Math.PI * 2 });
    }
    this.world.addChild(dustLayer);

    const layout = this.computeLayout(width, height);
    this.cellWidth = layout.cellWidth;
    this.cellHeight = layout.cellHeight;
    this.winRect = { x: layout.originX, y: layout.originY, w: layout.reelWindowWidth, h: layout.reelWindowHeight };

    // ---- 2. MACHINE FRAME (behind): top beam / side columns / base as
    // flat gradient bars — drawn first so the reel backing + reels sit
    // visually "inside" them; the thin bezel stroke drawn LATER (after
    // symbols/win-fx/glass) is what actually overlaps the reel edges and
    // reads as "reels sit behind this art" (spec point 12). ----
    this.frameTop = new Sprite();
    this.frameLeft = new Sprite();
    this.frameRight = new Sprite();
    this.frameBase = new Sprite();
    this.frameHighlights = new Graphics();
    this.world.addChild(this.frameTop, this.frameLeft, this.frameRight, this.frameBase, this.frameHighlights);

    // ---- 3. REEL BACKGROUND: one continuous dark panel + vertical
    // gradient behind all 5 reels (spec point 13) — never per-symbol
    // cells. ----
    this.reelBacking = new Sprite();
    this.world.addChild(this.reelBacking);

    this.reelsContainer = new Container();
    this.reelsContainer.x = layout.originX;
    this.reelsContainer.y = layout.originY;
    this.world.addChild(this.reelsContainer);

    this.reels = [];
    for (let i = 0; i < this.reelsCount; i++) {
      const reel = new ReelStrip({ rows: this.rows, cellWidth: this.cellWidth, cellHeight: this.cellHeight, textures: this.textures });
      reel.container.x = i * this.cellWidth;
      this.reelsContainer.addChild(reel.container);
      this.reels.push(reel);
    }

    // ---- 4. REEL DIVIDERS: very subtle 1px lines between reels — the
    // ONLY separation between reels (spec point 1: no bordered cells). ----
    this.dividers = new Graphics();
    this.world.addChild(this.dividers);

    // ---- 5. Top/bottom shadow vignette inside the reel window — symbols
    // look like they're disappearing into the machine (spec point 13). ----
    this.topShadow = new Sprite();
    this.bottomShadow = new Sprite();
    this.world.addChild(this.topShadow, this.bottomShadow);

    // ---- 6. WIN FX (glow/trace/particles) ----
    this.win = new WinPresentation(this.cellWidth, this.cellHeight, this.rows);
    this.win.layer.x = layout.originX;
    this.win.layer.y = layout.originY;
    this.world.addChild(this.win.layer);

    // ---- 7. FOREGROUND GLASS: extremely subtle sheen, never obscuring. ----
    this.glassSheen = new Sprite(getGlowTexture());
    this.glassSheen.blendMode = "add";
    this.glassSheen.eventMode = "none";
    this.world.addChild(this.glassSheen);

    // ---- 8. Frame bezel (in front) — the thin trim line that overlaps
    // the reel window edges, the actual "frame in front of reels" depth
    // cue (spec point 12). ----
    this.frameBezel = new Graphics();
    this.frameAccentTop = new Graphics();
    this.world.addChild(this.frameBezel, this.frameAccentTop);

    this.drawFrame(width, height, layout);

    this.buildFsHud(width, layout);

    this.bonus = new FreeSpinsTransition(width, height, {
      onShake: (ms, amp) => this.shakeStage(ms, amp),
      onPush: (ms, amt) => this.cameraPushIn(amt, ms),
    });
    this.world.addChild(this.bonus.container);

    this.buildBigWinBanner(width, height);
  }

  /** (Re)draws every Graphics/gradient-Sprite frame/backing piece from the current layout — called on build and on every resize. Each piece is a simple flat fill or 2-3 stop gradient, never bolts/lights/reflections (see file header). */
  private drawFrame(width: number, height: number, layout: ReturnType<typeof this.computeLayout>) {
    const win = this.winRect;
    const metalDark = "#0e1118";
    const metalMid = "#1b202b";
    const metalLight = "#262d3a";

    this.frameTop.texture?.destroy(true);
    this.frameTop.texture = buildVerticalGradientTexture(layout.topBeam, [
      { offset: 0, color: metalMid },
      { offset: 0.85, color: metalDark },
      { offset: 1, color: "#080a0f" },
    ]);
    this.frameTop.width = layout.machineWidth;
    this.frameTop.height = layout.topBeam;
    this.frameTop.x = layout.machineX;
    this.frameTop.y = layout.machineY;

    const sideHeight = layout.topBeam + layout.reelWindowHeight + layout.bottomBase;
    this.frameLeft.texture?.destroy(true);
    this.frameLeft.texture = buildVerticalGradientTexture(sideHeight, [
      { offset: 0, color: metalLight },
      { offset: 0.5, color: metalMid },
      { offset: 1, color: metalDark },
    ]);
    this.frameLeft.width = layout.sideW;
    this.frameLeft.height = sideHeight;
    this.frameLeft.x = layout.machineX;
    this.frameLeft.y = layout.machineY;

    this.frameRight.texture?.destroy(true);
    this.frameRight.texture = this.frameLeft.texture;
    this.frameRight.width = layout.sideW;
    this.frameRight.height = sideHeight;
    this.frameRight.x = layout.machineX + layout.machineWidth - layout.sideW;
    this.frameRight.y = layout.machineY;

    this.frameBase.texture?.destroy(true);
    this.frameBase.texture = buildVerticalGradientTexture(Math.max(4, layout.bottomBase), [
      { offset: 0, color: "#080a0f" },
      { offset: 1, color: metalDark },
    ]);
    this.frameBase.width = layout.machineWidth;
    this.frameBase.height = Math.max(4, layout.bottomBase);
    this.frameBase.x = layout.machineX;
    this.frameBase.y = layout.machineY + layout.machineHeight - layout.bottomBase;

    // Thin bezel trim hugging the reel window — the only "line art" on the
    // frame, a single-color stroke, never a multi-bolt border.
    this.frameBezel.clear();
    this.frameBezel
      .roundRect(win.x, win.y, win.w, win.h, Math.min(win.w, win.h) * 0.015)
      .stroke({ width: Math.max(1.5, Math.min(width, height) * 0.003), color: 0x2dbfb0, alpha: 0.35 });

    // A faint gold accent rule under the top beam — the "machine indicator
    // light" this pass can afford: a plain line whose alpha breathes
    // slowly in tick() (spec point 19: "machine indicator lights breathe").
    const mx = layout.machineX;
    const my = layout.machineY;
    const mw = layout.machineWidth;
    const mh = layout.machineHeight;
    this.frameAccentTop.clear();
    this.frameAccentTop
      .moveTo(mx + layout.sideW, my + layout.topBeam - 1)
      .lineTo(mx + mw - layout.sideW, my + layout.topBeam - 1)
      .stroke({ width: 1.5, color: 0xd4af37, alpha: 0.4 });

    // Bevel highlight/shadow on each frame bar — the modest "real metal"
    // cue the product owner asked to restore: a bright 1-2px line where the
    // bar would catch light (its inner edge, facing the reel window) and a
    // faint dark line on its outer edge (in shadow). Plain strokes only —
    // no painted texture, no bolts/reflections.
    this.frameHighlights.clear();
    const hi = { width: 1.5, color: 0x4a5568, alpha: 0.55 };
    const lo = { width: 1.5, color: 0x000000, alpha: 0.4 };
    // Top beam: bright edge just above the reel window, dark edge at the very top of the machine.
    this.frameHighlights.moveTo(mx, my + layout.topBeam - 2.5).lineTo(mx + mw, my + layout.topBeam - 2.5).stroke(hi);
    this.frameHighlights.moveTo(mx, my + 1).lineTo(mx + mw, my + 1).stroke(lo);
    // Side columns: bright edge on the inner (reel-facing) side, dark edge on the outer side.
    this.frameHighlights
      .moveTo(mx + layout.sideW - 2, my + layout.topBeam)
      .lineTo(mx + layout.sideW - 2, my + layout.topBeam + layout.reelWindowHeight)
      .stroke(hi);
    this.frameHighlights.moveTo(mx + 1, my + layout.topBeam).lineTo(mx + 1, my + layout.topBeam + layout.reelWindowHeight).stroke(lo);
    this.frameHighlights
      .moveTo(mx + mw - layout.sideW + 2, my + layout.topBeam)
      .lineTo(mx + mw - layout.sideW + 2, my + layout.topBeam + layout.reelWindowHeight)
      .stroke(hi);
    this.frameHighlights
      .moveTo(mx + mw - 1, my + layout.topBeam)
      .lineTo(mx + mw - 1, my + layout.topBeam + layout.reelWindowHeight)
      .stroke(lo);
    // Base plate: bright edge just below the reel window, dark edge at the very bottom of the machine.
    this.frameHighlights
      .moveTo(mx, my + mh - layout.bottomBase + 2)
      .lineTo(mx + mw, my + mh - layout.bottomBase + 2)
      .stroke(hi);
    this.frameHighlights.moveTo(mx, my + mh - 1.5).lineTo(mx + mw, my + mh - 1.5).stroke(lo);
  }

  /** (Re)draws the reel backing panel + top/bottom shadow vignette + reel dividers from the current winRect. */
  private drawReelBacking() {
    const win = this.winRect;
    this.reelBacking.texture?.destroy(true);
    this.reelBacking.texture = buildVerticalGradientTexture(win.h, [
      { offset: 0, color: "#04050a" },
      { offset: 0.12, color: "#12151f" },
      { offset: 0.5, color: "#171b26" },
      { offset: 0.88, color: "#12151f" },
      { offset: 1, color: "#04050a" },
    ]);
    this.reelBacking.width = win.w;
    this.reelBacking.height = win.h;
    this.reelBacking.x = win.x;
    this.reelBacking.y = win.y;

    const shadowH = Math.max(6, win.h * 0.1);
    this.topShadow.texture?.destroy(true);
    this.topShadow.texture = buildVerticalGradientTexture(shadowH, [
      { offset: 0, color: "rgba(0,0,0,0.55)" },
      { offset: 1, color: "rgba(0,0,0,0)" },
    ]);
    this.topShadow.width = win.w;
    this.topShadow.height = shadowH;
    this.topShadow.x = win.x;
    this.topShadow.y = win.y;

    this.bottomShadow.texture?.destroy(true);
    this.bottomShadow.texture = buildVerticalGradientTexture(shadowH, [
      { offset: 0, color: "rgba(0,0,0,0)" },
      { offset: 1, color: "rgba(0,0,0,0.5)" },
    ]);
    this.bottomShadow.width = win.w;
    this.bottomShadow.height = shadowH;
    this.bottomShadow.x = win.x;
    this.bottomShadow.y = win.y + win.h - shadowH;

    // Reel dividers — faint 1px lines at each reel boundary (not around
    // symbols) plus a slightly stronger stroke around the whole window.
    this.dividers.clear();
    for (let i = 1; i < this.reelsCount; i++) {
      const x = win.x + i * this.cellWidth;
      this.dividers.moveTo(x, win.y).lineTo(x, win.y + win.h).stroke({ width: 1, color: 0xffffff, alpha: 0.06 });
    }

    // Foreground glass sheen: one soft, very low-alpha highlight in the
    // upper-left of the window — never cloudy, never covering symbols.
    this.glassSheen.width = win.w * 0.7;
    this.glassSheen.height = win.h * 0.55;
    this.glassSheen.x = win.x + win.w * 0.08;
    this.glassSheen.y = win.y - win.h * 0.05;
    this.glassSheen.alpha = 0.05;
  }

  /**
   * The BIG/MEGA/EPIC win takeover — built entirely in the PixiJS canvas,
   * NOT a DOM overlay. A translucent scrim dims the scene (reels stay
   * visible behind it), a large tier label pops in with a gold particle
   * burst, and the counting amount is pushed in imperatively
   * (setBigWinAmount) by the same React-owned count-up tween that drives
   * the small normal-win HUD.
   */
  private buildBigWinBanner(width: number, height: number) {
    this.bigWin = new Container();
    this.bigWin.visible = false;
    this.bigWin.eventMode = "none";

    this.bigWinScrim = new Graphics();
    this.bigWin.addChild(this.bigWinScrim);

    this.bigWinLabel = new Text({
      text: "BIG WIN",
      style: {
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontWeight: "900",
        fontSize: Math.max(30, width * 0.135),
        fill: 0xfff2c9,
        stroke: { color: 0x2a1a05, width: 6 },
        dropShadow: { color: 0xd4af37, blur: 22, distance: 0, alpha: 0.85 },
        align: "center",
      },
    });
    this.bigWinLabel.anchor.set(0.5);
    this.bigWin.addChild(this.bigWinLabel);

    this.bigWinAmount = new Text({
      text: "0.00 GC",
      style: {
        fontFamily: "'Courier New', monospace",
        fontWeight: "800",
        fontSize: Math.max(20, width * 0.088),
        fill: 0xffffff,
        stroke: { color: 0x0a0a0a, width: 4 },
        align: "center",
      },
    });
    this.bigWinAmount.anchor.set(0.5);
    this.bigWin.addChild(this.bigWinAmount);

    this.bigWinParticles = [];
    for (let i = 0; i < 28; i++) {
      const s = new Sprite(getGlowTexture());
      s.anchor.set(0.5);
      s.visible = false;
      this.bigWin.addChild(s);
      this.bigWinParticles.push({ g: s, vx: 0, vy: 0, life: 0, maxLife: 1, active: false });
    }

    this.positionBigWinBanner(width, height);
    this.world.addChild(this.bigWin);
  }

  private positionBigWinBanner(width: number, height: number) {
    this.bigWinScrim.clear().rect(0, 0, width, height).fill({ color: 0x03050a, alpha: 1 });
    this.bigWinLabel.style.fontSize = Math.max(30, width * 0.135);
    this.bigWinLabel.x = width / 2;
    this.bigWinLabel.y = height * 0.42;
    this.bigWinAmount.style.fontSize = Math.max(20, width * 0.088);
    this.bigWinAmount.x = width / 2;
    this.bigWinAmount.y = height * 0.42 + this.bigWinLabel.style.fontSize * 1.05;
  }

  private bigWinTierColor(tier: "big" | "mega" | "epic"): number {
    return tier === "epic" ? 0xffb347 : tier === "mega" ? 0xff5ec4 : 0xd4af37;
  }

  async showBigWinBanner(label: string, tier: "big" | "mega" | "epic"): Promise<void> {
    const color = this.bigWinTierColor(tier);
    this.bigWinLabel.text = label;
    this.bigWinLabel.style.fill = color;
    this.bigWinLabel.scale.set(0.6);
    this.bigWinLabel.alpha = 0;
    this.bigWinAmount.alpha = 0;
    this.bigWin.visible = true;
    this.bigWin.alpha = 1;

    this.spawnBigWinBurst(color, tier === "epic" ? 28 : tier === "mega" ? 22 : 16);
    if (!this.bigWinRaf) this.startBigWinParticleLoop();

    await Promise.all([
      tween(260, (p) => {
        this.bigWinScrim.alpha = p * 0.55;
      }),
      tween(420, (p) => {
        const e = easeOutBack(Math.min(1, p * 1.15));
        this.bigWinLabel.alpha = Math.min(1, p * 1.6);
        this.bigWinLabel.scale.set(0.6 + 0.4 * e);
      }),
    ]);
    await tween(220, (p) => {
      this.bigWinAmount.alpha = Math.min(1, p * 1.4);
    });
  }

  setBigWinAmount(text: string) {
    this.bigWinAmount.text = text;
  }

  /** NORMAL-tier win amount readout, rendered inside the canvas at the bottom of the reel window — see WinPresentation.setAmount's comment for why this replaced a DOM overlay. */
  setNormalWinAmount(text: string) {
    this.win.setAmount(text, this.winRect.w);
  }

  hideNormalWinAmount() {
    this.win.hideAmount();
  }

  async hideBigWinBanner(): Promise<void> {
    if (!this.bigWin.visible) return;
    await tween(320, (p) => {
      const fade = 1 - p;
      this.bigWinScrim.alpha = 0.55 * fade;
      this.bigWinLabel.alpha = fade;
      this.bigWinAmount.alpha = fade;
    });
    this.bigWin.visible = false;
  }

  private spawnBigWinBurst(color: number, count: number) {
    const cx = this.bigWinLabel.x;
    const cy = this.bigWinLabel.y + 10;
    let spawned = 0;
    for (const p of this.bigWinParticles) {
      if (p.active) continue;
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 3.5;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed - 1.6;
      p.life = 0;
      p.maxLife = 45 + Math.random() * 30;
      p.active = true;
      p.g.visible = true;
      p.g.tint = color;
      const size = 4 + Math.random() * 5;
      p.g.width = size;
      p.g.height = size;
      p.g.x = cx;
      p.g.y = cy;
      p.g.alpha = 1;
      spawned++;
      if (spawned >= count) break;
    }
  }

  private startBigWinParticleLoop() {
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(32, now - last) / 16.6667;
      last = now;
      let any = false;
      for (const p of this.bigWinParticles) {
        if (!p.active) continue;
        any = true;
        p.life += dt;
        p.vy += 0.13 * dt;
        p.g.x += p.vx * dt;
        p.g.y += p.vy * dt;
        p.g.alpha = Math.max(0, 1 - p.life / p.maxLife);
        if (p.life >= p.maxLife) {
          p.active = false;
          p.g.visible = false;
        }
      }
      this.bigWinRaf = any ? requestAnimationFrame(step) : 0;
    };
    this.bigWinRaf = requestAnimationFrame(step);
  }

  private fsHudMetrics(width: number) {
    const spinsX = width * 0.04;
    const spinsW = width * 0.36;
    const gap = width * 0.03;
    const multX = spinsX + spinsW + gap;
    const multW = width * 0.96 - multX;
    return { spinsX, spinsW, multX, multW };
  }

  private buildFsHud(width: number, layout: ReturnType<typeof this.computeLayout>) {
    this.fsHud = new Container();
    this.fsHud.visible = false;
    this.fsHud.y = layout.machineY + layout.topBeam * 0.5;

    this.fsHudPlate = new Graphics();
    this.fsHud.addChild(this.fsHudPlate);

    const m = this.fsHudMetrics(width);
    const gearSize = layout.topBeam * 0.6;
    this.fsHudGear = new Graphics();
    drawGear(this.fsHudGear, Math.max(8, gearSize / 2));
    this.fsHudGear.x = m.multX + gearSize * 0.62;
    this.fsHud.addChild(this.fsHudGear);

    this.fsHudSpinsText = new Text({
      text: "FREE SPINS 0/0",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontWeight: "800",
        fontSize: Math.max(9, layout.topBeam * 0.26),
        fill: 0x9af2e6,
        letterSpacing: 0.5,
      },
    });
    this.fsHudSpinsText.anchor.set(0, 0.5);
    this.fsHudSpinsText.x = m.spinsX + 10;
    this.fsHud.addChild(this.fsHudSpinsText);

    this.fsHudMultText = new Text({
      text: "MULTIPLIER 1x",
      style: {
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontWeight: "800",
        fontSize: Math.max(11, layout.topBeam * 0.28),
        fill: 0xfff2c9,
        stroke: { color: 0x2a1a05, width: 3 },
      },
    });
    this.fsHudMultText.anchor.set(0, 0.5);
    this.fsHudMultText.x = m.multX + gearSize * 1.15;
    this.fsHud.addChild(this.fsHudMultText);

    this.world.addChild(this.fsHud);
    this.drawFsHudPlate(width, layout.topBeam);
  }

  private drawFsHudPlate(width: number, topBeam: number) {
    this.fsHudPlate.clear();
    const h = topBeam * 0.72;
    const y = -h / 2;
    const m = this.fsHudMetrics(width);
    const draw = (x: number, w: number) => {
      const g = this.fsHudPlate;
      g.roundRect(x, y, w, h, h * 0.22).fill({ color: 0x0d1120, alpha: 0.6 });
      g.roundRect(x, y, w, h, h * 0.22).stroke({ width: 1.5, color: 0x2dbfb0, alpha: 0.5 });
    };
    draw(m.spinsX, m.spinsW);
    draw(m.multX, m.multW);
  }

  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    this.app.renderer.resize(width, height);
    this.width = width;
    this.height = height;

    this.world.pivot.set(width / 2, height / 2);
    this.world.position.set(width / 2, height / 2);

    this.backgroundLayer.texture.destroy(true);
    this.backgroundLayer.texture = buildBackgroundTexture(width, height);
    this.backgroundLayer.width = width;
    this.backgroundLayer.height = height;

    const layout = this.computeLayout(width, height);
    this.cellWidth = layout.cellWidth;
    this.cellHeight = layout.cellHeight;

    this.reelsContainer.x = layout.originX;
    this.reelsContainer.y = layout.originY;
    this.reels.forEach((reel, i) => {
      reel.resize(this.cellWidth, this.cellHeight);
      reel.container.x = i * this.cellWidth;
    });

    this.win.resize(this.cellWidth, this.cellHeight);
    this.win.layer.x = layout.originX;
    this.win.layer.y = layout.originY;

    this.winRect = { x: layout.originX, y: layout.originY, w: layout.reelWindowWidth, h: layout.reelWindowHeight };
    this.drawFrame(width, height, layout);
    this.drawReelBacking();

    const fsm = this.fsHudMetrics(width);
    const gearSize = layout.topBeam * 0.6;
    this.fsHud.y = layout.machineY + layout.topBeam * 0.5;
    drawGear(this.fsHudGear, Math.max(8, gearSize / 2));
    this.fsHudGear.x = fsm.multX + gearSize * 0.62;
    this.fsHudMultText.x = fsm.multX + gearSize * 1.15;
    this.fsHudSpinsText.x = fsm.spinsX + 10;
    this.drawFsHudPlate(width, layout.topBeam);

    this.bonus.resize(width, height);
    this.positionBigWinBanner(width, height);
  }

  /** The reel window's px size, in CSS pixels — used by the React shell to size overlay HUD elements. */
  get reelWindowRect() {
    return {
      x: this.reelsContainer.x,
      y: this.reelsContainer.y,
      width: this.cellWidth * this.reelsCount,
      height: this.cellHeight * this.rows,
    };
  }

  // ---- Idle ambience: never a fully frozen screen when nobody is spinning ----

  setIdle(active: boolean) {
    this.idle = active;
  }

  private startTicker() {
    // Reel backing/dividers/shadows depend on winRect, computed inside
    // buildScene before this runs — draw them once up front here (not in
    // buildScene directly) so the very first frame already shows the full
    // layered surface, not a flash of missing backing.
    this.drawReelBacking();
    this.tickerFn = ({ deltaMS }: { deltaMS: number }) => this.tick(deltaMS);
    this.app.ticker.add(this.tickerFn as any);
  }

  private tick(deltaMS: number) {
    const dt = deltaMS / 1000;

    const targetDustAlpha = this.idle ? 0.5 : 0.16;
    for (let i = 0; i < this.dustSprites.length; i++) {
      const s = this.dustSprites[i];
      const st = this.dustState[i];
      s.x += st.vx * dt * 60;
      s.y += st.vy * dt * 60;
      st.phase += dt * 0.6;
      if (s.y < -10) s.y = this.height + 10;
      if (s.x < -10) s.x = this.width + 10;
      if (s.x > this.width + 10) s.x = -10;
      const twinkle = 0.5 + Math.sin(st.phase) * 0.5;
      s.alpha += (targetDustAlpha * twinkle - s.alpha) * Math.min(1, dt * 2);
    }

    if (!this.idle) return;
    this.idleElapsed += dt;

    // Machine indicator light: the gold accent rule under the top beam
    // breathes slowly (spec point 19).
    this.frameAccentTop.alpha = 0.4 + Math.sin(this.idleElapsed * 0.8) * 0.25;

    // WILD pulses gently; SCATTER gets a slightly stronger idle presence
    // per spec points 27/28 ("WILD: most idle/attention animation of any
    // symbol", "SCATTER: stronger idle pulse than paying symbols"). Uses
    // ReelStrip.setIdlePulse (a multiplier applied ON TOP of the correct
    // fit-box size), never a raw sprite.scale.set — see that method's
    // comment for the exact bug this replaced (idle WILD/SCATTER symbols
    // ballooning toward native 1024px texture size).
    const wildPulse = 1 + Math.abs(Math.sin(this.idleElapsed * 0.9)) * 0.06;
    const scatterPulse = 1 + Math.abs(Math.sin(this.idleElapsed * 0.7)) * 0.045;
    this.reels.forEach((reel) => {
      const col = reel.currentColumn();
      col.forEach((id, row) => {
        const factor = id === "WILD" ? wildPulse : id === "SCATTER" ? scatterPulse : 1;
        reel.setIdlePulse(row, factor);
      });
      reel.refresh();
    });
  }

  async spinToResult(grid: SlotSymbolId[][], opts: SpinPresentationOptions): Promise<void> {
    this.win.clear();
    this.clearAnticipationGlows();
    this.resetIdleScale();

    const scatterReels: number[] = [];
    grid.forEach((col, i) => {
      if (col.includes("SCATTER")) scatterReels.push(i);
    });
    const anticipationReels = new Set<number>();
    if (scatterReels.length >= opts.minScatterCount) {
      scatterReels.slice(2).forEach((i) => anticipationReels.add(i));
    }

    const promises = grid.map((col, i) => {
      const anticipation = anticipationReels.has(i);
      const personality = REEL_PERSONALITY[i % REEL_PERSONALITY.length];
      const fillerCount = Math.round(12 * (personality.duration / REEL_PERSONALITY[0].duration));
      return this.reels[i]
        .spin(col, {
          personality,
          fillerCount,
          anticipationHoldMs: anticipation ? ANTICIPATION_HOLD_MS : 0,
          onHoldStart: anticipation
            ? () => {
                opts.onAnticipationStart?.(i);
                this.startAnticipationGlow(i, ANTICIPATION_HOLD_MS);
              }
            : undefined,
        })
        .then(() => opts.onReelStop?.(i));
    });

    await Promise.all(promises);
  }

  private resetIdleScale() {
    this.reels.forEach((reel) => {
      for (let row = 0; row < this.rows; row++) reel.setIdlePulse(row, 1);
      reel.refresh();
    });
  }

  private startAnticipationGlow(reelIndex: number, durationMs: number) {
    const g = new Sprite(getGlowTexture());
    g.anchor.set(0.5);
    g.blendMode = "add";
    g.tint = 0xd4af37;
    g.width = this.cellWidth * 1.7;
    g.height = this.cellHeight * this.rows * 1.25;
    g.x = this.reelsContainer.x + reelIndex * this.cellWidth + this.cellWidth / 2;
    g.y = this.reelsContainer.y + (this.cellHeight * this.rows) / 2;
    this.world.addChildAt(g, this.world.getChildIndex(this.reelsContainer));
    this.anticipationGlows.set(reelIndex, g);
    const t = tween(durationMs, (p) => {
      g.alpha = 0.28 + Math.abs(Math.sin(p * Math.PI * 5)) * 0.5;
    });
    t.then(() => {
      if (this.anticipationGlows.get(reelIndex) === g) {
        g.destroy();
        this.anticipationGlows.delete(reelIndex);
      }
    });

    this.anticipationDim++;
    if (this.anticipationDim === 1) {
      this.reels.forEach((reel, idx) => {
        if (!this.anticipationGlows.has(idx) && idx !== reelIndex) {
          tween(200, (p) => {
            reel.container.alpha = 1 - p * 0.45;
          });
        }
      });
    }
    t.then(() => {
      this.anticipationDim--;
      if (this.anticipationDim === 0) {
        this.reels.forEach((reel) => {
          tween(250, (p) => {
            reel.container.alpha = 0.55 + p * 0.45;
          });
        });
      }
    });
  }

  private clearAnticipationGlows() {
    this.anticipationGlows.forEach((g) => g.destroy());
    this.anticipationGlows.clear();
    this.anticipationDim = 0;
    this.reels.forEach((reel) => (reel.container.alpha = 1));
  }

  pulseScatterLand(count: number) {
    if (count <= 0) return;
    if (count === 1) this.shakeStage(120, 2);
    else this.shakeStage(180, 4 + count);
  }

  celebrateWin(wins: SlotPaylineWin[], tier: WinTier) {
    this.win.celebrate(this.reels, wins, tier);
    if (tier === "big") this.cameraPushIn(0.035, 260);
    else if (tier === "mega") this.cameraPushIn(0.06, 320);
    else if (tier === "epic") this.cameraPushIn(0.09, 380);
  }

  clearWin() {
    this.win.clear();
    this.reels.forEach((reel) => {
      for (let row = 0; row < this.rows; row++) reel.spriteForRow(row).alpha = 1;
    });
  }

  /** Free-spins environment cue — OUT OF SCOPE for visual polish this pass (spec points 31-32): a subtle warm tint over the reel backing, not a full photo/environment swap (no such art exists yet). */
  async setFreeSpinsEnvironment(active: boolean): Promise<void> {
    if (this.freeSpinsActive === active) return;
    this.freeSpinsActive = active;
    this.reelBacking.tint = active ? 0xffe4b8 : 0xffffff;
    this.frameAccentTop.tint = active ? 0xffcf8a : 0xffffff;
  }

  setFreeSpinsHud(info: FreeSpinsHudInfo | null) {
    if (!info) {
      this.fsHud.visible = false;
      this.lastHudMultiplier = 0;
      return;
    }
    this.fsHud.visible = true;
    this.fsHudSpinsText.text = `FREE SPINS ${info.index}/${info.total}`;
    this.fsHudMultText.text = `MULTIPLIER ${info.multiplier}x`;
    if (this.lastHudMultiplier && info.multiplier > this.lastHudMultiplier) {
      this.pulseMultiplierIncrease();
    }
    this.lastHudMultiplier = info.multiplier;
  }

  private pulseMultiplierIncrease() {
    const startRotation = this.fsHudGear.rotation;
    tween(420, (p) => {
      this.fsHudGear.rotation = startRotation + p * (Math.PI / 3);
    });
    tween(320, (p) => {
      const flip = p < 0.5 ? 1 - p * 2 : (p - 0.5) * 2;
      this.fsHudMultText.scale.y = Math.max(0.08, flip);
      this.fsHudMultText.tint = p < 0.55 ? 0xfff8d8 : 0xffffff;
      if (p > 0.48 && p < 0.56) this.fsHudMultText.scale.x = 1.12;
      else this.fsHudMultText.scale.x = 1;
    });
  }

  shakeStage(durationMs: number, amplitude: number): Promise<void> {
    const baseX = this.width / 2;
    const baseY = this.height / 2;
    return tween(durationMs, (p) => {
      const decay = 1 - p;
      this.world.position.x = baseX + (Math.random() - 0.5) * amplitude * decay;
      this.world.position.y = baseY + (Math.random() - 0.5) * amplitude * decay;
    }).then(() => {
      this.world.position.set(baseX, baseY);
    });
  }

  cameraPushIn(strength: number, durationMs = 300): Promise<void> {
    return tween(durationMs, (p) => {
      const s = 1 + Math.sin(Math.min(1, p) * Math.PI) * strength;
      this.world.scale.set(s);
    }).then(() => {
      this.world.scale.set(1);
    });
  }

  async playBonusTransition(spinsAwarded: number, callbacks: BonusTransitionCallbacks = {}): Promise<void> {
    this.bonus.setCallbacks(callbacks);
    await this.bonus.play(spinsAwarded);
  }

  destroy() {
    if (this.tickerFn) this.app.ticker.remove(this.tickerFn as any);
    if (this.bigWinRaf) cancelAnimationFrame(this.bigWinRaf);
    this.clearAnticipationGlows();
    this.reels.forEach((r) => r.destroy());
    this.win.destroy();
    this.bonus.destroy();
    // Destroy only the per-instance-generated gradient textures (drawn
    // fresh per mount/resize) — NOT `texture: true` on app.destroy(), which
    // would also tear down the shared, module-cached symbol/glow textures
    // (see symbolAssets.ts/fx.ts) that a future remount of this same game
    // reuses.
    this.backgroundLayer.texture.destroy(true);
    this.frameTop.texture?.destroy(true);
    this.frameLeft.texture?.destroy(true);
    this.frameBase.texture?.destroy(true);
    this.reelBacking.texture?.destroy(true);
    this.topShadow.texture?.destroy(true);
    this.bottomShadow.texture?.destroy(true);
    this.app.destroy(true, { children: true, texture: false });
  }
}
