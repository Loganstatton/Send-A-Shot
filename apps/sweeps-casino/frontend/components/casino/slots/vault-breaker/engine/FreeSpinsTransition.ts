// The "VAULT BREACH" cinematic, triggered once the reels have already
// stopped on a 3rd+ scatter (a purely presentational sequence over an
// already-determined server result — see SlotRenderer.spinToResult).
//
// V2 sequence (per the product owner's explicit beat list): reels stopped
// -> environment darkens -> lights flicker red -> a brief camera shake ->
// a vault wheel behind the reels begins rotating -> mechanical locks
// release -> the huge vault door leaves slam open -> gold/teal light
// spills through the seam with real particles -> "VAULT BREACH / N FREE
// SPINS / START" text -> fade out, handing control back to the reels.
// The old giant striped/starburst background is gone entirely, replaced by
// animated environmental lighting (a soft radial light-spill burst, not a
// pinwheel of colored triangles).
import { Container, Graphics, Sprite, Text } from "pixi.js";
import { buildVaultDoorLeafTexture, buildVaultWheelTexture } from "../art/vaultBackdrop";
import { easeOutBack, easeOutCubic, sleep, tween } from "./animUtils";

export interface FreeSpinsTransitionOptions {
  /** Called for a brief camera shake — SlotRenderer wires this to jitter the stage. */
  onShake?: (durationMs: number, amplitudePx: number) => Promise<void> | void;
  /** Called the instant the vault doors begin sliding open — used to time the door/impact sound. */
  onDoorsOpen?: () => void;
  /** Called the instant the mechanical locks release, just before the doors open — used to time the unlock sound. */
  onLocksRelease?: () => void;
}

const DUST_POOL = 48;

interface Dust {
  g: Graphics;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  active: boolean;
}

export class FreeSpinsTransition {
  readonly container: Container;
  private darken: Graphics;
  private redFlicker: Graphics;
  private wheel: Sprite;
  private locks: Graphics[] = [];
  private leftLeaf: Sprite;
  private rightLeaf: Sprite;
  private lightBurst: Graphics;
  private dust: Dust[] = [];
  private dustRaf = 0;
  private titleText: Text;
  private subText: Text;
  private startText: Text;
  private width: number;
  private height: number;
  private opts: FreeSpinsTransitionOptions;

  constructor(width: number, height: number, opts: FreeSpinsTransitionOptions = {}) {
    this.width = width;
    this.height = height;
    this.opts = opts;
    this.container = new Container();
    this.container.visible = false;
    this.container.eventMode = "none";

    this.darken = new Graphics().rect(0, 0, width, height).fill(0x000000);
    this.darken.alpha = 0;

    this.redFlicker = new Graphics().rect(0, 0, width, height).fill(0x7a1a10);
    this.redFlicker.alpha = 0;

    const wheelTex = buildVaultWheelTexture(Math.round(Math.min(width, height) * 0.9));
    this.wheel = new Sprite(wheelTex);
    this.wheel.anchor.set(0.5);
    this.wheel.x = width / 2;
    this.wheel.y = height / 2;
    this.wheel.alpha = 0;
    this.wheel.scale.set(0.001);

    for (let i = 0; i < 6; i++) {
      const lock = new Graphics();
      const a = (Math.PI * 2 * i) / 6;
      lock.roundRect(-10, -5, 20, 10, 2).fill(0x2a3040).stroke({ width: 1.5, color: 0x8ef2e6, alpha: 0.7 });
      lock.x = width / 2 + Math.cos(a) * Math.min(width, height) * 0.24;
      lock.y = height / 2 + Math.sin(a) * Math.min(width, height) * 0.24;
      lock.rotation = a;
      lock.alpha = 0;
      (lock as any)._angle = a;
      this.locks.push(lock);
    }

    const leafSize = Math.max(width, height);
    this.leftLeaf = new Sprite(buildVaultDoorLeafTexture(leafSize, "left"));
    this.leftLeaf.width = width / 2 + 4;
    this.leftLeaf.height = height;
    this.leftLeaf.x = 0;
    this.leftLeaf.y = 0;

    this.rightLeaf = new Sprite(buildVaultDoorLeafTexture(leafSize, "right"));
    this.rightLeaf.width = width / 2 + 4;
    this.rightLeaf.height = height;
    this.rightLeaf.x = width / 2 - 4;
    this.rightLeaf.y = 0;

    this.lightBurst = new Graphics();
    this.lightBurst.alpha = 0;
    this.lightBurst.x = width / 2;
    this.lightBurst.y = height / 2;

    this.titleText = new Text({
      text: "VAULT BREACH",
      style: {
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: Math.max(22, width * 0.1),
        fontWeight: "800",
        fill: 0xfff2c9,
        stroke: { color: 0x2a1a05, width: 6 },
        dropShadow: { color: 0x2dbfb0, blur: 20, distance: 0, alpha: 0.9 },
        align: "center",
      },
    });
    this.titleText.anchor.set(0.5);
    this.titleText.x = width / 2;
    this.titleText.y = height * 0.4;
    this.titleText.alpha = 0;

    this.subText = new Text({
      text: "",
      style: {
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: Math.max(15, width * 0.055),
        fontWeight: "700",
        fill: 0x9af2e6,
        stroke: { color: 0x06201d, width: 4 },
        align: "center",
      },
    });
    this.subText.anchor.set(0.5);
    this.subText.x = width / 2;
    this.subText.y = height * 0.55;
    this.subText.alpha = 0;

    this.startText = new Text({
      text: "START",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: Math.max(11, width * 0.036),
        fontWeight: "700",
        letterSpacing: 4,
        fill: 0xd4af37,
        align: "center",
      },
    });
    this.startText.anchor.set(0.5);
    this.startText.x = width / 2;
    this.startText.y = height * 0.68;
    this.startText.alpha = 0;

