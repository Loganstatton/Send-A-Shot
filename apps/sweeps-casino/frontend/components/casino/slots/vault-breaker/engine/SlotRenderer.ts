"use client";

// Top-level Pixi orchestrator: owns the Application/stage lifecycle, lays
// out the real vault backdrop photo + a slim cabinet-glass trim + 5
// ReelStrips + the in-canvas free-spins HUD + WinPresentation +
// FreeSpinsTransition, and exposes a small imperative API the React shell
// drives (spinToResult, celebrateWin, playBonusTransition,
// setFreeSpinsEnvironment). React never touches Pixi objects directly —
// this class is the only bridge.
//
// V3 layout: the reel window's pixel size is computed to fill ~94-96% of
// the canvas WIDTH (fitting the largest cell that also satisfies the
// height budget), reserving only a slim top strip (for a bezel + the
// free-spins HUD) and a thin base — not a thick machine-frame border. The
// real backdrop photo (vault corridor / free-spins gold room) fills the
// entire canvas behind everything, cover-fit, so any leftover vertical
// space above/below the reels reads as environment, never black dead
// space.
//
// Every child is parented under `this.world` (not `app.stage` directly) so
// camera effects (a brief shake on scatter land, a small push-in on a big
// win, the push during Vault Breach) can transform one container instead
// of juggling stage.x/y AND stage.scale by hand.
import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { SlotPaylineWin, SlotSymbolId } from "@/lib/types";
import { buildSymbolTextures } from "../art/symbolTextures";
import { buildMachineFrameTexture, buildVaultWheelTexture, getGlowTexture, loadBackdropTexture, type Rect } from "../art/vaultBackdrop";
import { ReelStrip } from "./ReelStrip";
import { WinPresentation, type WinTier } from "./WinPresentation";
import { FreeSpinsTransition } from "./FreeSpinsTransition";
import { easeOutBack, tween } from "./animUtils";

const BASE_REEL_DURATION = 900;
const REEL_STAGGER_MS = 120;
const BASE_FILLER = 12;
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

/** Cover-fits `sprite`'s texture into a `w`x`h` box (like CSS background-size: cover), centered. Returns the base scale used, so callers can layer a small extra "breathing" zoom on top without recomputing/compounding it. */
function coverFit(sprite: Sprite, w: number, h: number): number {
  const tex = sprite.texture;
  if (!tex || !tex.width || !tex.height) return 1;
  const scale = Math.max(w / tex.width, h / tex.height);
  sprite.scale.set(scale);
  sprite.x = (w - sprite.width) / 2;
  sprite.y = (h - sprite.height) / 2;
  return scale;
}

export class SlotRenderer {
  readonly app: Application;
  /** Everything lives under this container so camera shake/push-in can transform the whole scene at once. */
  private world!: Container;
  private reels: ReelStrip[] = [];
  private reelsContainer!: Container;
  private backdropBase!: Sprite;
  private backdropFreeSpins!: Sprite;
  private frameBase!: Sprite;
  private frameFreeSpins!: Sprite;
  private anticipationGlows = new Map<number, Sprite>();
  private anticipationDim = 0;
  private win!: WinPresentation;
  private bonus!: FreeSpinsTransition;
  private fsHud!: Container;
  private fsHudSpinsText!: Text;
  private fsHudMultText!: Text;
  private fsHudGear!: Sprite;
  private fsHudPlate!: Graphics;
  private lastHudMultiplier = 0;
  private textures: Record<SlotSymbolId, Texture>;
  private backdropTextures: { base: Texture; freeSpins: Texture; breach: Texture };
  private reelsCount: number;
  private rows: number;
  private width = 0;
  private height = 0;
  private cellSize = 0;
  private bigWin!: Container;
  private bigWinScrim!: Graphics;
  private bigWinLabel!: Text;
  private bigWinAmount!: Text;
  private bigWinParticles: { g: Sprite; vx: number; vy: number; life: number; maxLife: number; active: boolean }[] = [];
  private bigWinRaf = 0;
  private winRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private freeSpinsActive = false;
  private backdropBaseScale = { base: 1, freeSpins: 1 };

