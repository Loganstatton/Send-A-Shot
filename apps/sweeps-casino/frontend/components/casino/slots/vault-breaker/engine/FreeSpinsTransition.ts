// The free-spins/"Vault Breach" bonus intro transition.
//
// OUT OF SCOPE this pass (spec points 31-32 — explicitly deferred to a
// future "real art" pass): this is intentionally a minimal, honest
// placeholder — a dark scrim plus plain text — NOT the elaborate
// door-leaves/wheel/photo cinematic the prior pass built. That version
// depended on backdrop photos and heavy canvas-drawn "painted metal" art
// that this pass's placeholder policy explicitly forbids generating more
// of. The only requirement this round is that triggering it never crashes
// and hands control back to the reels correctly — it is not being judged
// on visual polish this round. A richer cinematic can layer on top of real
// art later without restructuring the SlotRenderer<->FreeSpinsTransition
// contract (play()/resize()/destroy()/setCallbacks() below).
import { Container, Graphics, Text } from "pixi.js";
import { easeOutBack, sleep, tween } from "./animUtils";

export interface FreeSpinsTransitionOptions {
  /** Called for a brief camera shake — SlotRenderer wires this to jitter the world container. */
  onShake?: (durationMs: number, amplitudePx: number) => Promise<void> | void;
  /** Called for the "camera pushes in" beat — SlotRenderer wires this to a small scale-up on the world container. */
  onPush?: (durationMs: number, amount: number) => Promise<void> | void;
  /** Called the instant the bonus "opens" — used to time a door/impact sound. */
  onDoorsOpen?: () => void;
  /** Called just before onDoorsOpen — used to time an unlock sound. */
  onLocksRelease?: () => void;
}

export class FreeSpinsTransition {
  readonly container: Container;
  private darken: Graphics;
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

    this.titleText = new Text({
      text: "VAULT BREACH",
      style: {
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: Math.max(22, width * 0.1),
        fontWeight: "800",
        fill: 0xfff2c9,
        stroke: { color: 0x2a1a05, width: 6 },
        align: "center",
      },
    });
    this.titleText.anchor.set(0.5);
    this.titleText.x = width / 2;
    this.titleText.y = height * 0.42;
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
    this.subText.y = height * 0.54;
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
    this.startText.y = height * 0.64;
    this.startText.alpha = 0;

    this.container.addChild(this.darken, this.titleText, this.subText, this.startText);
  }

  /** Merges in new callback handlers ahead of the next play() — lets the caller supply per-round audio hooks without reconstructing the transition. */
  setCallbacks(callbacks: FreeSpinsTransitionOptions) {
    this.opts = { ...this.opts, ...callbacks };
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.darken.clear().rect(0, 0, width, height).fill(0x000000);
    this.titleText.x = this.subText.x = this.startText.x = width / 2;
    this.titleText.style.fontSize = Math.max(22, width * 0.1);
    this.subText.style.fontSize = Math.max(15, width * 0.055);
    this.startText.style.fontSize = Math.max(11, width * 0.036);
    this.titleText.y = height * 0.42;
    this.subText.y = height * 0.54;
    this.startText.y = height * 0.64;
  }

  /** Plays the (minimal) bonus intro. Resolves once it's fully faded out and reels should resume. */
  async play(spinsAwarded: number): Promise<void> {
    this.container.visible = true;
    this.subText.text = `${spinsAwarded} FREE SPINS`;

    await tween(220, (p) => {
      this.darken.alpha = p * 0.72;
    });

    const shakeResult = this.opts.onShake?.(160, 4);
    this.opts.onLocksRelease?.();
    if (shakeResult instanceof Promise) await shakeResult;
    this.opts.onDoorsOpen?.();
    const pushResult = this.opts.onPush?.(400, 0.03);

    const textIn = tween(320, (p) => {
      const e = easeOutBack(Math.min(1, p));
      this.titleText.alpha = Math.min(1, p * 1.4);
      this.titleText.scale.set(0.7 + 0.3 * e);
    });
    await textIn;
    if (pushResult instanceof Promise) await pushResult;

    await tween(240, (p) => {
      this.subText.alpha = Math.min(1, p * 1.4);
    });
    await tween(200, (p) => {
      this.startText.alpha = Math.min(1, p * 1.4);
    });

    const holdStart = performance.now();
    while (performance.now() - holdStart < 650) {
      const t = (performance.now() - holdStart) / 650;
      this.startText.alpha = 0.6 + Math.sin(t * Math.PI * 6) * 0.4;
      await sleep(16);
    }

    await tween(360, (p) => {
      const fade = 1 - p;
      this.titleText.alpha = fade;
      this.subText.alpha = fade;
      this.startText.alpha = fade;
      this.darken.alpha = 0.72 * fade;
    });

    this.container.visible = false;
    this.darken.alpha = 0;
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}