    for (let i = 0; i < DUST_POOL; i++) {
      const g = new Graphics();
      g.visible = false;
      this.dust.push({ g, vx: 0, vy: 0, life: 0, maxLife: 1, active: false });
    }

    this.container.addChild(
      this.darken,
      this.redFlicker,
      this.wheel,
      ...this.locks,
      this.lightBurst,
      this.leftLeaf,
      this.rightLeaf,
      ...this.dust.map((d) => d.g),
      this.titleText,
      this.subText,
      this.startText
    );
  }

  /** Merges in new callback handlers ahead of the next play() — lets the caller supply per-round audio hooks without reconstructing the transition. */
  setCallbacks(callbacks: FreeSpinsTransitionOptions) {
    this.opts = { ...this.opts, ...callbacks };
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.darken.clear().rect(0, 0, width, height).fill(0x000000);
    this.redFlicker.clear().rect(0, 0, width, height).fill(0x7a1a10);
    this.wheel.x = width / 2;
    this.wheel.y = height / 2;
    const wheelTex = buildVaultWheelTexture(Math.round(Math.min(width, height) * 0.9));
    this.wheel.texture.destroy(true);
    this.wheel.texture = wheelTex;
    this.locks.forEach((lock) => {
      const a = (lock as any)._angle as number;
      lock.x = width / 2 + Math.cos(a) * Math.min(width, height) * 0.24;
      lock.y = height / 2 + Math.sin(a) * Math.min(width, height) * 0.24;
    });
    this.leftLeaf.width = width / 2 + 4;
    this.leftLeaf.height = height;
    this.rightLeaf.width = width / 2 + 4;
    this.rightLeaf.x = width / 2 - 4;
    this.rightLeaf.height = height;
    this.lightBurst.x = width / 2;
    this.lightBurst.y = height / 2;
    this.titleText.x = this.subText.x = this.startText.x = width / 2;
    this.titleText.style.fontSize = Math.max(22, width * 0.1);
    this.subText.style.fontSize = Math.max(15, width * 0.055);
    this.startText.style.fontSize = Math.max(11, width * 0.036);
    this.titleText.y = height * 0.4;
    this.subText.y = height * 0.55;
    this.startText.y = height * 0.68;
  }

  private drawLightBurst(alphaScale: number) {
    this.lightBurst.clear();
    const outer = Math.max(this.width, this.height) * 0.75;
    const g1 = this.lightBurst;
    // Soft radial glow, not a striped starburst — real environmental light spilling from the seam.
    for (let ring = 0; ring < 3; ring++) {
      const r = outer * (0.35 + ring * 0.22);
      g1.circle(0, 0, r).fill({ color: ring % 2 === 0 ? 0xf2d98a : 0x2dbfb0, alpha: (0.16 - ring * 0.04) * alphaScale });
    }
  }

  private spawnDust(count: number) {
    let spawned = 0;
    for (const d of this.dust) {
      if (d.active) continue;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6;
      const speed = 1.2 + Math.random() * 2.6;
      d.vx = Math.cos(angle) * speed;
      d.vy = Math.sin(angle) * speed;
      d.life = 0;
      d.maxLife = 50 + Math.random() * 40;
      d.active = true;
      d.g.visible = true;
      d.g.clear();
      const r = 1.5 + Math.random() * 2.5;
      d.g.circle(0, 0, r).fill({ color: Math.random() > 0.5 ? 0xf2d98a : 0x8ef2e6, alpha: 1 });
      d.g.x = this.width / 2 + (Math.random() - 0.5) * 40;
      d.g.y = this.height / 2 + (Math.random() - 0.5) * 40;
      spawned++;
      if (spawned >= count) break;
    }
    if (!this.dustRaf) this.startDustLoop();
  }

  private startDustLoop() {
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(32, now - last) / 16.6667;
      last = now;
      let any = false;
      for (const d of this.dust) {
        if (!d.active) continue;
        any = true;
        d.life += dt;
        d.g.x += d.vx * dt;
        d.g.y += d.vy * dt;
        d.g.alpha = Math.max(0, 1 - d.life / d.maxLife);
        if (d.life >= d.maxLife) {
          d.active = false;
          d.g.visible = false;
        }
      }
      this.dustRaf = any ? requestAnimationFrame(step) : 0;
    };
    this.dustRaf = requestAnimationFrame(step);
  }

  /** Plays the full breach cinematic. Resolves once it's fully faded out and reels should resume. */
  async play(spinsAwarded: number): Promise<void> {
    this.container.visible = true;
    this.leftLeaf.x = 0;
    this.leftLeaf.alpha = 1;
    this.rightLeaf.x = this.width / 2 - 4;
    this.rightLeaf.alpha = 1;
    this.wheel.alpha = 0;
    this.wheel.scale.set(0.001);
    this.wheel.rotation = 0;
    this.locks.forEach((l) => (l.alpha = 0));
    this.subText.text = `${spinsAwarded} FREE SPINS`;

    // 1. Environment darkens.
    await tween(260, (p) => {
      this.darken.alpha = p * 0.6;
    });

    // 2. Lights flicker red, with a brief camera shake mid-flicker.
    const flickerPattern = [0.55, 0.1, 0.7, 0.05, 0.85, 0];
    const shakeResult = this.opts.onShake?.(260, 6);
    for (let i = 0; i < flickerPattern.length; i++) {
      this.redFlicker.alpha = flickerPattern[i];
      await sleep(45);
    }
    if (shakeResult instanceof Promise) await shakeResult;

    // 3. Vault wheel behind the reels begins rotating.
    const wheelIn = tween(360, (p) => {
      const e = easeOutBack(Math.min(1, p));
      this.wheel.alpha = Math.min(1, p * 1.6) * 0.85;
      this.wheel.scale.set(0.7 + 0.3 * e);
    });
    let wheelRotation = 0;
    const spinWheel = () => {
      wheelRotation += 0.05;
      this.wheel.rotation = wheelRotation;
    };
    const wheelTicker = setInterval(spinWheel, 16);
    await wheelIn;

    // 4. Mechanical locks release.
    this.opts.onLocksRelease?.();
    await tween(320, (p) => {
      const e = easeOutCubic(p);
      this.locks.forEach((lock) => {
        lock.alpha = Math.max(0, 1 - p * 1.3);
        const a = (lock as any)._angle as number;
        const dist = e * 22;
        lock.x = this.width / 2 + Math.cos(a) * (Math.min(this.width, this.height) * 0.24 + dist);
        lock.y = this.height / 2 + Math.sin(a) * (Math.min(this.width, this.height) * 0.24 + dist);
      });
    });

    // 5. The huge vault door opens; gold/teal light spills through with particles.
    this.opts.onDoorsOpen?.();
    this.spawnDust(28);
    const doorOpen = tween(640, (p) => {
      const eased = easeOutCubic(p);
      this.leftLeaf.x = -eased * (this.width / 2 + 30);
      this.rightLeaf.x = this.width / 2 - 4 + eased * (this.width / 2 + 30);
      this.drawLightBurst(eased);
      this.lightBurst.alpha = eased;
      this.wheel.alpha = Math.max(0, 0.85 - eased * 0.5);
    });
    await doorOpen;
    this.spawnDust(20);

    // 6. Title sequence.
    const textIn = tween(360, (p) => {
      const e = easeOutBack(Math.min(1, p));
      this.titleText.alpha = Math.min(1, p * 1.4);
      this.titleText.scale.set(0.7 + 0.3 * e);
    });
    await textIn;

    await tween(280, (p) => {
      this.subText.alpha = Math.min(1, p * 1.4);
    });

    await tween(220, (p) => {
      this.startText.alpha = Math.min(1, p * 1.4);
    });

    const holdStart = performance.now();
    while (performance.now() - holdStart < 800) {
      const t = (performance.now() - holdStart) / 800;
      this.startText.alpha = 0.6 + Math.sin(t * Math.PI * 6) * 0.4;
      await sleep(16);
    }

    clearInterval(wheelTicker);

    // 7. Fade everything out, handing control back to the reels.
    await tween(420, (p) => {
      const fade = 1 - p;
      this.titleText.alpha = fade;
      this.subText.alpha = fade;
      this.startText.alpha = fade;
      this.lightBurst.alpha = fade;
      this.leftLeaf.alpha = fade;
      this.rightLeaf.alpha = fade;
      this.wheel.alpha = fade * 0.4;
      this.darken.alpha = 0.6 * fade;
    });

    this.container.visible = false;
    this.leftLeaf.alpha = 1;
    this.rightLeaf.alpha = 1;
    this.darken.alpha = 0;
    this.redFlicker.alpha = 0;
  }

  destroy() {
    if (this.dustRaf) cancelAnimationFrame(this.dustRaf);
    this.container.destroy({ children: true });
  }
}
