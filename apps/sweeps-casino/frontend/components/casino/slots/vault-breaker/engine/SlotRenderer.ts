"use client";

// Top-level Pixi orchestrator: owns the Application/stage lifecycle, lays
// out the vault backdrop + reel frame + 5 ReelStrips + WinPresentation +
// FreeSpinsTransition, and exposes a small imperative API the React shell
// drives (spinToResult, celebrateWin, playBonusTransition). React never
// touches Pixi objects directly — this class is the only bridge.
import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { SlotPaylineWin, SlotSymbolId } from "@/lib/types";
import { buildSymbolTextures } from "../art/symbolTextures";
import { buildBackdropTexture, buildReelFrameTexture } from "../art/vaultBackdrop";
import { ReelStrip } from "./ReelStrip";
import { WinPresentation, type WinTier } from "./WinPresentation";
import { FreeSpinsTransition } from "./FreeSpinsTransition";
import { tween } from "./animUtils";

const BASE_REEL_DURATION = 620;
const REEL_STAGGER_MS = 130;
const BASE_FILLER = 18;
const ANTICIPATION_HOLD_MS = 620;

export interface SpinPresentationOptions {
  minScatterCount: number;
  onReelStop?: (index: number) => void;
  onAnticipationStart?: (index: number) => void;
}

export class SlotRenderer {
  readonly app: Application;
  private reels: ReelStrip[] = [];
  private reelsContainer!: Container;
  private backdropSprite!: Sprite;
  private frameSprite!: Sprite;
  private anticipationGlows = new Map<number, Graphics>();
  private win!: WinPresentation;
  private bonus!: FreeSpinsTransition;
  private textures: Record<SlotSymbolId, Texture>;
  private reelsCount: number;
  private rows: number;
  private width = 0;
  private height = 0;
  private cellSize = 0;

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

  private buildScene(width: number, height: number) {
    this.width = width;
    this.height = height;

    this.backdropSprite = new Sprite(buildBackdropTexture(width, height));
    this.app.stage.addChild(this.backdropSprite);

    const reelWindowWidth = width * 0.88;
    this.cellSize = reelWindowWidth / this.reelsCount;
    const reelWindowHeight = this.cellSize * this.rows;
    const originX = (width - reelWindowWidth) / 2;
    const originY = (height - reelWindowHeight) / 2;

    this.reelsContainer = new Container();
    this.reelsContainer.x = originX;
    this.reelsContainer.y = originY;
    this.app.stage.addChild(this.reelsContainer);

    this.reels = [];
    for (let i = 0; i < this.reelsCount; i++) {
      const reel = new ReelStrip({ rows: this.rows, cellSize: this.cellSize, textures: this.textures });
      reel.container.x = i * this.cellSize;
      this.reelsContainer.addChild(reel.container);
      this.reels.push(reel);
    }

    this.win = new WinPresentation(this.cellSize, this.rows);
    this.win.layer.x = originX;
    this.win.layer.y = originY;
    this.app.stage.addChild(this.win.layer);

    const chrome = this.cellSize * 0.18;
    this.frameSprite = new Sprite(buildReelFrameTexture(reelWindowWidth + chrome, reelWindowHeight + chrome));
    this.frameSprite.x = originX - chrome / 2;
    this.frameSprite.y = originY - chrome / 2;
    this.app.stage.addChild(this.frameSprite);

    this.bonus = new FreeSpinsTransition(width, height);
    this.app.stage.addChild(this.bonus.container);
  }

  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    this.app.renderer.resize(width, height);
    this.width = width;
    this.height = height;

    this.backdropSprite.texture.destroy(true);
    this.backdropSprite.texture = buildBackdropTexture(width, height);

    const reelWindowWidth = width * 0.88;
    this.cellSize = reelWindowWidth / this.reelsCount;
    const reelWindowHeight = this.cellSize * this.rows;
    const originX = (width - reelWindowWidth) / 2;
    const originY = (height - reelWindowHeight) / 2;

    this.reelsContainer.x = originX;
    this.reelsContainer.y = originY;
    this.reels.forEach((reel, i) => {
      reel.resize(this.cellSize);
      reel.container.x = i * this.cellSize;
    });

    this.win.resize(this.cellSize);
    this.win.layer.x = originX;
    this.win.layer.y = originY;

    const chrome = this.cellSize * 0.18;
    this.frameSprite.texture.destroy(true);
    this.frameSprite.texture = buildReelFrameTexture(reelWindowWidth + chrome, reelWindowHeight + chrome);
    this.frameSprite.x = originX - chrome / 2;
    this.frameSprite.y = originY - chrome / 2;

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
   * anticipation on any reel that completes a 3rd+ scatter after two have
   * already landed on earlier (already-stopped) reels. Resolves once every
   * reel has landed and settled.
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
  }

  private clearAnticipationGlows() {
    this.anticipationGlows.forEach((g) => g.destroy());
    this.anticipationGlows.clear();
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

  async playBonusTransition(spinsAwarded: number): Promise<void> {
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
