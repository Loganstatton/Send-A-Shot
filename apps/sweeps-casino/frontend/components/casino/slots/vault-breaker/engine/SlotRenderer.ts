"use client";

// Top-level Pixi orchestrator — REBUILD (V4), real-art + environment depth
// pass (V5), LOCKED MASTER COMPOSITION pass (V6). Owns the Application/
// stage lifecycle and layers the whole game surface as ONE continuous
// PixiJS scene: BACKGROUND -> ambient glows -> LOGO LOCKUP -> MACHINE FRAME
// (behind) -> REEL BACKGROUND -> SYMBOL SPRITES -> REEL DIVIDERS -> WIN FX
// -> FOREGROUND GLASS -> MACHINE FRAME (bolts/LED/bezel, in front, creating
// depth) -> TAGLINE PLATE -> HUD/overlays. React never touches Pixi objects
// directly — this class is the only bridge (VaultBreakerGame.tsx drives it
// through this small imperative API: spinToResult, celebrateWin,
// playBonusTransition, etc).
//
// V6 NOTES — this pass's brief was narrow and literal: reproduce
// design-ref/master-v1.png (a locked, full-screen composition the product
// owner mocked up after five rounds of prose-only art direction produced
// five different guesses instead of convergence), not to invent a new
// interpretation. Concretely, vs V5:
//  - The background is now the REAL illustrated vault-chamber photo at
//    public/games/vault-breaker/backgrounds/base-game.jpg (it existed all
//    along — V5's file-header comment claiming "no real background art
//    exists yet" was simply wrong), cover-fit and anchored on the vault
//    door via BACKGROUND_FOCAL_X/Y, with a few soft additive glow sprites
//    (teal side light, warm gold lower glow) and a dark top/bottom vignette
//    layered on top for legibility — see buildBackground().
//  - computeLayout() now reserves a real LOGO AREA above the machine
//    (~35% of this canvas's height, matching the reference's logo:machine
//    ratio) instead of letting the reel window eat ~90% of the vertical
//    budget — see buildLogoLockup(). The frame is thicker, with gold-trim
//    gradient stops, drawn corner bolts, and teal LED accent strips (see
//    drawFrame()), and a tagline plate now sits between the reel window and
//    this canvas's bottom edge (see buildTaglinePlate()) — the control deck
//    itself is DOM (VaultBreakerGame.tsx), immediately below this canvas.
//  - Every layer is still its own Container/Sprite/Graphics in a clearly-
//    named slot, so a future real-art frame PNG can replace a Graphics fill
//    in that same slot with zero changes to layout/z-order/animation code.
//  - The reel VIEWPORT is still one continuous surface: a single dark
//    backing panel + subtle vertical gradient behind all 5 reels, with only
//    faint 1px dividers between reels — never 20 bordered/boxed cells.
import { Application, Assets, Container, FillGradient, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { SlotPaylineWin, SlotSymbolId } from "@/lib/types";
import { buildSymbolTextures } from "../art/symbolAssets";
import { BACKGROUND_ART_URL, BACKGROUND_FOCAL_X, BACKGROUND_FOCAL_Y } from "../art/environmentAssets";
import { buildVerticalGradientTexture, buildRadialVignetteTexture, getGlowTexture } from "../art/fx";
import { ReelStrip } from "./ReelStrip";
import { WinPresentation, type WinTier } from "./WinPresentation";
import { FreeSpinsTransition } from "./FreeSpinsTransition";
import { easeOutBack, reelStartDelayMs, scaleForTurbo, tween, REEL_PERSONALITY } from "./animUtils";

const ANTICIPATION_HOLD_MS = 650;

export interface SpinPresentationOptions {
  minScatterCount: number;
  onReelStop?: (index: number) => void;
  onAnticipationStart?: (index: number) => void;
  /** Turbo mode: faster spin, shorter stagger, reduced overshoot (see animUtils.scaleForTurbo/reelStartDelayMs). Defaults to false. */
  turbo?: boolean;
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
 * A dark top/bottom vignette drawn OVER the real background photo — keeps
 * the logo lockup and the machine frame's top/bottom edges legible against
 * whatever brightness the photo happens to have at that point, without
 * hiding the vault-chamber environment underneath it (depth shading, not a
 * cover-up: alpha stays modest at the very top/bottom and is fully
 * transparent through the middle third).
 */
function buildBackgroundVignetteTexture(width: number, height: number): Texture {
  return buildRadialVignetteTexture(
    width,
    height,
    [
      { offset: 0, color: "rgba(5,7,12,0)" },
      { offset: 0.62, color: "rgba(5,7,12,0.1)" },
      { offset: 1, color: "rgba(3,5,9,0.55)" },
    ],
    0.5
  );
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
  private backgroundTexture: Texture;
  private backgroundVignette!: Sprite;
  /** Soft additive ambient glow sprites over the background photo — teal at the left/right edges, warm gold low in the frame (spec item 1). Built once in buildBackground(), repositioned on resize. */
  private ambientGlows: Sprite[] = [];
  private logoLockup!: Container;
  private logoTitle!: Text;
  private logoSubtitlePlate!: Graphics;
  private logoSubtitleText!: Text;
  private logoTaglineLeft!: Text;
  private logoTaglineRight!: Text;
  private logoDoorGlow!: Sprite;
  private taglinePlate!: Container;
  private taglinePlateBg!: Graphics;
  private taglinePlateText!: Text;
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
  /** Corner bolts drawn on top of the frame bars (spec item 3) — a separate Graphics layer so it can be redrawn independently on resize without touching the bevel highlights above. */
  private frameHardware!: Graphics;
  /** Teal LED accent strips running down the inner edge of each side column (spec item 3) — additive glow Sprites (not part of frameHardware) so their alpha can breathe independently in tick(). */
  private ledStripLeft!: Sprite;
  private ledStripRight!: Sprite;

  private anticipationGlows = new Map<number, Sprite>();
  private anticipationDim = 0;
  /** Pulsing border around the whole reel viewport, drawn whenever 2+ scatters are already showing and at least one reel is still spinning (ported from the reference demo's anticipation border) — distinct from the per-reel gold glow above, which highlights the specific still-spinning column. */
  private anticipationBorder!: Graphics;
  private anticipationBorderActive = false;
  private anticipationBorderElapsed = 0;
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
  private bigWinBloom!: Sprite;
  private bigWinLabel!: Text;
  private bigWinAmount!: Text;
  private bigWinParticles: { g: Sprite; vx: number; vy: number; life: number; maxLife: number; active: boolean }[] = [];
  private bigWinRaf = 0;
  /** The label's continuous scale/glow "breathe" while a BIG/MEGA/EPIC banner is held on screen (spec item 8: "animated typography... not a static banner sprite") — started in showBigWinBanner, cancelled in hideBigWinBanner. */
  private bigWinPulse: { cancel: () => void } | null = null;
  private winRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private freeSpinsActive = false;

  // ---- idle ambience ----
  private idle = false;
  private idleElapsed = 0;
  /** Always-advancing (not idle-gated) seconds counter driving the teal LED strips' breathing (spec item 3/19: machine indicator lights stay alive even mid-spin). */
  private ambientElapsed = 0;
  private dustSprites: Sprite[] = [];
  private dustState: { vx: number; vy: number; phase: number }[] = [];
  private tickerFn: ((ticker: { deltaMS: number }) => void) | null = null;

  private constructor(
    app: Application,
    reelsCount: number,
    rows: number,
    textures: Record<SlotSymbolId, Texture>,
    backgroundTexture: Texture
  ) {
    this.app = app;
    this.reelsCount = reelsCount;
    this.rows = rows;
    this.textures = textures;
    this.backgroundTexture = backgroundTexture;
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

    // Real symbol textures, plus the real background vault-chamber photo
    // (see art/environmentAssets.ts) — the two image-asset sources this
    // renderer loads. Frame/reel-backing chrome is still generated
    // Graphics/gradients (see drawFrame/drawReelBacking below); no
    // dedicated frame PNGs exist yet.
    Assets.add({ alias: "vb-background", src: BACKGROUND_ART_URL });
    const [textures, backgroundTexture] = await Promise.all([
      buildSymbolTextures(),
      Assets.load<Texture>("vb-background"),
    ]);

    const renderer = new SlotRenderer(app, opts.reels, opts.rows, textures, backgroundTexture);
    renderer.buildScene(opts.width, opts.height);
    renderer.startTicker();
    return renderer;
  }

  /**
   * V6: matches the locked master reference's vertical proportions instead
   * of letting the reel window eat the full canvas height. This PixiJS
   * canvas IS the reference's "logo lockup" (~24% of the full phone
   * screen) + "machine" (~40%) bands combined — the topbar (~5%) is DOM
   * above it and the control deck (~15%) is DOM below it (see
   * VaultBreakerGame.tsx) — so within this canvas alone those two bands are
   * ~24:40, i.e. logo ≈ 37.5% of THIS canvas's height, machine ≈ the rest.
   * LOGO_AREA_FRACTION below is that ratio, clamped so it never crowds out
   * the reel window on an unusually short viewport.
   *
   * The reel window still fills ~94-96% of the available WIDTH (never just
   * a slice), and cells are NOT forced square: cellWidth = availW/reels,
   * cellHeight = availH/rows independently — on a portrait phone this
   * still makes rows a bit taller than wide, matching the reference's own
   * cell proportions far more closely than V5's near-full-height reel
   * window did (which is the actual root cause V5 mis-solved: symbols
   * looked small/adrift not because FILL was too low, but because the
   * cells themselves were far taller than the reference's).
   */
  private computeLayout(width: number, height: number) {
    const LOGO_AREA_FRACTION = 0.36;
    const logoAreaH = Math.max(height * 0.24, Math.min(height * 0.46, height * LOGO_AREA_FRACTION));
    const machineBlockH = Math.max(1, height - logoAreaH);

    // Frame chrome thick enough to carry corner bolts + a visible gold-trim
    // gradient + a teal LED strip (spec item 3) while the reel window still
    // keeps ~94-96% of the WIDTH budget (sideW below is a width fraction,
    // unrelated to the vertical logoAreaH split above).
    const topBeam = Math.max(30, machineBlockH * 0.115);
    const bottomBase = Math.max(12, machineBlockH * 0.045);
    const taglineH = Math.max(22, machineBlockH * 0.11);
    const sideW = Math.max(9, width * 0.032);
    // Hairline outer margin so the background photo's own edges (and the
    // side glow sprites) stay visible framing the machine, never the frame
    // sitting flush against the canvas edge.
    const outerMargin = Math.max(1.5, Math.min(width, height) * 0.004);

    const availW = Math.max(1, width - outerMargin * 2 - sideW * 2);
    const reelWindowHeight = Math.max(1, machineBlockH - topBeam - bottomBase - taglineH);
    const cellWidth = availW / this.reelsCount;
    const cellHeight = reelWindowHeight / this.rows;
    const reelWindowWidth = cellWidth * this.reelsCount;
    const machineWidth = sideW * 2 + reelWindowWidth;
    const machineHeight = topBeam + reelWindowHeight + bottomBase + taglineH;
    const machineX = (width - machineWidth) / 2;
    // Bottom-anchored: the machine's own bottom edge (tagline plate) sits
    // right where this canvas hands off to the DOM control deck below it.
    const machineY = height - machineHeight;
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
      taglineH,
      sideW,
      machineX,
      machineY,
      machineWidth,
      machineHeight,
      logoAreaH,
    };
  }

  private buildScene(width: number, height: number) {
    this.width = width;
    this.height = height;

    this.world = new Container();
    this.world.pivot.set(width / 2, height / 2);
    this.world.position.set(width / 2, height / 2);
    this.app.stage.addChild(this.world);

    // ---- 1. BACKGROUND: the real illustrated vault-chamber photo
    // (cover-fit, anchored on the vault door), a dark top/bottom vignette
    // for legibility, and a few soft additive ambient glow sprites (teal
    // side-lighting, warm gold lower glow) — see buildBackground(). ----
    this.buildBackground(width, height);

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

    // ---- LOGO LOCKUP: title treatment + subtitle + side taglines, filling
    // the area above the machine (spec item 2) — see buildLogoLockup(). ----
    this.buildLogoLockup(width, layout);

    // ---- 2. MACHINE FRAME (behind): top beam / side columns / base as
    // gold-trimmed gradient bars — drawn first so the reel backing + reels
    // sit visually "inside" them; the thin bezel stroke drawn LATER (after
    // symbols/win-fx/glass) is what actually overlaps the reel edges and
    // reads as "reels sit behind this art" (spec point 12). frameHardware
    // (corner bolts + teal LED strips, spec item 3) is a separate Graphics
    // drawn on top of the bars but still behind the reel window. ----
    this.frameTop = new Sprite();
    this.frameLeft = new Sprite();
    this.frameRight = new Sprite();
    this.frameBase = new Sprite();
    this.frameHighlights = new Graphics();
    this.frameHardware = new Graphics();
    this.ledStripLeft = new Sprite(getGlowTexture());
    this.ledStripRight = new Sprite(getGlowTexture());
    this.ledStripLeft.anchor.set(0.5);
    this.ledStripRight.anchor.set(0.5);
    this.ledStripLeft.blendMode = "add";
    this.ledStripRight.blendMode = "add";
    this.ledStripLeft.tint = 0x2dbfb0;
    this.ledStripRight.tint = 0x2dbfb0;
    this.world.addChild(
      this.frameTop,
      this.frameLeft,
      this.frameRight,
      this.frameBase,
      this.frameHighlights,
      this.frameHardware,
      this.ledStripLeft,
      this.ledStripRight
    );

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

    // ---- 9. Anticipation border: hidden by default, drawn on top of
    // everything else in the reel window's immediate area so its pulse
    // reads clearly even against the reel backing/frame. ----
    this.anticipationBorder = new Graphics();
    this.anticipationBorder.visible = false;
    this.anticipationBorder.eventMode = "none";
    this.world.addChild(this.anticipationBorder);
    this.drawAnticipationBorder();

    this.drawFrame(width, height, layout);

    // ---- TAGLINE PLATE: mounted directly beneath the reel window, part of
    // the machine housing (spec item 4) — see buildTaglinePlate(). ----
    this.buildTaglinePlate(width, layout);

    this.buildFsHud(width, layout);

    this.bonus = new FreeSpinsTransition(width, height, {
      onShake: (ms, amp) => this.shakeStage(ms, amp),
      onPush: (ms, amt) => this.cameraPushIn(amt, ms),
    });
    this.world.addChild(this.bonus.container);

    this.buildBigWinBanner(width, height);
  }

  /**
   * Background: the real vault-chamber photo (cover-fit, anchored on the
   * vault door per BACKGROUND_FOCAL_X/Y), a dark top/bottom vignette for
   * text legibility, and a handful of soft additive glow sprites — teal at
   * the left/right edges (echoing the reference's side-lit steel corridor),
   * warm gold low in the frame (echoing its lower gold-bar lighting). This
   * is the ONLY place BACKGROUND_ART_URL's texture is consumed.
   */
  private buildBackground(width: number, height: number) {
    this.backgroundLayer = new Sprite(this.backgroundTexture);
    this.backgroundLayer.eventMode = "none";
    this.world.addChild(this.backgroundLayer);

    this.backgroundVignette = new Sprite(buildBackgroundVignetteTexture(width, height));
    this.backgroundVignette.eventMode = "none";
    this.world.addChild(this.backgroundVignette);

    const glowSpecs: { tint: number; wRatio: number; hRatio: number; xRatio: number; yRatio: number; alpha: number }[] = [
      // Teal side-lighting, left + right — echoes the reference's teal LED-lit corridor walls.
      { tint: 0x2dbfb0, wRatio: 0.55, hRatio: 0.7, xRatio: 0.02, yRatio: 0.3, alpha: 0.22 },
      { tint: 0x2dbfb0, wRatio: 0.55, hRatio: 0.7, xRatio: 0.98, yRatio: 0.3, alpha: 0.22 },
      // Warm gold glow low in the frame — echoes the reference's gold-bar-pile lighting.
      { tint: 0xd4af37, wRatio: 0.95, hRatio: 0.42, xRatio: 0.5, yRatio: 0.92, alpha: 0.2 },
    ];
    this.ambientGlows = glowSpecs.map((spec) => {
      const s = new Sprite(getGlowTexture());
      s.anchor.set(0.5);
      s.blendMode = "add";
      s.tint = spec.tint;
      s.alpha = spec.alpha;
      s.eventMode = "none";
      this.world.addChild(s);
      return s;
    });
    this.positionBackground(width, height);
  }

  /** Sizes/positions the background photo (cover-fit + focal anchor), vignette, and ambient glow sprites — called on build and on every resize. */
  private positionBackground(width: number, height: number) {
    const photoAspect = this.backgroundTexture.width / this.backgroundTexture.height;
    const canvasAspect = width / height;
    let spriteW: number;
    let spriteH: number;
    if (photoAspect > canvasAspect) {
      // Photo is relatively wider than the canvas — cover by matching
      // height, letting width overflow (then cropped via focal-point x).
      spriteH = height;
      spriteW = height * photoAspect;
    } else {
      spriteW = width;
      spriteH = width / photoAspect;
    }
    this.backgroundLayer.width = spriteW;
    this.backgroundLayer.height = spriteH;
    this.backgroundLayer.x = width / 2 - spriteW * BACKGROUND_FOCAL_X;
    this.backgroundLayer.y = height / 2 - spriteH * BACKGROUND_FOCAL_Y;
    // Clamp so the photo always still fully covers the canvas even when the
    // focal point sits near an edge.
    this.backgroundLayer.x = Math.min(0, Math.max(width - spriteW, this.backgroundLayer.x));
    this.backgroundLayer.y = Math.min(0, Math.max(height - spriteH, this.backgroundLayer.y));

    this.backgroundVignette.width = width;
    this.backgroundVignette.height = height;

    const glowSpecs = [
      { wRatio: 0.55, hRatio: 0.7, xRatio: 0.02, yRatio: 0.3 },
      { wRatio: 0.55, hRatio: 0.7, xRatio: 0.98, yRatio: 0.3 },
      { wRatio: 0.95, hRatio: 0.42, xRatio: 0.5, yRatio: 0.92 },
    ];
    this.ambientGlows.forEach((s, i) => {
      const spec = glowSpecs[i];
      s.width = width * spec.wRatio;
      s.height = height * spec.hRatio;
      s.x = width * spec.xRatio;
      s.y = height * spec.yRatio;
    });
  }

  /**
   * The "VAULT BREAKER" title lockup + "UNLOCK BIGGER WINS" subtitle plate
   * + side taglines ("BIGGER VAULTS BIGGER WINS" / "FORTUNE FAVORS THE
   * BOLD") over the vault-chamber background, above the machine (spec item
   * 2). Built as PIXI Text with a gradient fill (gold upper -> teal lower,
   * matching the reference's VAULT/BREAKER two-tone treatment) plus a
   * stroke + drop shadow for a beveled, branded read rather than plain
   * text. Wording matches the locked master reference verbatim (see
   * design-ref/master-v1.png) — nothing invented.
   */
  private buildLogoLockup(width: number, layout: ReturnType<typeof this.computeLayout>) {
    this.logoLockup = new Container();
    this.logoLockup.eventMode = "none";
    this.world.addChild(this.logoLockup);

    // A soft warm glow behind the title, suggesting the vault door's own
    // glow sitting behind the lockup (spec item 1's "suggestion of the
    // large circular vault door glow behind the logo area").
    this.logoDoorGlow = new Sprite(getGlowTexture());
    this.logoDoorGlow.anchor.set(0.5);
    this.logoDoorGlow.blendMode = "add";
    this.logoDoorGlow.tint = 0xd4af37;
    this.logoDoorGlow.alpha = 0.3;
    this.logoLockup.addChild(this.logoDoorGlow);

    this.logoTitle = new Text({
      text: "VAULT\nBREAKER",
      style: {
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontWeight: "900",
        fontSize: 10,
        lineHeight: 10,
        align: "center",
        letterSpacing: 1,
        fill: new FillGradient({
          type: "linear",
          start: { x: 0, y: 0 },
          end: { x: 0, y: 1 },
          textureSpace: "local",
          colorStops: [
            { offset: 0, color: "#fff6d9" },
            { offset: 0.22, color: "#f0cf6a" },
            { offset: 0.46, color: "#d4af37" },
            { offset: 0.56, color: "#8ef2e6" },
            { offset: 0.78, color: "#2dbfb0" },
            { offset: 1, color: "#0d7168" },
          ],
        }),
        stroke: { color: 0x0a0f14, width: 6 },
        dropShadow: { color: 0xd4af37, blur: 14, distance: 0, alpha: 0.55 },
      },
    });
    this.logoTitle.anchor.set(0.5, 0);
    this.logoLockup.addChild(this.logoTitle);

    this.logoSubtitlePlate = new Graphics();
    this.logoLockup.addChild(this.logoSubtitlePlate);

    this.logoSubtitleText = new Text({
      text: "UNLOCK BIGGER WINS",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontWeight: "800",
        fontSize: 10,
        letterSpacing: 2,
        fill: 0xf6e7ae,
      },
    });
    this.logoSubtitleText.anchor.set(0.5);
    this.logoLockup.addChild(this.logoSubtitleText);

    const taglineStyle = {
      fontFamily: "system-ui, sans-serif",
      fontWeight: "700" as const,
      fontSize: 10,
      letterSpacing: 1,
      align: "center" as const,
      fill: 0x9fb2c8,
    };
    this.logoTaglineLeft = new Text({ text: "BIGGER\nVAULTS\nBIGGER\nWINS", style: { ...taglineStyle } });
    this.logoTaglineLeft.anchor.set(0.5);
    this.logoTaglineLeft.alpha = 0.4;
    this.logoLockup.addChild(this.logoTaglineLeft);

    this.logoTaglineRight = new Text({ text: "FORTUNE\nFAVORS\nTHE BOLD", style: { ...taglineStyle } });
    this.logoTaglineRight.anchor.set(0.5);
    this.logoTaglineRight.alpha = 0.4;
    this.logoLockup.addChild(this.logoTaglineRight);

    this.positionLogoLockup(width, layout);
  }

  private positionLogoLockup(width: number, layout: ReturnType<typeof this.computeLayout>) {
    const centerX = width / 2;
    const areaH = layout.logoAreaH;
    // The title sits in the lower ~70% of the logo area (reference has
    // generous headroom above it for the vault-door art peeking over the
    // topbar) and the subtitle plate sits just above the machine's top beam.
    const titleFontSize = Math.max(26, width * 0.145);
    this.logoTitle.style.fontSize = titleFontSize;
    this.logoTitle.style.lineHeight = titleFontSize * 0.92;
    this.logoTitle.x = centerX;
    this.logoTitle.y = areaH * 0.16;

    this.logoDoorGlow.x = centerX;
    this.logoDoorGlow.y = areaH * 0.5;
    this.logoDoorGlow.width = width * 1.15;
    this.logoDoorGlow.height = width * 1.15;

    const subtitleFontSize = Math.max(9, width * 0.03);
    this.logoSubtitleText.style.fontSize = subtitleFontSize;
    const subtitleY = areaH * 0.93;
    this.logoSubtitleText.x = centerX;
    this.logoSubtitleText.y = subtitleY;
    const plateW = this.logoSubtitleText.width + width * 0.14;
    const plateH = subtitleFontSize + width * 0.045;
    this.logoSubtitlePlate
      .clear()
      .roundRect(centerX - plateW / 2, subtitleY - plateH / 2, plateW, plateH, plateH * 0.3)
      .fill({ color: 0x080b12, alpha: 0.65 })
      .roundRect(centerX - plateW / 2, subtitleY - plateH / 2, plateW, plateH, plateH * 0.3)
      .stroke({ width: 1.5, color: 0xd4af37, alpha: 0.6 });

    // Font size clamped so four stacked words at 1 letter-spacing never
    // overflow past the canvas edge — measured against the longest word
    // ("BIGGER"/"FORTUNE") rather than a flat width fraction, since a fixed
    // fraction clipped at very narrow phone widths.
    const taglineMargin = Math.max(width * 0.16, layout.sideW * 2.2);
    let taglineFontSize = Math.max(7, width * 0.023);
    this.logoTaglineLeft.style.fontSize = taglineFontSize;
    this.logoTaglineLeft.style.lineHeight = taglineFontSize * 1.25;
    this.logoTaglineRight.style.fontSize = taglineFontSize;
    this.logoTaglineRight.style.lineHeight = taglineFontSize * 1.25;
    const maxTaglineWidth = taglineMargin * 1.7;
    while (
      (this.logoTaglineLeft.width > maxTaglineWidth || this.logoTaglineRight.width > maxTaglineWidth) &&
      taglineFontSize > 5.5
    ) {
      taglineFontSize -= 0.4;
      this.logoTaglineLeft.style.fontSize = taglineFontSize;
      this.logoTaglineLeft.style.lineHeight = taglineFontSize * 1.25;
      this.logoTaglineRight.style.fontSize = taglineFontSize;
      this.logoTaglineRight.style.lineHeight = taglineFontSize * 1.25;
    }
    this.logoTaglineLeft.x = taglineMargin;
    this.logoTaglineLeft.y = areaH * 0.42;
    this.logoTaglineRight.x = width - taglineMargin;
    this.logoTaglineRight.y = areaH * 0.42;
  }

  /**
   * Mounted plate directly beneath the reel window reading "CRACK THE
   * VAULT. CLAIM YOUR FORTUNE." — part of the machine housing, not a
   * floating HTML caption (spec item 4). Wording matches the locked master
   * reference verbatim.
   */
  private buildTaglinePlate(width: number, layout: ReturnType<typeof this.computeLayout>) {
    this.taglinePlate = new Container();
    this.taglinePlate.eventMode = "none";
    this.world.addChild(this.taglinePlate);

    this.taglinePlateBg = new Graphics();
    this.taglinePlate.addChild(this.taglinePlateBg);

    this.taglinePlateText = new Text({
      text: "CRACK THE VAULT. CLAIM YOUR FORTUNE.",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontWeight: "800",
        fontSize: 10,
        letterSpacing: 1.2,
        fill: 0xf0cf6a,
      },
    });
    this.taglinePlateText.anchor.set(0.5);
    this.taglinePlate.addChild(this.taglinePlateText);

    this.positionTaglinePlate(width, layout);
  }

  private positionTaglinePlate(width: number, layout: ReturnType<typeof this.computeLayout>) {
    const plateY = layout.machineY + layout.topBeam + layout.reelWindowHeight + layout.bottomBase + layout.taglineH / 2;
    const plateW = layout.machineWidth - layout.sideW * 0.6;
    const plateH = layout.taglineH * 0.66;
    const fontSize = Math.max(8, Math.min(layout.taglineH * 0.34, width * 0.028));
    this.taglinePlateText.style.fontSize = fontSize;
    // Shrink letter-spacing/font on very narrow screens so the full line
    // never clips the plate — still one line, never wrapped mid-word.
    while (this.taglinePlateText.width > plateW * 0.92 && this.taglinePlateText.style.fontSize > 6) {
      this.taglinePlateText.style.fontSize -= 0.5;
    }
    this.taglinePlateText.x = width / 2;
    this.taglinePlateText.y = plateY;

    this.taglinePlateBg
      .clear()
      .roundRect(width / 2 - plateW / 2, plateY - plateH / 2, plateW, plateH, plateH * 0.25)
      .fill({ color: 0x080a10, alpha: 0.72 })
      .roundRect(width / 2 - plateW / 2, plateY - plateH / 2, plateW, plateH, plateH * 0.25)
      .stroke({ width: 1.25, color: 0xd4af37, alpha: 0.5 });
  }

  /** (Re)draws every Graphics/gradient-Sprite frame/backing piece from the current layout — called on build and on every resize. Bars are gold-trimmed gradients (spec item 3); bolts/LED strips are drawn by drawFrameHardware() at the end of this method. */
  private drawFrame(width: number, height: number, layout: ReturnType<typeof this.computeLayout>) {
    const win = this.winRect;
    const metalDark = "#0e1118";
    const metalMid = "#1b202b";
    const metalLight = "#2c3340";
    const goldTrim = "#c79a3a";

    // Steel-to-gold gradient (spec item 3): each bar reads mostly as dark
    // brushed steel with a gold band right at the edge that faces the reel
    // window/viewer, like a real cabinet's trim strip — not a flat tone.
    this.frameTop.texture?.destroy(true);
    this.frameTop.texture = buildVerticalGradientTexture(layout.topBeam, [
      { offset: 0, color: metalMid },
      { offset: 0.62, color: metalDark },
      { offset: 0.86, color: goldTrim },
      { offset: 1, color: "#3a2a0f" },
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
      { offset: 0, color: goldTrim },
      { offset: 0.28, color: "#3a2a0f" },
      { offset: 0.55, color: "#080a0f" },
      { offset: 1, color: metalDark },
    ]);
    this.frameBase.width = layout.machineWidth;
    this.frameBase.height = Math.max(4, layout.bottomBase);
    this.frameBase.x = layout.machineX;
    this.frameBase.y = layout.machineY + layout.machineHeight - layout.bottomBase;

    // Bezel ring: thick enough to visibly overlap the reel window's own
    // edges (spec item 3: "the frame overlapping the reel edges slightly —
    // not just a thin outline beside them") — a wide gold-toned outer
    // stroke with a slim bright teal inner line on the same path, both
    // centered on the reel window's boundary so they eat into the reel art
    // by roughly half their width.
    const bezelWidth = Math.max(5, Math.min(win.w, win.h) * 0.024);
    this.frameBezel.clear();
    this.frameBezel
      .roundRect(win.x, win.y, win.w, win.h, Math.min(win.w, win.h) * 0.015)
      .stroke({ width: bezelWidth, color: 0xc79a3a, alpha: 0.6 });
    this.frameBezel
      .roundRect(win.x, win.y, win.w, win.h, Math.min(win.w, win.h) * 0.015)
      .stroke({ width: Math.max(1.5, bezelWidth * 0.32), color: 0x2dbfb0, alpha: 0.55 });

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

    // Bevel highlight/shadow on each frame bar — a bright gold-toned line
    // where the bar would catch light (its inner edge, facing the reel
    // window) and a faint dark line on its outer edge (in shadow). Plain
    // strokes only — no painted texture.
    this.frameHighlights.clear();
    const hi = { width: 1.75, color: 0xe8c15a, alpha: 0.65 };
    const lo = { width: 1.5, color: 0x000000, alpha: 0.45 };
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

    this.drawFrameHardware(layout);
  }

  /**
   * Corner bolts/rivets (spec item 3) drawn as small concentric-circle
   * fixtures (dark outer ring, metal fill, offset highlight dot — a cheap
   * but legible "real hardware" cue) at each of the machine's four outer
   * corners, plus the teal LED accent strip Sprites positioned down the
   * inner edge of each side column.
   */
  private drawFrameHardware(layout: ReturnType<typeof this.computeLayout>) {
    const mx = layout.machineX;
    const my = layout.machineY;
    const mw = layout.machineWidth;
    const mh = layout.machineHeight;
    const boltR = Math.max(2.5, layout.sideW * 0.32);
    const inset = boltR * 1.4;

    this.frameHardware.clear();
    const corners: [number, number][] = [
      [mx + inset, my + inset],
      [mx + mw - inset, my + inset],
      [mx + inset, my + mh - inset],
      [mx + mw - inset, my + mh - inset],
    ];
    for (const [cx, cy] of corners) {
      this.frameHardware.circle(cx, cy, boltR * 1.25).fill({ color: 0x05070a, alpha: 0.85 });
      this.frameHardware.circle(cx, cy, boltR).fill({ color: 0x3a4152 });
      this.frameHardware.circle(cx, cy, boltR).stroke({ width: Math.max(0.75, boltR * 0.18), color: 0x0a0c12, alpha: 0.7 });
      this.frameHardware.circle(cx - boltR * 0.3, cy - boltR * 0.3, boltR * 0.32).fill({ color: 0xd4af37, alpha: 0.75 });
    }

    const ledW = Math.max(2.5, layout.sideW * 0.16);
    const ledH = layout.reelWindowHeight * 0.92;
    this.ledStripLeft.width = ledW;
    this.ledStripLeft.height = ledH;
    this.ledStripLeft.x = mx + layout.sideW * 0.78;
    this.ledStripLeft.y = my + layout.topBeam + layout.reelWindowHeight / 2;
    this.ledStripRight.width = ledW;
    this.ledStripRight.height = ledH;
    this.ledStripRight.x = mx + mw - layout.sideW * 0.78;
    this.ledStripRight.y = my + layout.topBeam + layout.reelWindowHeight / 2;
  }

  /** (Re)draws the pulsing anticipation border's shape from the current winRect — alpha/visibility are driven separately by setAnticipationBorderActive()/tick(), this only handles geometry (called on build and resize). */
  private drawAnticipationBorder() {
    const win = this.winRect;
    const pad = Math.max(4, Math.min(win.w, win.h) * 0.012);
    this.anticipationBorder
      .clear()
      .roundRect(win.x - pad, win.y - pad, win.w + pad * 2, win.h + pad * 2, Math.min(win.w, win.h) * 0.02)
      .stroke({ width: Math.max(2.5, Math.min(win.w, win.h) * 0.006), color: 0xff6634, alpha: 1 });
  }

  /**
   * Toggles the reel-viewport anticipation border — a pulsing orange stroke
   * shown whenever 2+ scatters are already showing and at least one reel is
   * still spinning (ported from the reference demo). spinToResult() is the
   * only caller: it flips this on right before kicking off the reel spins
   * whenever this round has an anticipation reel, and off once every reel
   * has landed.
   */
  private setAnticipationBorderActive(active: boolean) {
    this.anticipationBorderActive = active;
    this.anticipationBorder.visible = active;
    if (!active) this.anticipationBorderElapsed = 0;
  }

  /** (Re)draws the reel backing panel + top/bottom shadow vignette + reel dividers from the current winRect. Deep blue-graphite glass (spec item 6), not neutral gray. */
  private drawReelBacking() {
    const win = this.winRect;
    this.reelBacking.texture?.destroy(true);
    this.reelBacking.texture = buildVerticalGradientTexture(win.h, [
      { offset: 0, color: "#03040a" },
      { offset: 0.12, color: "#0d1626" },
      { offset: 0.5, color: "#132038" },
      { offset: 0.88, color: "#0d1626" },
      { offset: 1, color: "#03040a" },
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

    // Warm bloom blooming from center (spec item 8) — additive, sits behind
    // the label/amount text but in front of the dimming scrim so it reads
    // as light, not a flat shape.
    this.bigWinBloom = new Sprite(getGlowTexture());
    this.bigWinBloom.anchor.set(0.5);
    this.bigWinBloom.blendMode = "add";
    this.bigWinBloom.alpha = 0;
    this.bigWin.addChild(this.bigWinBloom);

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
    this.bigWinBloom.x = width / 2;
    this.bigWinBloom.y = height * 0.42;
    this.bigWinBloom.width = width * 1.3;
    this.bigWinBloom.height = width * 1.3;
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
    this.bigWinPulse?.cancel();
    this.bigWinPulse = null;
    this.bigWinLabel.text = label;
    this.bigWinLabel.style.fill = color;
    this.bigWinLabel.style.letterSpacing = 2;
    this.bigWinLabel.scale.set(0.6);
    this.bigWinLabel.alpha = 0;
    this.bigWinAmount.alpha = 0;
    this.bigWinBloom.tint = color;
    this.bigWinBloom.alpha = 0;
    this.bigWinBloom.scale.set(0.5);
    this.bigWin.visible = true;
    this.bigWin.alpha = 1;

    // Reels dim slightly (spec item 8) — a touch deeper than V5's 0.55 so
    // the takeover reads as a real event, while the scrim itself never
    // fully hides the winning symbols behind it.
    this.spawnBigWinBurst(color, tier === "epic" ? 34 : tier === "mega" ? 26 : 18);
    if (!this.bigWinRaf) this.startBigWinParticleLoop();

    await Promise.all([
      tween(260, (p) => {
        this.bigWinScrim.alpha = p * 0.62;
      }),
      tween(520, (p) => {
        this.bigWinBloom.alpha = Math.min(1, p * 1.3) * 0.65;
        this.bigWinBloom.scale.set(0.5 + p * 0.7);
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

    // Continuous gentle scale/glow "breathe" while the banner is held —
    // real animated typography rather than a static sprite sitting still
    // until it's dismissed.
    this.startBigWinPulse();
  }

  private startBigWinPulse() {
    let elapsed = 0;
    let last = performance.now();
    const baseBloomScale = 1.2;
    const step = () => {
      if (!this.bigWin.visible) {
        this.bigWinPulse = null;
        return;
      }
      const now = performance.now();
      elapsed += now - last;
      last = now;
      const s = 1 + Math.sin(elapsed * 0.0022) * 0.035;
      this.bigWinLabel.scale.set(s);
      this.bigWinBloom.scale.set(baseBloomScale + Math.sin(elapsed * 0.0022) * 0.08);
      this.bigWinBloom.alpha = 0.55 + Math.sin(elapsed * 0.0022) * 0.1;
      const raf = requestAnimationFrame(step);
      this.bigWinPulse = { cancel: () => cancelAnimationFrame(raf) };
    };
    step();
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
    this.bigWinPulse?.cancel();
    this.bigWinPulse = null;
    const bloomStartAlpha = this.bigWinBloom.alpha;
    await tween(320, (p) => {
      const fade = 1 - p;
      this.bigWinScrim.alpha = 0.62 * fade;
      this.bigWinBloom.alpha = bloomStartAlpha * fade;
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

    this.backgroundVignette.texture.destroy(true);
    this.backgroundVignette.texture = buildBackgroundVignetteTexture(width, height);
    this.positionBackground(width, height);

    const layout = this.computeLayout(width, height);
    this.cellWidth = layout.cellWidth;
    this.cellHeight = layout.cellHeight;

    this.positionLogoLockup(width, layout);

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
    this.drawAnticipationBorder();
    this.positionTaglinePlate(width, layout);

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

    this.ambientElapsed += dt;
    const ledA = 0.55 + Math.sin(this.ambientElapsed * 1.1) * 0.28;
    const ledB = 0.55 + Math.sin(this.ambientElapsed * 1.1 + Math.PI * 0.7) * 0.28;
    this.ledStripLeft.alpha = ledA;
    this.ledStripRight.alpha = ledB;

    if (this.anticipationBorderActive) {
      this.anticipationBorderElapsed += deltaMS;
      this.anticipationBorder.alpha = 0.55 + 0.35 * Math.abs(Math.sin(this.anticipationBorderElapsed * 0.006));
    }

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

    const turbo = !!opts.turbo;
    if (anticipationReels.size > 0) this.setAnticipationBorderActive(true);

    const promises = grid.map((col, i) => {
      const anticipation = anticipationReels.has(i);
      const personality = scaleForTurbo(REEL_PERSONALITY[i % REEL_PERSONALITY.length], turbo);
      const fillerCount = Math.round(12 * (personality.duration / REEL_PERSONALITY[0].duration));
      return this.reels[i]
        .spin(col, {
          personality,
          fillerCount,
          startDelayMs: reelStartDelayMs(i, turbo),
          anticipationHoldMs: anticipation ? (turbo ? ANTICIPATION_HOLD_MS * 0.45 : ANTICIPATION_HOLD_MS) : 0,
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
    this.setAnticipationBorderActive(false);
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
    this.setAnticipationBorderActive(false);
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
    // would also tear down the shared, module-cached symbol/glow/background
    // textures (see symbolAssets.ts/fx.ts/environmentAssets.ts, all loaded
    // via PIXI.Assets and cached for reuse across remounts) that a future
    // remount of this same game reuses. this.backgroundLayer's texture is
    // one of those shared Assets-cached textures — NOT destroyed here.
    this.backgroundVignette.texture?.destroy(true);
    this.frameTop.texture?.destroy(true);
    this.frameLeft.texture?.destroy(true);
    this.frameBase.texture?.destroy(true);
    this.reelBacking.texture?.destroy(true);
    this.topShadow.texture?.destroy(true);
    this.bottomShadow.texture?.destroy(true);
    this.app.destroy(true, { children: true, texture: false });
  }
}
