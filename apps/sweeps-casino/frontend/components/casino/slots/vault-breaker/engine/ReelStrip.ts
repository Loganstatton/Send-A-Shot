// One reel column: a pooled set of sprites (never recreated per spin — only
// re-textured and repositioned) that cycles through symbol textures and
// lands exactly on a server-provided column. All motion is driven by a
// single position value (fractional index into a synthetic "spin strip",
// see animUtils.buildSpinStrip); rendering just maps that position onto
// sprite x/y + texture each frame. This is the true-reel-strip contract
// from the spec (point 4): the strip holds many more symbols than the
// visible rows, symbols enter through the top and leave through the
// bottom, and a long run of REAL symbols passes through the window during
// a spin — never an abstract "spinning" placeholder.
//
// REBUILD (V4) vs the prior pass:
//  - BlurFilter strength is capped far lower (max ~3, quality 1) so at full
//    speed the player still perceives distinct symbol silhouettes moving —
//    root cause #2 from the product owner's review ("teal blurry smear")
//    was this filter tuned far too strong plus vertical stretch stacked on
//    top; both are now conservative and motion is sold primarily by real
//    symbol density + fast position updates, not the blur.
//  - Every symbol source is now a uniform 1024x1024 canvas (see
//    art/symbolAssets.ts), so the per-symbol aspect-fit below is a no-op in
//    practice — but it stays generic/aspect-safe rather than hardcoding
//    "square", so nothing breaks if a future real-art symbol isn't exactly
//    square. FILL is raised so symbols read as "much larger" (spec point 8)
//    while still leaving a hair of breathing room between rows so a fast
//    column doesn't look like an edge-to-edge tiled texture.
//  - Timing is driven by a per-reel `ReelPersonality` (see animUtils.ts) —
//    accel/decel/bounce all vary slightly per reel index, so five reels
//    never look like one curve copy-pasted five times (spec point 7).
import { BlurFilter, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { SlotSymbolId } from "@/lib/types";
import { buildSpinStrip, easeOutBackSettle, easeOutCubic, reelPositionCurve, tween, type ReelPersonality } from "./animUtils";

export interface ReelStripOptions {
  rows: number;
  /** Reel column width in px — reels fill ~94-96% of the phone's width (spec point 8). */
  cellWidth: number;
  /** Per-row height in px — deliberately independent of cellWidth: the reel window fills the FULL available vertical space (never leaving dead space above/below — spec point 16), so on a narrow-tall phone rows are naturally taller than they are wide. Symbols stay visually square/uniform regardless (see FILL below, sized off min(cellWidth,cellHeight)) — never stretched to fill the taller cell. */
  cellHeight: number;
  textures: Record<SlotSymbolId, Texture>;
}

export interface ReelSpinOptions {
  personality: ReelPersonality;
  fillerCount: number;
  /** Extra hold time (ms) inserted right before the deceleration phase — used for scatter anticipation. */
  anticipationHoldMs?: number;
  /** Fired the instant the anticipation hold phase begins (caller uses this to cue sound/glow). */
  onHoldStart?: () => void;
  /** Delay (ms) before this reel starts moving at all — the per-reel stagger, applied entirely inside spin() so the returned promise still only resolves once this reel has actually landed and settled. */
  startDelayMs?: number;
}

const BUFFER_ABOVE = 1;
// Symbols fill this fraction of a cell's edge — raised from V3's 0.86 to
// read as genuinely large on-screen (spec point 8), while the remaining
// gap plus the reel-divider lines (drawn by SlotRenderer) are the ONLY
// separation between symbols — never a bordered/boxed cell (spec point 1).
const FILL = 0.93;
// Motion-blur ceiling — deliberately conservative (V3 went up to 14 with
// quality 2, which is exactly the "teal blurry smear" the product owner
// called out). At this ceiling individual symbol silhouettes are still
// perceivable at full speed; verified by scrubbing the recorded video
// frame-by-frame during a spin (see build report).
const MAX_BLUR = 2.6;
const MAX_STRETCH_Y = 0.14;
const MAX_STRETCH_X_SHRINK = 0.05;

export class ReelStrip {
  readonly container: Container;
  private scrollLayer: Container;
  private bounceLayer: Container;
  private sprites: Sprite[] = [];
  private strip: SlotSymbolId[];
  private pos = 0;
  private rows: number;
  private cellWidth: number;
  private cellHeight: number;
  private textures: Record<SlotSymbolId, Texture>;
  private blur: BlurFilter;
  private activeTween: { cancel: () => void } | null = null;
  /** Per-visible-row idle "attention" scale multiplier (WILD/SCATTER breathing — spec points 19/27/28), applied ON TOP of the correct box-fit size inside render() below. NEVER set via `sprite.scale.set(...)` directly from outside — that clobbers the width/height-derived fit scale with an absolute value and balloons the symbol toward native texture size (a real bug this pass fixed: idle WILD/SCATTER pulsing was doing exactly that in an earlier draft). */
  private idlePulse: number[];

  constructor(opts: ReelStripOptions) {
    this.rows = opts.rows;
    this.cellWidth = opts.cellWidth;
    this.cellHeight = opts.cellHeight;
    this.textures = opts.textures;
    this.idlePulse = new Array(opts.rows).fill(1);

    this.container = new Container();
    this.bounceLayer = new Container();
    this.scrollLayer = new Container();
    this.container.addChild(this.bounceLayer);
    this.bounceLayer.addChild(this.scrollLayer);

    this.blur = new BlurFilter({ strengthX: 0, strengthY: 0, quality: 1 });
    this.scrollLayer.filters = [this.blur];

    const spriteCount = this.rows + BUFFER_ABOVE + 1;
    for (let i = 0; i < spriteCount; i++) {
      const sp = new Sprite(Texture.WHITE);
      sp.anchor.set(0.5);
      this.scrollLayer.addChild(sp);
      this.sprites.push(sp);
    }

    const mask = new Graphics().rect(0, 0, this.cellWidth, this.rows * this.cellHeight).fill(0xffffff);
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

  resize(cellWidth: number, cellHeight: number) {
    this.cellWidth = cellWidth;
    this.cellHeight = cellHeight;
    const mask = this.container.mask as Graphics;
    mask.clear().rect(0, 0, this.cellWidth, this.rows * this.cellHeight).fill(0xffffff);
    this.render();
  }

  private render() {
    const frac = this.pos - Math.floor(this.pos);
    const base = Math.floor(this.pos);
    // Subtle motion stretch on top of the (conservative) blur filter — each
    // symbol elongates vertically and narrows slightly at speed, like a
    // real reel strip under a touch of motion blur. Kept small deliberately
    // (see MAX_STRETCH_*) so it enhances, never replaces, seeing real
    // symbols pass through the window.
    const speedFrac = Math.min(1, this.blur.strengthY / MAX_BLUR);
    const stretchY = 1 + speedFrac * MAX_STRETCH_Y;
    const stretchX = 1 - speedFrac * MAX_STRETCH_X_SHRINK;
    // Symbols are always sized off the SMALLER of cellWidth/cellHeight, so
    // they stay square/uniform (spec point 10) even when rows are taller
    // than they are wide (which happens whenever the reel window fills the
    // full available height on a narrow phone — see SlotRenderer's
    // computeLayout) — never stretched to fill a non-square cell.
    const baseBox = Math.min(this.cellWidth, this.cellHeight) * FILL;
    for (let i = 0; i < this.sprites.length; i++) {
      const stripIndex = base - BUFFER_ABOVE + i;
      const clamped = Math.max(0, Math.min(this.strip.length - 1, stripIndex));
      const id = this.strip[clamped];
      const sp = this.sprites[i];
      const tex = this.textures[id] ?? Texture.WHITE;
      sp.texture = tex;
      const aspect = tex.width > 0 && tex.height > 0 ? tex.width / tex.height : 1;
      let boxW = baseBox;
      let boxH = baseBox;
      if (aspect > 1) boxH = boxW / aspect;
      else boxW = boxH * aspect;
      // Idle attention pulse (WILD/SCATTER breathing) is applied here, on
      // top of the correct fit size — see the `idlePulse` field comment
      // for why this must never be a raw `sprite.scale.set(...)` call.
      const visibleRow = i - BUFFER_ABOVE;
      const pulse = visibleRow >= 0 && visibleRow < this.rows ? this.idlePulse[visibleRow] : 1;
      sp.x = this.cellWidth / 2;
      sp.y = (i - BUFFER_ABOVE) * this.cellHeight + this.cellHeight / 2 - frac * this.cellHeight;
      sp.width = boxW * stretchX * pulse;
      sp.height = boxH * stretchY * pulse;
    }
  }

  /** Sets the idle "attention" scale multiplier for visible row `r` (0 = top) — see the `idlePulse` field comment. Call refresh() after a batch of these to actually repaint. */
  setIdlePulse(r: number, factor: number) {
    if (r < 0 || r >= this.rows) return;
    this.idlePulse[r] = factor;
  }

  /** Repaints from current state (position/textures/idlePulse) without changing anything else — used by SlotRenderer's idle tick after calling setIdlePulse(). */
  refresh() {
    this.render();
  }

  /** Sprite currently showing visible row `r` (0 = top). Used by WinPresentation for glow/dim. */
  spriteForRow(r: number): Sprite {
    return this.sprites[BUFFER_ABOVE + r];
  }

  get localWidth() {
    return this.cellWidth;
  }

  /**
   * Spins from the current on-screen column to `finalColumn`, landing
   * exactly on it, then plays a small settle bounce. Resolves once the
   * bounce finishes. Timing (accel/full-speed/decel/bounce) comes from
   * `opts.personality` — see animUtils.REEL_PERSONALITY for why each reel
   * gets slightly different numbers.
   */
  async spin(finalColumn: SlotSymbolId[], opts: ReelSpinOptions): Promise<void> {
    this.activeTween?.cancel();

    if (opts.startDelayMs && opts.startDelayMs > 0) {
      let cancelled = false;
      let timeoutId: ReturnType<typeof setTimeout>;
      const delay = new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, opts.startDelayMs);
      });
      this.activeTween = {
        cancel: () => {
          cancelled = true;
          clearTimeout(timeoutId);
        },
      };
      await delay;
      if (cancelled) return;
    }

    const leadIn = this.currentColumn();
    this.strip = buildSpinStrip(leadIn, finalColumn, opts.fillerCount);
    const targetPos = this.strip.length - this.rows;
    this.pos = 0;
    this.render();

    const { duration: mainDuration, accelMs, decelMs, bounceMs, bounceAmpPx } = opts.personality;
    const accelFrac = accelMs / mainDuration;
    const decelFrac = decelMs / mainDuration;
    const holdMs = opts.anticipationHoldMs ?? 0;

    // Main accelerate/cycle/decelerate pass covers most of the distance,
    // leaving the final couple of symbols for a slow "hold" pass when
    // anticipation is active (a still-spinning reel that visibly hesitates
    // right before a suspected 3rd scatter lands).
    const holdPortion = holdMs > 0 ? 2 / this.rows : 0;
    const preHoldTarget = targetPos * (1 - holdPortion);

    // Reference "full speed" rate for this reel, estimated analytically off
    // the position curve's own mid-flight slope (sampled numerically) — NOT
    // a hardcoded constant, so it self-calibrates to this reel's actual
    // distance/duration. Instantaneous velocity below is measured every
    // frame from the real position delta, then expressed as a fraction of
    // this reference: motion blur genuinely tracks how fast the reel is
    // moving right now, not a fixed ramp shape.
    const midSlope =
      (reelPositionCurve(0.51, accelFrac, decelFrac) - reelPositionCurve(0.49, accelFrac, decelFrac)) / 0.02;
    const fullSpeedCellsPerMs = Math.max(1e-6, (midSlope * preHoldTarget) / mainDuration);
    let lastPos = 0;
    let lastFrameTime = performance.now();

    const t1 = tween(mainDuration, (p) => {
      const newPos = reelPositionCurve(p, accelFrac, decelFrac) * preHoldTarget;
      const now = performance.now();
      const dtMs = Math.max(1, now - lastFrameTime);
      const instantCellsPerMs = Math.abs(newPos - lastPos) / dtMs;
      lastPos = newPos;
      lastFrameTime = now;
      this.pos = newPos;
      const speedFrac = Math.min(1.15, instantCellsPerMs / fullSpeedCellsPerMs);
      this.blur.strengthY = Math.max(0, speedFrac) * MAX_BLUR;
      this.render();
    });
    this.activeTween = t1;
    await t1;

    if (holdMs > 0) {
      opts.onHoldStart?.();
      this.blur.strengthY = MAX_BLUR * 0.35;
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
      this.blur.strengthY = (1 - p) * MAX_BLUR * 0.3;
      this.render();
    });
    this.activeTween = t3;
    await t3;

    this.pos = targetPos;
    this.blur.strengthY = 0;
    this.render();
    this.activeTween = null;

    await this.playBounce(bounceMs, bounceAmpPx);
  }

  private async playBounce(durationMs: number, amplitudePx: number) {
    // A real mechanical settle: small overshoot then spring back — distinct
    // per reel via `amplitudePx`/`durationMs` (see REEL_PERSONALITY), never
    // proportional-to-cellSize (that read as "wobbly" in V3). Driven by
    // easeOutBack itself (ported from the reference demo) rather than a
    // decaying sine: the same curve family used everywhere else in this
    // engine for a "pop then settle" (see SlotRenderer's big-win banner),
    // so a reel's landing reads as the same mechanism, not a separate one.
    if (durationMs <= 0 || amplitudePx === 0) {
      this.bounceLayer.y = 0;
      this.activeTween = null;
      return;
    }
    const t = tween(durationMs, (p) => {
      this.bounceLayer.y = easeOutBackSettle(p) * amplitudePx;
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
