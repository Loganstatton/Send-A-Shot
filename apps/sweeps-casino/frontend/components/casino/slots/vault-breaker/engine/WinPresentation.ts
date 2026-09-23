// Winning-line presentation. Dims non-winning symbols by ~20%, illuminates
// + animates the winning ones with symbol-specific "personality", traces
// the actual payline geometry through the winning positions with a brief
// glow before fading, and escalates particle/flash weight across four
// presentation-only tiers (NORMAL / BIG / MEGA / EPIC — documented here as
// presentation thresholds, the backend has no concept of a win "tier").
// Particles are pooled (fixed-size array, reused across wins) rather than
// created/destroyed per celebration; per-symbol tweens reset sprites back
// to neutral transform/tint when cleared so the pooled ReelStrip sprites
// are never left in a rotated/tinted state for the next spin.
//
// V3: the stroked ring around every winning symbol is GONE — the product
// owner explicitly called it out as "debug-looking circles" and demanded it
// be removed entirely. Winners are now sold purely by: brightening (alpha),
// a soft additive glow blob behind the symbol (a blurred radial sprite, not
// an outline), the per-symbol personality animation, particles, and the
// payline trail — never a hard geometric ring/circle.
import { Container, Graphics, Sprite } from "pixi.js";
import type { SlotPaylineWin, SlotSymbolId } from "@/lib/types";
import type { ReelStrip } from "./ReelStrip";
import { tween, easeOutBack } from "./animUtils";
import { getGlowTexture } from "../art/vaultBackdrop";

export type WinTier = "normal" | "big" | "mega" | "epic";

const TIER_COLOR: Record<WinTier, number> = {
  normal: 0x2dbfb0,
  big: 0xd4af37,
  mega: 0xff5ec4,
  epic: 0xffb347,
};

const TIER_WEIGHT: Record<WinTier, { particles: number; ringDuration: number; flash: boolean }> = {
  normal: { particles: 6, ringDuration: 420, flash: false },
  big: { particles: 10, ringDuration: 520, flash: false },
  mega: { particles: 16, ringDuration: 640, flash: true },
  epic: { particles: 24, ringDuration: 780, flash: true },
};

const PARTICLE_POOL_SIZE = 64;

interface Particle {
  g: Graphics;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  active: boolean;
}

interface SymbolAnim {
  cancel: () => void;
}

export class WinPresentation {
  private fxLayer: Container;
  private glows: Container[] = [];
  private traceLine: Graphics;
  private flashRect: Graphics;
  private particles: Particle[] = [];
  private raf = 0;
  private lastTs = 0;
  private activeSymbolAnims: SymbolAnim[] = [];

