// One reel column: a pooled set of sprites (never recreated per spin — only
// re-textured and repositioned) that cycles through symbol textures and
// lands exactly on a server-provided column. All motion is driven by a
// single position value (fractional index into a synthetic "spin strip",
// see animUtils.buildSpinStrip); rendering just maps that position onto
// sprite x/y + texture each frame.
import { BlurFilter, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { SlotSymbolId } from "@/lib/types";
import { bounceCurve, buildSpinStrip, easeOutCubic, reelPositionCurve, tween } from "./animUtils";

export interface ReelStripOptions {
  rows: number;
  cellSize: number;
  textures: Record<SlotSymbolId, Texture>;
}

export interface ReelSpinOptions {
  duration: number;
  fillerCount: number;
  /** Extra hold time (ms) inserted right before the deceleration phase — used for scatter anticipation. */
  anticipationHoldMs?: number;
  /** Fired the instant the anticipation hold phase begins (caller uses this to cue sound/glow). */
  onHoldStart?: () => void;
}

const BUFFER_ABOVE = 1;

export class ReelStrip {
  readonly container: Container;
  private scrollLayer: Container;
  private bounceLayer: Container;
  private sprites: Sprite[] = [];
  private strip: SlotSymbolId[];
  private pos = 0;
  private rows: number;
  private cellSize: number;
  private textures: Record<SlotSymbolId, Texture>;
  private blur: BlurFilter;
  private activeTween: { cancel: () => void } | null = null;

  constructor(opts: ReelStripOptions) {
    this.rows = opts.rows;
    this.cellSize = opts.cellSize;
    this.textures = opts.textures;

    this.container = new Container();
    this.bounceLayer = new Container();
    this.scrollLayer = new Container();
    this.container.addChild(this.bounceLayer);
    this.bounceLayer.addChild(this.scrollLayer);

    this.blur = new BlurFilter({ strengthX: 0, strengthY: 0, quality: 2 });
    this.scrollLayer.filters = [this.blur];

    const spriteCount = this.rows + BUFFER_ABOVE + 1;
    for (let i = 0; i < spriteCount; i++) {
      const sp = new Sprite(Texture.WHITE);
      sp.anchor.set(0.5);
      sp.width = this.cellSize * 0.96;
      sp.height = this.cellSize * 0.96;
      this.scrollLayer.addChild(sp);
      this.sprites.push(sp);
    }

    const mask = new Graphics().rect(0, 0, this.cellSize, this.rows * this.cellSize).fill(0xffffff);
    this.container.addChild(mask);
    this.container.mask = mask;

    this.strip = this.randomColumn();
    this.render();
  }

  private randomColumn(): SlotSymbolId[] {
    const ids = Object.keys(this.textures) as SlotSymbolId[];
    return Array.from({ length: this.rows }, () => ids[Math.floor(Math.random() * ids.length)]);
  }

  /** Currently-visible column, top-to-bottom, read off the strip at the current (integer, at rest) position. */
  currentColumn(): SlotSymbolId[] {
    const base = Math.round(this.pos);
    return Array.from({ length: this.rows }, (_, r) => this.strip[base + r] ?? this.strip[this.strip.length - this.rows + r]);
  }

  /** Sets the reel to a static column instantly — used for the idle/pre-spin state and to seed a fresh config load. */
  setStatic(column: SlotSymbolId[]) {
    this.activeTween?.cancel();
    this.strip = [...column];
    this.pos = 0;
    this.render();
  }

  resize(cellSize: number) {
    this.cellSize = cellSize;
    for (const sp of this.sprites) {
      sp.width = this.cellSize * 0.96;
      sp.height = this.cellSize * 0.96;
    }
    const mask = this.container.mask as Graphics;
    mask.clear().rect(0, 0, this.cellSize, this.rows * this.cellSize).fill(0xffffff);
    this.render();
  }

  private render() {
    const frac = this.pos - Math.floor(this.pos);
    const base = Math.floor(this.pos);
    for (let i = 0; i < this.sprites.length; i++) {
      const stripIndex = base - BUFFER_ABOVE + i;
      const clamped = Math.max(0, Math.min(this.strip.length - 1, stripIndex));
      const id = this.strip[clamped];
      const sp = this.sprites[i];
      sp.texture = this.textures[id] ?? Texture.WHITE;
      sp.x = this.cellSize / 2;
      sp.y = (i - BUFFER_ABOVE) * this.cellSize + this.cellSize / 2 - frac * this.cellSize;
    }
  }

  /** Sprite currently showing visible row `r` (0 = top). Used by WinPresentation for glow/dim. */
  spriteForRow(r: number): Sprite {
    return this.sprites[BUFFER_ABOVE + r];
  }

  get localWidth() {
    return this.cellSize;
  }

  /**
   * Spins from the current on-screen column to `finalColumn`, landing
   * exactly on it, then plays a small settle bounce. Resolves once the
   * bounce finishes.
   */
  async spin(finalColumn: SlotSymbolId[], opts: ReelSpinOptions): Promise<void> {
    this.activeTween?.cancel();
    const leadIn = this.currentColumn();
    this.strip = buildSpinStrip(leadIn, finalColumn, opts.fillerCount);
    const targetPos = this.strip.length - this.rows;
    this.pos = 0;
    this.render();

    const holdMs = opts.anticipationHoldMs ?? 0;
    const mainDuration = opts.duration;

    // Main accelerate/cycle/decelerate pass covers most of the distance,
    // leaving the final couple of symbols for a slow "hold" pass when
    // anticipation is active (a still-spinning reel that visibly hesitates
    // right before a suspected 3rd scatter lands).
    const holdPortion = holdMs > 0 ? 2 / this.rows : 0;
    const preHoldTarget = targetPos * (1 - holdPortion);

    const t1 = tween(
      mainDuration,
      (p) => {
        this.pos = reelPositionCurve(p) * preHoldTarget;
        this.blur.strengthY = Math.sin(Math.min(1, p / 0.6) * Math.PI) * 14;
        this.render();
      },
      (t) => t
    );
    this.activeTween = t1;
    await t1;

    if (holdMs > 0) {
      opts.onHoldStart?.();
      this.blur.strengthY = 4;
      const t2 = tween(holdMs, (p) => {
        this.pos = preHoldTarget + (targetPos - preHoldTarget) * easeOutCubic(Math.min(1, p * 1.15)) * 0.35;
        this.render();
      });
      this.activeTween = t2;
      await t2;
    }

    const finalApproachStart = this.pos;
    const t3 = tween(220, (p) => {
      const eased = easeOutCubic(p);
      this.pos = finalApproachStart + (targetPos - finalApproachStart) * eased;
      this.blur.strengthY = (1 - p) * 3;
      this.render();
    });
    this.activeTween = t3;
    await t3;

    this.pos = targetPos;
    this.blur.strengthY = 0;
    this.render();
    this.activeTween = null;

    await this.playBounce();
  }

  private async playBounce() {
    // A real mechanical settle: small, near-constant 2-4px overshoot
    // regardless of cell size — a proportional bounce (old: cellSize*0.1,
    // 6-10px on a typical cell) reads as "wobbly", not "mechanical".
    const amplitude = Math.max(2, Math.min(4, this.cellSize * 0.035));
    const t = tween(150, (p) => {
      this.bounceLayer.y = bounceCurve(p) * amplitude;
    });
    this.activeTween = t;
    await t;
    this.bounceLayer.y = 0;
    this.activeTween = null;
  }

  destroy() {
    this.activeTween?.cancel();
    this.container.destroy({ children: true });
  }
}
