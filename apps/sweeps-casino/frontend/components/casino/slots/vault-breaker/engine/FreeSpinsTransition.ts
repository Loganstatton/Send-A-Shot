// The "VAULT BREACH" cinematic: the two vault door leaf textures
// (vaultBackdrop.ts) slam apart from the center, a gold/teal light burst
// fills the frame, and "VAULT BREACH — N FREE SPINS — START" pops in and
// holds before fading, handing control back to the reels. This is the one
// moment allowed to be genuinely showy — explicitly not a plain dialog.
import { Container, Graphics, Sprite, Text } from "pixi.js";
import { buildVaultDoorLeafTexture } from "../art/vaultBackdrop";
import { easeOutBack, easeOutCubic, sleep, tween } from "./animUtils";

export class FreeSpinsTransition {
  readonly container: Container;
  private leftLeaf: Sprite;
  private rightLeaf: Sprite;
  private flash: Graphics;
  private rays: Graphics;
  private titleText: Text;
  private subText: Text;
  private startText: Text;
  private width: number;
  private height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.container = new Container();
    this.container.visible = false;
    this.container.eventMode = "none";

    const leafSize = Math.max(width, height);
    const leftTex = buildVaultDoorLeafTexture(leafSize, "left");
    const rightTex = buildVaultDoorLeafTexture(leafSize, "right");

    this.leftLeaf = new Sprite(leftTex);
    this.leftLeaf.width = width / 2 + 4;
    this.leftLeaf.height = height;
    this.leftLeaf.x = 0;
    this.leftLeaf.y = 0;

    this.rightLeaf = new Sprite(rightTex);
    this.rightLeaf.width = width / 2 + 4;
    this.rightLeaf.height = height;
    this.rightLeaf.x = width / 2 - 4;
    this.rightLeaf.y = 0;

    this.rays = new Graphics();
    this.drawRays();
    this.rays.alpha = 0;
    this.rays.x = width / 2;
    this.rays.y = height / 2;

    this.flash = new Graphics().rect(0, 0, width, height).fill(0xfff3d0);
    this.flash.alpha = 0;

    this.titleText = new Text({
      text: "VAULT BREACH",
      style: {
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: Math.max(22, width * 0.09),
        fontWeight: "800",
        fill: 0xfff2c9,
        stroke: { color: 0x2a1a05, width: 6 },
        dropShadow: { color: 0x2dbfb0, blur: 18, distance: 0, alpha: 0.85 },
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
        fontSize: Math.max(15, width * 0.05),
        fontWeight: "700",
        fill: 0x9af2e6,
        stroke: { color: 0x06201d, width: 4 },
        align: "center",
      },
    });
    this.subText.anchor.set(0.5);
    this.subText.x = width / 2;
    this.subText.y = height * 0.56;
    this.subText.alpha = 0;

    this.startText = new Text({
      text: "STARTING…",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: Math.max(11, width * 0.032),
        fontWeight: "700",
        letterSpacing: 3,
        fill: 0xd4af37,
        align: "center",
      },
    });
    this.startText.anchor.set(0.5);
    this.startText.x = width / 2;
    this.startText.y = height * 0.68;
    this.startText.alpha = 0;

    this.container.addChild(this.flash, this.rays, this.leftLeaf, this.rightLeaf, this.titleText, this.subText, this.startText);
  }

  private drawRays() {
    this.rays.clear();
    const spikes = 14;
    const outer = Math.max(this.width, this.height) * 0.9;
    for (let i = 0; i < spikes; i++) {
      const a0 = (Math.PI * 2 * i) / spikes;
      const a1 = a0 + Math.PI / spikes;
      this.rays.moveTo(0, 0);
      this.rays.lineTo(Math.cos(a0) * outer, Math.sin(a0) * outer);
      this.rays.lineTo(Math.cos(a1) * outer, Math.sin(a1) * outer);
      this.rays.closePath();
      this.rays.fill({ color: i % 2 === 0 ? 0xf2d98a : 0x2dbfb0, alpha: 0.5 });
    }
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.leftLeaf.width = width / 2 + 4;
    this.leftLeaf.height = height;
    this.rightLeaf.width = width / 2 + 4;
    this.rightLeaf.x = width / 2 - 4;
    this.rightLeaf.height = height;
    this.flash.clear().rect(0, 0, width, height).fill(0xfff3d0);
    this.rays.x = width / 2;
    this.rays.y = height / 2;
    this.drawRays();
    this.titleText.x = this.subText.x = this.startText.x = width / 2;
    this.titleText.style.fontSize = Math.max(22, width * 0.09);
    this.subText.style.fontSize = Math.max(15, width * 0.05);
    this.startText.style.fontSize = Math.max(11, width * 0.032);
    this.titleText.y = height * 0.42;
    this.subText.y = height * 0.56;
    this.startText.y = height * 0.68;
  }

  /** Plays the full breach cinematic. Resolves once it's fully faded out and reels should resume. */
  async play(spinsAwarded: number): Promise<void> {
    this.container.visible = true;
    this.leftLeaf.x = 0;
    this.rightLeaf.x = this.width / 2 - 4;
    this.rays.rotation = 0;
    this.subText.text = `${spinsAwarded} FREE SPINS`;

    await tween(160, (p) => {
      this.flash.alpha = p * 0.85;
    });

    const doorOpen = tween(620, (p) => {
      const eased = easeOutCubic(p);
      this.leftLeaf.x = -eased * (this.width / 2 + 20);
      this.rightLeaf.x = this.width / 2 - 4 + eased * (this.width / 2 + 20);
      this.flash.alpha = Math.max(0, 0.85 - eased * 0.85);
      this.rays.alpha = eased * 0.7;
      this.rays.rotation = eased * 0.4;
    });
    await doorOpen;

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
    while (performance.now() - holdStart < 900) {
      const t = (performance.now() - holdStart) / 900;
      this.rays.rotation += 0.004;
      this.startText.alpha = 0.6 + Math.sin(t * Math.PI * 6) * 0.4;
      await sleep(16);
    }

    await tween(420, (p) => {
      const fade = 1 - p;
      this.titleText.alpha = fade;
      this.subText.alpha = fade;
      this.startText.alpha = fade;
      this.rays.alpha = fade * 0.7;
      this.leftLeaf.alpha = fade;
      this.rightLeaf.alpha = fade;
    });

    this.container.visible = false;
    this.leftLeaf.alpha = 1;
    this.rightLeaf.alpha = 1;
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}