  // ---- idle ambience ----
  private idle = false;
  private idleElapsed = 0;
  private dustSprites: Sprite[] = [];
  private dustState: { vx: number; vy: number; phase: number }[] = [];
  private tickerFn: ((ticker: { deltaMS: number }) => void) | null = null;

  private constructor(
    app: Application,
    reelsCount: number,
    rows: number,
    textures: Record<SlotSymbolId, Texture>,
    backdropTextures: { base: Texture; freeSpins: Texture; breach: Texture }
  ) {
    this.app = app;
    this.reelsCount = reelsCount;
    this.rows = rows;
    this.textures = textures;
    this.backdropTextures = backdropTextures;
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
      // blank/black in a screenshot or video. Real content, verified via
      // renderer.extract, confirmed this exact symptom during V3 QA — see
      // the build report.
      preserveDrawingBuffer: true,
    });
    (app.canvas as HTMLCanvasElement).style.display = "block";
    (app.canvas as HTMLCanvasElement).style.width = "100%";
    (app.canvas as HTMLCanvasElement).style.height = "100%";
    parent.appendChild(app.canvas as HTMLCanvasElement);

    // Real image assets — symbols + all three backdrop photos — loaded
    // before the first frame so nothing pops in after mount.
    const [textures, base, freeSpins, breach] = await Promise.all([
      buildSymbolTextures(),
      loadBackdropTexture("base"),
      loadBackdropTexture("freeSpins"),
      loadBackdropTexture("breach"),
    ]);

    const renderer = new SlotRenderer(app, opts.reels, opts.rows, textures, { base, freeSpins, breach });
    renderer.buildScene(opts.width, opts.height);
    renderer.startTicker();
    return renderer;
  }

  /** Fits the largest cell size that satisfies both the width and height budget after reserving a SLIM top strip + base — the reel window fills ~94-96% of canvas width whenever height isn't the binding constraint (the normal iPhone-portrait case). */
  private computeLayout(width: number, height: number) {
    const topBeam = Math.max(34, height * 0.072);
    const bottomBase = Math.max(10, height * 0.016);
    const sideW = width * 0.02;
    const availW = Math.max(1, width - sideW * 2);
    const availH = Math.max(1, height - topBeam - bottomBase);
    const cellSize = Math.min(availW / this.reelsCount, availH / this.rows);
    const reelWindowWidth = cellSize * this.reelsCount;
    const reelWindowHeight = cellSize * this.rows;
    const originX = (width - reelWindowWidth) / 2;
    const originY = topBeam + (availH - reelWindowHeight) / 2;
    return { cellSize, originX, originY, reelWindowWidth, reelWindowHeight, topBeam };
  }

  private buildScene(width: number, height: number) {
    this.width = width;
    this.height = height;

    this.world = new Container();
    this.world.pivot.set(width / 2, height / 2);
    this.world.position.set(width / 2, height / 2);
    this.app.stage.addChild(this.world);

    this.backdropBase = new Sprite(this.backdropTextures.base);
    this.backdropFreeSpins = new Sprite(this.backdropTextures.freeSpins);
    this.backdropFreeSpins.alpha = 0;
    this.backdropBaseScale.base = coverFit(this.backdropBase, width, height);
    this.backdropBaseScale.freeSpins = coverFit(this.backdropFreeSpins, width, height);
    this.world.addChild(this.backdropBase, this.backdropFreeSpins);

    // Ambient dust — always present, subtly brighter/faster once idle (see startTicker/tick).
    const dustLayer = new Container();
    dustLayer.eventMode = "none";
    for (let i = 0; i < 18; i++) {
      const s = new Sprite(getGlowTexture());
      s.anchor.set(0.5);
      s.tint = Math.random() > 0.5 ? 0xf2d98a : 0x8ef2e6;
      const size = 2 + Math.random() * 4;
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
    this.cellSize = layout.cellSize;

    this.reelsContainer = new Container();
    this.reelsContainer.x = layout.originX;
    this.reelsContainer.y = layout.originY;
    this.world.addChild(this.reelsContainer);

    this.reels = [];
    for (let i = 0; i < this.reelsCount; i++) {
      const reel = new ReelStrip({ rows: this.rows, cellSize: this.cellSize, textures: this.textures });
      reel.container.x = i * this.cellSize;
      this.reelsContainer.addChild(reel.container);
      this.reels.push(reel);
    }

    this.win = new WinPresentation(this.cellSize, this.rows);
    this.win.layer.x = layout.originX;
    this.win.layer.y = layout.originY;
    this.world.addChild(this.win.layer);

    this.winRect = { x: layout.originX, y: layout.originY, w: layout.reelWindowWidth, h: layout.reelWindowHeight };
    this.frameBase = new Sprite(buildMachineFrameTexture(width, height, this.winRect, "base"));
    this.frameFreeSpins = new Sprite(buildMachineFrameTexture(width, height, this.winRect, "breach"));
    this.frameFreeSpins.alpha = 0;
    this.world.addChild(this.frameBase, this.frameFreeSpins);

    this.buildFsHud(width, layout);

    this.bonus = new FreeSpinsTransition(width, height, this.backdropTextures.breach, {
      onShake: (ms, amp) => this.shakeStage(ms, amp),
      onPush: (ms, amt) => this.cameraPushIn(amt, ms),
    });
    this.world.addChild(this.bonus.container);

    this.buildBigWinBanner(width, height);
  }

  /**
   * The BIG/MEGA/EPIC win takeover — built entirely in the PixiJS canvas
   * (per the brief: "not a cheap HTML dialog, build it in the PixiJS
   * canvas"), NOT a DOM overlay. A translucent scrim dims the scene
   * (reels stay visible behind it, per "symbols still visible behind"),
   * a large tier label pops in with a gold particle burst, and the
   * counting amount is pushed in imperatively (setBigWinAmount) by the
   * same React-owned count-up tween that already drives the small normal-
   * win HUD — this banner is just where BIG+ tiers render that number.
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

  /** Fades in the scrim + pops in the tier label with a gold/pink/orange particle burst (tier-tinted). Resolves once the pop-in settles; the banner then stays visible until hideBigWinBanner(). */
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

  /** Pushes the live (React-owned) counting amount string into the in-canvas banner text. */
  setBigWinAmount(text: string) {
    this.bigWinAmount.text = text;
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

  /** Shared geometry for the two-plate free-spins HUD (spins counter left, mechanical multiplier dial right) — computed once from `width` and reused by buildFsHud/drawFsHudPlate/resize so the two plates never drift out of sync or overlap the gear/text (a real bug in an earlier pass: the gear sat ON TOP of the "SPINS" label with zero gap before the multiplier plate). */
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
    this.fsHud.y = layout.topBeam * 0.5;

    this.fsHudPlate = new Graphics();
    this.fsHud.addChild(this.fsHudPlate);

    const m = this.fsHudMetrics(width);
    const gearSize = layout.topBeam * 0.6;
    this.fsHudGear = new Sprite(buildVaultWheelTexture(Math.max(16, Math.round(gearSize))));
    this.fsHudGear.anchor.set(0.5);
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

    this.backdropBaseScale.base = coverFit(this.backdropBase, width, height);
    this.backdropBaseScale.freeSpins = coverFit(this.backdropFreeSpins, width, height);

    const layout = this.computeLayout(width, height);
    this.cellSize = layout.cellSize;

    this.reelsContainer.x = layout.originX;
    this.reelsContainer.y = layout.originY;
    this.reels.forEach((reel, i) => {
      reel.resize(this.cellSize);
      reel.container.x = i * this.cellSize;
    });

    this.win.resize(this.cellSize);
    this.win.layer.x = layout.originX;
    this.win.layer.y = layout.originY;

    this.winRect = { x: layout.originX, y: layout.originY, w: layout.reelWindowWidth, h: layout.reelWindowHeight };
    this.frameBase.texture.destroy(true);
    this.frameBase.texture = buildMachineFrameTexture(width, height, this.winRect, "base");
    this.frameFreeSpins.texture.destroy(true);
    this.frameFreeSpins.texture = buildMachineFrameTexture(width, height, this.winRect, "breach");

    const fsm = this.fsHudMetrics(width);
    const gearSize = layout.topBeam * 0.6;
    this.fsHud.y = layout.topBeam * 0.5;
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
      width: this.cellSize * this.reelsCount,
      height: this.cellSize * this.rows,
    };
  }

  // ---- Idle ambience: never a fully frozen screen when nobody is spinning ----

  setIdle(active: boolean) {
    this.idle = active;
  }

  private startTicker() {
    this.tickerFn = ({ deltaMS }: { deltaMS: number }) => this.tick(deltaMS);
    this.app.ticker.add(this.tickerFn as any);
  }

  private tick(deltaMS: number) {
    const dt = deltaMS / 1000;

    // Ambient dust drifts continuously (very faint); brighter while idle.
    const targetDustAlpha = this.idle ? 0.55 : 0.18;
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

    // Backdrop breathes very slowly (subtle "alive" zoom on top of its
    // fixed cover-fit base scale), and WILD symbols currently on screen
    // pulse gently — the machine is never a static photograph even with
    // nobody spinning.
    const breathe = 1 + Math.sin(this.idleElapsed * 0.35) * 0.012;
    const activeBackdrop = this.freeSpinsActive ? this.backdropFreeSpins : this.backdropBase;
    const baseScale = this.freeSpinsActive ? this.backdropBaseScale.freeSpins : this.backdropBaseScale.base;
    activeBackdrop.scale.set(baseScale * breathe);
    activeBackdrop.x = (this.width - activeBackdrop.width) / 2;
    activeBackdrop.y = (this.height - activeBackdrop.height) / 2;

    const wildPulse = 1 + Math.abs(Math.sin(this.idleElapsed * 0.9)) * 0.05;
    this.reels.forEach((reel) => {
      const col = reel.currentColumn();
      col.forEach((id, row) => {
        if (id !== "WILD") return;
        const sp = reel.spriteForRow(row);
        sp.scale.set(wildPulse);
      });
    });
  }

  /**
   * Animates every reel from its current column to the server's real
   * `grid`, sequentially stopping reel 0 -> reelsCount-1, with scatter
   * anticipation (slowed remaining reels + darkened surroundings + a
   * glowing scatter reel) on any reel that completes a 3rd+ scatter after
   * two have already landed on earlier (already-stopped) reels. Resolves
   * once every reel has landed and settled.
   */
  async spinToResult(grid: SlotSymbolId[][], opts: SpinPresentationOptions): Promise<void> {
    this.win.clear();
    this.clearAnticipationGlows();
    this.resetWildIdleScale();

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
      const duration = BASE_REEL_DURATION + i * REEL_STAGGER_MS;
      const fillerCount = Math.round(BASE_FILLER * (duration / BASE_REEL_DURATION));
      return this.reels[i]
        .spin(col, {
          duration,
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

  private resetWildIdleScale() {
    this.reels.forEach((reel) => {
      for (let row = 0; row < this.rows; row++) reel.spriteForRow(row).scale.set(1);
    });
  }

  private startAnticipationGlow(reelIndex: number, durationMs: number) {
    // Soft elongated glow behind the whole reel column — never a hard
    // stroked rectangle (same "no debug shapes" rule as WinPresentation).
    const g = new Sprite(getGlowTexture());
    g.anchor.set(0.5);
    g.blendMode = "add";
    g.tint = 0xd4af37;
    g.width = this.cellSize * 1.7;
    g.height = this.cellSize * this.rows * 1.25;
    g.x = this.reelsContainer.x + reelIndex * this.cellSize + this.cellSize / 2;
    g.y = this.reelsContainer.y + (this.cellSize * this.rows) / 2;
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

    // Darken surroundings: every non-anticipating reel dims while the
    // suspect reel visibly hesitates — purely presentational, the outcome
    // was already determined server-side before this animation started.
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

  /** Small camera shake — scatter landing. Distinct from the stronger shake used in the Vault Breach cinematic. */
  pulseScatterLand(count: number) {
    if (count <= 0) return;
    if (count === 1) {
      this.shakeStage(120, 2);
    } else {
      this.shakeStage(180, 4 + count);
    }
  }

  celebrateWin(wins: SlotPaylineWin[], tier: WinTier) {
    this.win.celebrate(this.reels, wins, tier);
    // Camera push-in on meaningful wins — subtle, never overdone, and
    // skipped entirely for a normal small win per the brief.
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

  /** Crossfades the whole scene (backdrop photo + frame lighting) between the closed base-game vault and the breached free-spins gold room. */
  async setFreeSpinsEnvironment(active: boolean): Promise<void> {
    if (this.freeSpinsActive === active) return;
    this.freeSpinsActive = active;
    await tween(500, (p) => {
      const e = active ? p : 1 - p;
      this.backdropFreeSpins.alpha = e;
      this.frameFreeSpins.alpha = e;
    });
  }

  /** Shows/updates the in-canvas free spins HUD (spins counter + mechanical multiplier display) — replaces DOM corner pills so it reads as part of the machine's own art. */
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

  /** A large illuminated mechanical display reacting to the multiplier going up: a quick squash "flip" impact, the gear kicks forward a notch, and a gold flash — not a React state update that just re-renders text. */
  private pulseMultiplierIncrease() {
    const startRotation = this.fsHudGear.rotation;
    tween(420, (p) => {
      this.fsHudGear.rotation = startRotation + p * (Math.PI / 3);
    });
    // Mechanical "flip": squash vertically to ~0 then spring back — reads
    // like a real split-flap/odometer digit impact, not a smooth tween.
    tween(320, (p) => {
      const flip = p < 0.5 ? 1 - p * 2 : (p - 0.5) * 2;
      this.fsHudMultText.scale.y = Math.max(0.08, flip);
      this.fsHudMultText.tint = p < 0.55 ? 0xfff8d8 : 0xffffff;
      if (p > 0.48 && p < 0.56) this.fsHudMultText.scale.x = 1.12;
      else this.fsHudMultText.scale.x = 1;
    });
  }

  /** Brief camera shake — used for scatter land and the Vault Breach cinematic's "camera shakes very slightly" beat. Acts on `world`, not `app.stage` directly, so it composes with pivot/scale (see cameraPushIn). */
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

  /** Subtle push-toward-camera: scales `world` up slightly around its center and back. Used for medium/big/mega/epic win tiers and the Vault Breach cinematic's "camera pushes toward the opening" beat — always small, per the brief's "do not overdo it". */
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
    // Destroy only the per-instance-generated frame textures (drawn fresh
    // per mount/resize) — NOT `texture: true` on app.destroy(), which would
    // also tear down the shared, module-cached symbol/backdrop/glow
    // textures (see symbolTextures.ts/vaultBackdrop.ts) that a future
    // remount of this same game reuses.
    this.frameBase.texture.destroy(true);
    this.frameFreeSpins.texture.destroy(true);
    this.app.destroy(true, { children: true, texture: false });
  }
}
