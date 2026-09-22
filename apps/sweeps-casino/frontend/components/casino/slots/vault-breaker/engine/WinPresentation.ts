// Winning-line highlight: dims non-winning symbols, glows + gently scales
// the winning ones, and bursts a small pool of particle sprites from each
// winning cell. Particles are pooled (fixed-size array, reused across
// wins) rather than created/destroyed per celebration.
import { Container, Graphics, Sprite } from "pixi.js";
import type { SlotPaylineWin } from "@/lib/types";
import type { ReelStrip } from "./ReelStrip";
import { tween } from "./animUtils";

export type WinTier = "small" | "big" | "mega";

const TIER_COLOR: Record<WinTier, number> = {
  small: 0x2dbfb0,
  big: 0xd4af37,
  mega: 0xff5ec4,
};

const PARTICLE_POOL_SIZE = 48;

interface Particle {
  g: Graphics;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  active: boolean;
}

export class WinPresentation {
  private fxLayer: Container;
  private glows: Graphics[] = [];
  private particles: Particle[] = [];
  private raf = 0;
  private lastTs = 0;

  constructor(
    private cellSize: number,
    private rows: number
  ) {
    this.fxLayer = new Container();
    this.fxLayer.eventMode = "none";
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
    const winningKeys = new Set(wins.flatMap((w) => w.positions.map((p) => `${p.reel}:${p.row}`)));
    const color = TIER_COLOR[tier];

    reels.forEach((reel, reelIndex) => {
      for (let row = 0; row < this.rows; row++) {
        const sp = reel.spriteForRow(row);
        const isWinner = winningKeys.has(`${reelIndex}:${row}`);
        if (winningKeys.size === 0) {
          sp.alpha = 1;
          continue;
        }
        sp.alpha = isWinner ? 1 : 0.4;
      }
    });

    wins.forEach((win, winIdx) => {
      win.positions.forEach((pos) => {
        const cx = pos.reel * this.cellSize + this.cellSize / 2;
        const cy = pos.row * this.cellSize + this.cellSize / 2;
        const ring = new Graphics();
        ring.circle(0, 0, this.cellSize * 0.42).stroke({ width: 4, color, alpha: 0.9 });
        ring.x = cx;
        ring.y = cy;
        ring.alpha = 0;
        this.fxLayer.addChild(ring);
        this.glows.push(ring);
        tween(420, (p) => {
          ring.alpha = Math.sin(Math.min(1, p * 2) * Math.PI * 0.5) * (1 - p * 0.3);
          ring.scale.set(1 + p * 0.28);
        });
        this.spawnBurst(cx, cy, color, winIdx === 0);
      });
    });

    if (!this.raf) this.startParticleLoop();
  }

  clear() {
    this.clearGlows();
  }

  private clearGlows() {
    this.glows.forEach((g) => g.destroy());
    this.glows = [];
  }

  private spawnBurst(x: number, y: number, color: number, big: boolean) {
    const count = big ? 10 : 6;
    let spawned = 0;
    for (const p of this.particles) {
      if (p.active) continue;
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.4 + Math.random() * 2.2;
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
    this.fxLayer.destroy({ children: true });
  }
}