  constructor(
    private cellSize: number,
    private rows: number
  ) {
    this.fxLayer = new Container();
    this.fxLayer.eventMode = "none";
    this.flashRect = new Graphics();
    this.flashRect.alpha = 0;
    this.traceLine = new Graphics();
    this.fxLayer.addChild(this.flashRect, this.traceLine);
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const g = new Graphics();
      g.visible = false;
      this.fxLayer.addChild(g);
      this.particles.push({ g, vx: 0, vy: 0, life: 0, maxLife: 1, active: false });
    }
  }

  get layer(): Container {
    return this.fxLayer;
  }

  resize(cellSize: number) {
    this.cellSize = cellSize;
  }

  celebrate(reels: ReelStrip[], wins: SlotPaylineWin[], tier: WinTier) {
    this.clearGlows();
    const weight = TIER_WEIGHT[tier];
    const winningKeys = new Set(wins.flatMap((w) => w.positions.map((p) => `${p.reel}:${p.row}`)));
    const color = TIER_COLOR[tier];

    // Non-winning symbols darken ~20% (alpha 0.8); winning symbols stay
    // fully lit and get a personality animation.
    reels.forEach((reel, reelIndex) => {
      for (let row = 0; row < this.rows; row++) {
        const sp = reel.spriteForRow(row);
        const isWinner = winningKeys.has(`${reelIndex}:${row}`);
        if (winningKeys.size === 0) {
          sp.alpha = 1;
          continue;
        }
        sp.alpha = isWinner ? 1 : 0.8;
      }
    });

    wins.forEach((win, winIdx) => {
      this.tracePayline(win, color, weight.ringDuration, winIdx === 0);
      win.positions.forEach((pos) => {
        const cx = pos.reel * this.cellSize + this.cellSize / 2;
        const cy = pos.row * this.cellSize + this.cellSize / 2;

        // Soft additive glow BEHIND the symbol — no stroked ring/circle.
        const glow = new Sprite(getGlowTexture());
        glow.anchor.set(0.5);
        glow.tint = color;
        glow.blendMode = "add";
        glow.x = cx;
        glow.y = cy;
        glow.alpha = 0;
        const glowSize = this.cellSize * 1.5;
        glow.width = glowSize;
        glow.height = glowSize;
        this.fxLayer.addChildAt(glow, 0); // behind the trace/particles, and behind symbols since fxLayer sits above reels — kept subtle via alpha
        this.glows.push(glow);
        tween(weight.ringDuration, (p) => {
          const pulse = Math.sin(Math.min(1, p * 1.6) * Math.PI * 0.5) * (1 - Math.max(0, p - 0.5) / 0.5);
          glow.alpha = pulse * 0.55;
          glow.scale.set(1 + p * 0.25);
        });

        this.spawnBurst(cx, cy, color, winIdx === 0 ? weight.particles : Math.round(weight.particles * 0.6));
        const sprite = reels[pos.reel]?.spriteForRow(pos.row);
        if (sprite) this.animatePersonality(sprite, win.symbolId, tier);
      });
    });

    if (weight.flash) {
      this.flashRect.clear().rect(-4000, -4000, 8000, 8000).fill({ color, alpha: 1 });
      tween(tier === "epic" ? 260 : 200, (p) => {
        this.flashRect.alpha = Math.sin(p * Math.PI) * (tier === "epic" ? 0.22 : 0.14);
      });
    }

    if (!this.raf) this.startParticleLoop();
  }

  private tracePayline(win: SlotPaylineWin, color: number, duration: number, primary: boolean) {
    if (win.positions.length < 2) return;
    const pts = [...win.positions].sort((a, b) => a.reel - b.reel).map((p) => ({
      x: p.reel * this.cellSize + this.cellSize / 2,
      y: p.row * this.cellSize + this.cellSize / 2,
    }));
    const g = new Graphics();
    g.alpha = 0;
    this.fxLayer.addChild(g);
    this.glows.push(g);
    const width = primary ? 5 : 3;
    tween(
      duration,
      (p) => {
        const drawCount = Math.max(1, Math.floor(pts.length * Math.min(1, p * 1.4)));
        g.clear();
        g.alpha = Math.min(1, p * 3) * (1 - Math.max(0, p - 0.65) / 0.35);
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < drawCount; i++) g.lineTo(pts[i].x, pts[i].y);
        g.stroke({ width, color, alpha: 0.95, cap: "round", join: "round" });
        for (let i = 0; i < drawCount; i++) {
          g.circle(pts[i].x, pts[i].y, width * 0.9).fill({ color: 0xffffff, alpha: 0.7 });
        }
      },
      (t) => t
    );
  }

  /** Symbol-specific winning animation, with a graceful reset back to neutral once done. */
  private animatePersonality(sprite: Sprite, symbolId: SlotSymbolId, tier: WinTier) {
    const scaleBoost = tier === "epic" ? 1.22 : tier === "mega" ? 1.16 : tier === "big" ? 1.1 : 1.06;
    const baseScaleX = sprite.scale.x || 1;
    const baseScaleY = sprite.scale.y || 1;
    const baseRotation = sprite.rotation;
    const baseTint = sprite.tint;
    const reset = () => {
      sprite.scale.set(baseScaleX, baseScaleY);
      sprite.rotation = baseRotation;
      sprite.tint = baseTint;
      sprite.y = sprite.y;
    };

    let handle: SymbolAnim;

    switch (symbolId) {
      case "DIAMOND": {
        const t = tween(900, (p) => {
          sprite.rotation = baseRotation + Math.sin(p * Math.PI * 2) * 0.22;
          const s = 1 + Math.sin(p * Math.PI) * (scaleBoost - 1);
          sprite.scale.set(baseScaleX * s, baseScaleY * s);
        });
        t.then(reset);
        handle = { cancel: () => t.cancel() };
        break;
      }
      case "GOLD_BAR": {
        const t = tween(700, (p) => {
          const flash = Math.abs(Math.sin(p * Math.PI * 3));
          sprite.tint = flash > 0.75 ? 0xfff2c9 : 0xffffff;
          const s = 1 + Math.sin(p * Math.PI) * (scaleBoost - 1) * 0.6;
          sprite.scale.set(baseScaleX * s, baseScaleY * s);
        });
        t.then(reset);
        handle = { cancel: () => t.cancel() };
        break;
      }
      case "COIN_STACK": {
        const baseY = sprite.y;
        const t = tween(750, (p) => {
          const bounce = Math.abs(Math.sin(p * Math.PI * 2.5)) * (1 - p);
          sprite.y = baseY - bounce * this.cellSize * 0.14;
          const s = 1 + Math.sin(p * Math.PI) * (scaleBoost - 1) * 0.7;
          sprite.scale.set(baseScaleX * s, baseScaleY * s);
        });
        t.then(() => {
          sprite.y = baseY;
          reset();
        });
        handle = { cancel: () => t.cancel() };
        break;
      }
      case "VAULT_KEY": {
        const t = tween(850, (p) => {
          sprite.rotation = baseRotation + p * Math.PI * 2;
          const s = 1 + Math.sin(p * Math.PI) * (scaleBoost - 1) * 0.6;
          sprite.scale.set(baseScaleX * s, baseScaleY * s);
        });
        t.then(reset);
        handle = { cancel: () => t.cancel() };
        break;
      }
      case "VAULTLINE_EMBLEM": {
        const t = tween(800, (p) => {
          sprite.rotation = baseRotation + Math.sin(p * Math.PI * 2) * 0.5;
          const s = 1 + Math.sin(p * Math.PI) * (scaleBoost - 1);
          sprite.scale.set(baseScaleX * s, baseScaleY * s);
        });
        t.then(reset);
        handle = { cancel: () => t.cancel() };
        break;
      }
      case "WILD": {
        const t = tween(900, (p) => {
          const pulse = Math.abs(Math.sin(p * Math.PI * 3));
          sprite.tint = pulse > 0.5 ? 0xaef7ec : 0xffffff;
          const s = 1 + pulse * (scaleBoost - 1);
          sprite.scale.set(baseScaleX * s, baseScaleY * s);
        });
        t.then(reset);
        handle = { cancel: () => t.cancel() };
        break;
      }
      default: {
        const t = tween(600, (p) => {
          const e = easeOutBack(Math.min(1, p * 1.4));
          const s = 1 + Math.sin(Math.min(1, p) * Math.PI) * (scaleBoost - 1) * e;
          sprite.scale.set(baseScaleX * s, baseScaleY * s);
        });
        t.then(reset);
        handle = { cancel: () => t.cancel() };
      }
    }

    this.activeSymbolAnims.push(handle);
  }

  clear() {
    this.clearGlows();
    this.activeSymbolAnims.forEach((a) => a.cancel());
    this.activeSymbolAnims = [];
    this.flashRect.alpha = 0;
    this.traceLine.clear();
  }

  private clearGlows() {
    this.glows.forEach((g) => g.destroy());
    this.glows = [];
  }

  private spawnBurst(x: number, y: number, color: number, count: number) {
    let spawned = 0;
    for (const p of this.particles) {
      if (p.active) continue;
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.4 + Math.random() * 2.4;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed - 1.4;
      p.life = 0;
      p.maxLife = 40 + Math.random() * 24;
      p.active = true;
      p.g.visible = true;
      p.g.clear();
      const r = 2 + Math.random() * 2.5;
      p.g.circle(0, 0, r).fill({ color, alpha: 1 });
      p.g.x = x;
      p.g.y = y;
      p.g.alpha = 1;
      spawned++;
      if (spawned >= count) break;
    }
  }

  private startParticleLoop() {
    this.lastTs = performance.now();
    const step = (now: number) => {
      const dt = Math.min(32, now - this.lastTs) / 16.6667;
      this.lastTs = now;
      let anyActive = false;
      for (const p of this.particles) {
        if (!p.active) continue;
        anyActive = true;
        p.life += dt;
        p.vy += 0.14 * dt;
        p.g.x += p.vx * dt;
        p.g.y += p.vy * dt;
        p.g.alpha = Math.max(0, 1 - p.life / p.maxLife);
        if (p.life >= p.maxLife) {
          p.active = false;
          p.g.visible = false;
        }
      }
      if (anyActive) {
        this.raf = requestAnimationFrame(step);
      } else {
        this.raf = 0;
      }
    };
    this.raf = requestAnimationFrame(step);
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.clearGlows();
    this.activeSymbolAnims.forEach((a) => a.cancel());
    this.activeSymbolAnims = [];
    this.fxLayer.destroy({ children: true });
  }
}
