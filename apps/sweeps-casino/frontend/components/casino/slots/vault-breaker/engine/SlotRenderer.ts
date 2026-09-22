"use client";

// Top-level Pixi orchestrator: owns the Application/stage lifecycle, lays
// out the vault backdrop + physical machine frame + 5 ReelStrips + the
// in-canvas free-spins HUD + WinPresentation + FreeSpinsTransition, and
// exposes a small imperative API the React shell drives (spinToResult,
// celebrateWin, playBonusTransition, setFreeSpinsEnvironment). React never
// touches Pixi objects directly — this class is the only bridge.
//
// Layout (V2): the reel window's pixel size is now computed FIRST from the
// canvas's usable interior (after reserving real chrome — a top beam, side
// supports, a base — for the machine frame), by fitting the largest square
// cell that satisfies both the width and height constraints. That's what
// makes the reels actually dominate the frame instead of floating inside a
// mostly-empty canvas with the frame just a thin outline around them.
import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { SlotPaylineWin, SlotSymbolId } from "@/lib/types";
import { buildSymbolTextures } from "../art/symbolTextures";
import { buildBackdropTexture, buildMachineFrameTexture, buildVaultWheelTexture, type Rect } from "../art/vaultBackdrop";
import { ReelStrip } from "./ReelStrip";
import { WinPresentation, type WinTier } from "./WinPresentation";
import { FreeSpinsTransition } from "./FreeSpinsTransition";
import { tween } from "./animUtils";

const BASE_REEL_DURATION = 650;
const REEL_STAGGER_MS = 160;
const BASE_FILLER = 22;
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

export class SlotRenderer {
  readonly app: Application;
  private reels: ReelStrip[] = [];
  private reelsContainer!: Container;
  private backdropBase!: Sprite;
  private backdropBreach!: Sprite;
  private frameBase!: Sprite;
  private frameBreach!: Sprite;
  private anticipationGlows = new Map<number, Graphics>();
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
  private reelsCount: number;
  private rows: number;
  private width = 0;
  private height = 0;
  private cellSize = 0;
  private winRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private freeSpinsActive = false;

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
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1),
      autoDensity: true,
      powerPreference: "high-performance",
    });
    (app.canvas as HTMLCanvasElement).style.display = "block";
    (app.canvas as HTMLCanvasElement).style.width = "100%";
    (app.canvas as HTMLCanvasElement).style.height = "100%";
    parent.appendChild(app.canvas as HTMLCanvasElement);

    const textures = buildSymbolTextures();
    const renderer = new SlotRenderer(app, opts.reels, opts.rows, textures);
    renderer.buildScene(opts.width, opts.height);
    return renderer;
  }

  /** Fits the largest cell size that satisfies both the width and height budget after reserving frame chrome — this is what makes the reels dominate the canvas instead of floating in dead space. */
  private computeLayout(width: number, height: number) {
    const topBeam = height * 0.13;
    const bottomBase = height * 0.055;
    const sideW = width * 0.035;
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

    this.backdropBase = new Sprite(buildBackdropTexture(width, height, "base"));
    this.backdropBreach = new Sprite(buildBackdropTexture(width, height, "breach"));
    this.backdropBreach.alpha = 0;
    this.app.stage.addChild(this.backdropBase, this.backdropBreach);

    const layout = this.computeLayout(width, height);
    this.cellSize = layout.cellSize;

    this.reelsContainer = new Container();
    this.reelsContainer.x = layout.originX;
    this.reelsContainer.y = layout.originY;
    this.app.stage.addChild(this.reelsContainer);

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
    this.app.stage.addChild(this.win.layer);

    this.winRect = { x: layout.originX, y: layout.originY, w: layout.reelWindowWidth, h: layout.reelWindowHeight };
    this.frameBase = new Sprite(buildMachineFrameTexture(width, height, this.winRect, "base"));
    this.frameBreach = new Sprite(buildMachineFrameTexture(width, height, this.winRect, "breach"));
    this.frameBreach.alpha = 0;
    this.app.stage.addChild(this.frameBase, this.frameBreach);

    this.buildFsHud(width, layout);

    this.bonus = new FreeSpinsTransition(width, height, {
      onShake: (ms, amp) => this.shakeStage(ms, amp),
    });
    this.app.stage.addChild(this.bonus.container);
  }

  private buildFsHud(width: number, layout: ReturnType<typeof this.computeLayout>) {
    this.fsHud = new Container();
    this.fsHud.visible = false;
    this.fsHud.y = layout.topBeam * 0.5;

    this.fsHudPlate = new Graphics();
    this.fsHud.addChild(this.fsHudPlate);

    const gearSize = layout.topBeam * 0.62;
    this.fsHudGear = new Sprite(buildVaultWheelTexture(Math.max(16, Math.round(gearSize))));
    this.fsHudGear.anchor.set(0.5);
    this.fsHudGear.x = width * 0.5 - width * 0.22;
    this.fsHud.addChild(this.fsHudGear);

    this.fsHudSpinsText = new Text({
      text: "FREE SPINS 0/0",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontWeight: "800",
        fontSize: Math.max(10, layout.topBeam * 0.26),
        fill: 0x9af2e6,
        letterSpacing: 1,
      },
    });
    this.fsHudSpinsText.anchor.set(0, 0.5);
    this.fsHudSpinsText.x = width * 0.08;
    this.fsHud.addChild(this.fsHudSpinsText);

    this.fsHudMultText = new Text({
      text: "VAULT MULTIPLIER 1x",
      style: {
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontWeight: "800",
        fontSize: Math.max(12, layout.topBeam * 0.32),
        fill: 0xfff2c9,
        stroke: { color: 0x2a1a05, width: 3 },
      },
    });
    this.fsHudMultText.anchor.set(0.5, 0.5);
    this.fsHudMultText.x = width * 0.58;
    this.fsHud.addChild(this.fsHudMultText);

    this.app.stage.addChild(this.fsHud);
    this.drawFsHudPlate(width, layout.topBeam);
  }

  private drawFsHudPlate(width: number, topBeam: number) {
    this.fsHudPlate.clear();
    const h = topBeam * 0.62;
    const y = -h / 2;
    const draw = (x: number, w: number) => {
      const g = this.fsHudPlate;
      g.roundRect(x, y, w, h, h * 0.22).fill({ color: 0x0d1120, alpha: 0.55 });
      g.roundRect(x, y, w, h, h * 0.22).stroke({ width: 1.5, color: 0x2dbfb0, alpha: 0.5 });
    };
    draw(width * 0.05, width * 0.34);
    draw(width * 0.4, width * 0.55);
  }

  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    this.app.renderer.resize(width, height);
    this.width = width;
    this.height = height;

    this.backdropBase.texture.destroy(true);
    this.backdropBase.texture = buildBackdropTexture(width, height, "base");
    this.backdropBreach.texture.destroy(true);
    this.backdropBreach.texture = buildBackdropTexture(width, height, "breach");

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
    this.frameBreach.texture.destroy(true);
    this.frameBreach.texture = buildMachineFrameTexture(width, height, this.winRect, "breach");

    this.fsHud.y = layout.topBeam * 0.5;
    this.fsHudGear.x = width * 0.5 - width * 0.22;
    this.fsHudMultText.x = width * 0.58;
    this.fsHudSpinsText.x = width * 0.08;
    this.drawFsHudPlate(width, layout.topBeam);

    this.bonus.resize(width, height);
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

  private startAnticipationGlow(reelIndex: number, durationMs: number) {
    const g = new Graphics();
    const w = this.cellSize;
    const h = this.cellSize * this.rows;
    g.roundRect(2, 2, w - 4, h - 4, 10).stroke({ width: 5, color: 0xd4af37, alpha: 0.9 });
    g.x = this.reelsContainer.x + reelIndex * this.cellSize;
    g.y = this.reelsContainer.y;
    this.app.stage.addChild(g);
    this.anticipationGlows.set(reelIndex, g);
    const t = tween(durationMs, (p) => {
      g.alpha = 0.35 + Math.abs(Math.sin(p * Math.PI * 5)) * 0.65;
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

  celebrateWin(wins: SlotPaylineWin[], tier: WinTier) {
    this.win.celebrate(this.reels, wins, tier);
  }

  clearWin() {
    this.win.clear();
    this.reels.forEach((reel) => {
      for (let row = 0; row < this.rows; row++) reel.spriteForRow(row).alpha = 1;
    });
  }

  /** Crossfades the whole scene (backdrop + frame lighting) between the closed base-game vault and the breached free-spins environment. */
  async setFreeSpinsEnvironment(active: boolean): Promise<void> {
    if (this.freeSpinsActive === active) return;
    this.freeSpinsActive = active;
    await tween(500, (p) => {
      const e = active ? p : 1 - p;
      this.backdropBreach.alpha = e;
      this.frameBreach.alpha = e;
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
    this.fsHudMultText.text = `VAULT MULTIPLIER ${info.multiplier}x`;
    if (this.lastHudMultiplier && info.multiplier > this.lastHudMultiplier) {
      this.pulseMultiplierIncrease();
    }
    this.lastHudMultiplier = info.multiplier;
  }

  /** A large illuminated mechanical display reacting to the multiplier going up: the gear kicks forward a notch, gold-flashes, and the number pops. */
  private pulseMultiplierIncrease() {
    const startRotation = this.fsHudGear.rotation;
    tween(420, (p) => {
      this.fsHudGear.rotation = startRotation + p * (Math.PI / 3);
    });
    tween(360, (p) => {
      const s = 1 + Math.sin(p * Math.PI) * 0.35;
      this.fsHudMultText.scale.set(s);
      this.fsHudMultText.tint = p < 0.6 ? 0xfff8d8 : 0xffffff;
    });
  }

  /** Brief camera shake — used by the Vault Breach cinematic's "camera shakes very slightly" beat. */
  shakeStage(durationMs: number, amplitude: number): Promise<void> {
    const baseX = this.app.stage.x;
    const baseY = this.app.stage.y;
    return tween(durationMs, (p) => {
      const decay = 1 - p;
      this.app.stage.x = baseX + (Math.random() - 0.5) * amplitude * decay;
      this.app.stage.y = baseY + (Math.random() - 0.5) * amplitude * decay;
    }).then(() => {
      this.app.stage.x = baseX;
      this.app.stage.y = baseY;
    });
  }

  async playBonusTransition(spinsAwarded: number, callbacks: BonusTransitionCallbacks = {}): Promise<void> {
    this.bonus.setCallbacks(callbacks);
    await this.bonus.play(spinsAwarded);
  }

  destroy() {
    this.clearAnticipationGlows();
    this.reels.forEach((r) => r.destroy());
    this.win.destroy();
    this.bonus.destroy();
    this.app.destroy(true, { children: true, texture: true });
  }
}
