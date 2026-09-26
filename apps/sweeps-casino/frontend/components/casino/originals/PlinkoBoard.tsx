"use client";

// The Plinko board — real Matter.js physics simulation, not a scripted
// animation. The backend has already decided each round's outcome before
// any of this runs (`resultDetail.bucket`); this component's job is to
// render a physically honest visualization of a drop that actually lands
// there.
//
// How the honesty guarantee works (see plinkoPhysics.ts for the full
// simulation): the moment a drop is requested, we run the headless Matter.js
// simulation repeatedly — real gravity, real peg collisions, real
// restitution, just stepped far faster than real time, with no rendering —
// varying only the ball's SPAWN conditions between attempts (never applying
// any force once it's released) until one full run's ball actually,
// physically settles in the correct bucket. We record that run's exact
// trajectory (ball x/y/angle every physics step) and play back *that*
// recording in real time here, driven entirely by requestAnimationFrame
// reading the recorded physics state each frame — never CSS keyframes,
// never a hand-authored path.
//
// MULTIPLE SIMULTANEOUS BALLS: each drop gets its own independent headless
// simulation, run in its own private Matter.js world, the instant it's
// requested — so several drops in flight at once each have a genuinely
// independent physical run (unique id, unique trajectory, unique landing
// bucket). This board then just plays back however many recorded
// trajectories are currently active, concurrently, in the same canvas.
// Balls never need collision filters to avoid hitting each other because
// they were never simulated in a shared world to begin with — each one's
// outcome is independently guaranteed correct (matches its own server
// result) regardless of how many other balls are in flight, which is a
// *stronger* guarantee than a shared live world would give under the
// honesty constraint. Visually, this is indistinguishable from "real"
// concurrent physics and balls do naturally pass through one another.
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useSoundStore } from "@/lib/stores/sound-store";
import { plinkoAudio } from "./plinkoAudio";
import {
  computePlinkoLayout,
  simulateUntilMatch,
  VIRTUAL_WIDTH,
  VIRTUAL_HEIGHT,
  type PlinkoLayout,
  type TrajectoryFrame,
  type PegHitEvent,
} from "./plinkoPhysics";

export interface PlinkoDropRequest {
  /** Unique per round — the server round id is ideal. */
  id: string;
  bucket: number;
}

interface PlinkoBoardProps {
  rows: number;
  multiplierTable: number[];
  /**
   * Append-only list of drops to animate. The board tracks which ids it has
   * already started (and independently garbage-collects settled balls after
   * they've been visible for a while) — the parent never needs to remove
   * entries from this array, only append new ones.
   */
  drops: PlinkoDropRequest[];
  /** Fired once per drop id, after that ball's full landing beat (settle + pocket illuminate) has played. */
  onLanded: (id: string) => void;
  /** Bucket value at/above which a landing gets the bigger "big win" cue/flourish. */
  bigWinMultiplier?: number;
}

type BucketTier = "cold" | "neutral" | "warm" | "hot";

// Fixed value bands (not position-based) so a bucket's heat always reflects
// what it actually pays: dim/muted below breakeven, a neutral read around
// 1x, and a rising gold glow for genuinely high multipliers.
function bucketTier(value: number): BucketTier {
  if (value < 1) return "cold";
  if (value < 2) return "neutral";
  if (value < 5) return "warm";
  return "hot";
}

const bucketTierClasses: Record<BucketTier, string> = {
  cold: "bg-surface-raised/70 text-text-muted border border-border/40",
  neutral: "bg-surface-raised text-text-primary border border-border/70",
  warm: "bg-accent-gc/15 text-accent-gc border border-accent-gc/50",
  hot: "bg-accent-gc/20 text-accent-gc border border-accent-gc/70 text-glow-gold",
};

const FRAME_MS = 1000 / 60;
const PEG_FLASH_MS = 220;
const TRAIL_LENGTH = 6;
const TRAIL_SPEED_THRESHOLD = 1.3;
// How long the ball visibly sits settled + the pocket stays illuminated
// before the result banner / balance animation takes over. Product spec:
// the whole landing interaction (bounce, settle, illuminate, multiplier
// enlarge, banner, balance tick) should read as ~500-900ms end to end;
// this is the illuminate-and-hold portion before we hand off to the
// banner, tuned so the full beat lands inside that window.
const LAND_PAUSE_MS = 620;
// A settled ball stays visible, resting in its pocket, long after landing
// (never "disappears immediately" per the product spec) — this just bounds
// how long we keep drawing/tracking it so a long session doesn't leak
// memory into an ever-growing set of resting balls.
const BALL_VISIBLE_AFTER_LAND_MS = 3200;
// The pocket's bright "lit" highlight (label pill glow/scale-up) is a brief
// beat, not something that stays lit the whole time the ball rests there —
// separate from BALL_VISIBLE_AFTER_LAND_MS above.
const LIT_VISUAL_MS = 1100;
// Rapid-fire peg hits within this window get a small rising pitch bump
// (plinkoAudio.pegHit's consecutiveIndex) so a burst of hits — one ball
// ricocheting fast, or several balls in flight at once — doesn't sound like
// the same sample replaying.
const PEG_HIT_STREAK_WINDOW_MS = 150;
const AMBIENT_PARTICLE_COUNT = 16;

interface PegFlash {
  startedAt: number;
}

interface DropState {
  id: string;
  layout: PlinkoLayout;
  frames: TrajectoryFrame[];
  pegHits: PegHitEvent[];
  bucket: number;
  startedAt: number | null;
  landedAt: number | null;
  landedNotified: boolean;
  bucketSoundPlayed: boolean;
  nextHitIdx: number;
  trail: { x: number; y: number }[];
}

interface AmbientParticle {
  baseX: number;
  period: number;
  phase: number;
  driftAmp: number;
  size: number;
  speedY: number;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function makeParticles(layout: PlinkoLayout): AmbientParticle[] {
  const particles: AmbientParticle[] = [];
  for (let i = 0; i < AMBIENT_PARTICLE_COUNT; i++) {
    particles.push({
      baseX: (layout.leftWallX + (layout.rightWallX - layout.leftWallX) * ((i * 0.6180339887) % 1)) | 0,
      period: 5000 + (i * 733) % 4000,
      phase: (i * 137) % 1000,
      driftAmp: 6 + (i % 4) * 3,
      size: 0.5 + (i % 3) * 0.35,
      speedY: 0.006 + (i % 5) * 0.003,
    });
  }
  return particles;
}

export function PlinkoBoard({ rows, multiplierTable, drops, onLanded, bigWinMultiplier = 5 }: PlinkoBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Two stacked canvases: `canvasRef` (below the multiplier-label DOM row)
  // draws the board environment, pegs, pocket dividers and motion trails;
  // `ballCanvasRef` (above the label row) draws only the balls. Balls need
  // their own, higher-stacked layer so they stay visible resting *inside* a
  // pocket once landed, right where the player most needs to see them.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ballCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const dropsMapRef = useRef<Map<string, DropState>>(new Map());
  const seenIdsRef = useRef<Set<string>>(new Set());
  const flashesRef = useRef<Map<string, PegFlash>>(new Map());
  const particlesRef = useRef<AmbientParticle[]>([]);
  const pegHitStreakRef = useRef(0);
  const lastPegHitTimeRef = useRef(0);
  const [litBuckets, setLitBuckets] = useState<{ id: string; bucket: number }[]>([]);
  const [boardVisible, setBoardVisible] = useState(false);
  const litTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = litTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const soundEnabled = useSoundStore((s) => s.enabled);
  const soundVolume = useSoundStore((s) => s.volume);
  const soundRef = useRef({ enabled: soundEnabled, volume: soundVolume });
  soundRef.current = { enabled: soundEnabled, volume: soundVolume };

  const layout = useMemo(() => computePlinkoLayout(rows), [rows]);
  const multiplierTableRef = useRef(multiplierTable);
  multiplierTableRef.current = multiplierTable;
  const bigWinMultiplierRef = useRef(bigWinMultiplier);
  bigWinMultiplierRef.current = bigWinMultiplier;

  useEffect(() => {
    particlesRef.current = makeParticles(layout);
  }, [layout]);

  // Keep both canvases' backing-store resolution matched to their actual
  // on-screen size (times devicePixelRatio) so drawing stays crisp — the
  // container's aspect ratio is CSS-locked to VIRTUAL_WIDTH / VIRTUAL_HEIGHT,
  // so the scale factor is uniform in x and y (no circle-distorting stretch).
  useEffect(() => {
    const canvas = canvasRef.current;
    const ballCanvas = ballCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !ballCanvas || !container) return;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ballCanvas.width = canvas.width;
      ballCanvas.height = canvas.height;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // The single persistent render loop. It runs for the component's whole
  // lifetime and just draws whatever's in `dropsMapRef` *right now* — an
  // idle board (pegs only) when nothing's in flight, or every active drop's
  // current recorded-trajectory frame otherwise. This is the only place
  // ball position ever comes from: real recorded physics state, read fresh
  // every frame, never a CSS animation.
  useEffect(() => {
    function draw(now: number) {
      rafRef.current = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const ballCanvas = ballCanvasRef.current;
      if (!canvas || !ballCanvas) return;
      const ctx = canvas.getContext("2d");
      const ballCtx = ballCanvas.getContext("2d");
      if (!ctx || !ballCtx || canvas.width === 0 || canvas.height === 0) return;

      const scaleX = canvas.width / VIRTUAL_WIDTH;
      const scaleY = canvas.height / VIRTUAL_HEIGHT;
      ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      ctx.clearRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
      ballCtx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      ballCtx.clearRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);

      const activeLayout = layout;
      const { enabled: sndOn, volume: sndVol } = soundRef.current;
      const vol = sndOn ? sndVol : 0;

      const liveDrops: { frame: TrajectoryFrame; speed: number; trail: { x: number; y: number }[] }[] = [];
      const toRemove: string[] = [];

      for (const drop of dropsMapRef.current.values()) {
        if (drop.startedAt === null) drop.startedAt = now;
        const virtualStep = (now - drop.startedAt) / FRAME_MS;
        const lastIdx = drop.frames.length - 1;
        const clampedStep = Math.min(virtualStep, lastIdx);
        const i0 = Math.floor(clampedStep);
        const i1 = Math.min(i0 + 1, lastIdx);
        const t = clampedStep - i0;
        const f0 = drop.frames[i0];
        const f1 = drop.frames[i1];
        const frame: TrajectoryFrame = {
          x: lerp(f0.x, f1.x, t),
          y: lerp(f0.y, f1.y, t),
          angle: lerp(f0.angle, f1.angle, t),
          speed: lerp(f0.speed, f1.speed, t),
        };
        liveDrops.push({ frame, speed: frame.speed, trail: drop.trail });

        // Fire peg-impact flashes/sound as playback crosses each recorded
        // collision's step.
        while (drop.nextHitIdx < drop.pegHits.length && drop.pegHits[drop.nextHitIdx].step <= clampedStep) {
          const hit = drop.pegHits[drop.nextHitIdx];
          flashesRef.current.set(`${hit.row}:${hit.index}`, { startedAt: now });
          if (now - lastPegHitTimeRef.current < PEG_HIT_STREAK_WINDOW_MS) {
            pegHitStreakRef.current++;
          } else {
            pegHitStreakRef.current = 0;
          }
          lastPegHitTimeRef.current = now;
          plinkoAudio.pegHit(vol, pegHitStreakRef.current);
          drop.nextHitIdx++;
        }

        // Motion trail while moving fast.
        if (frame.speed > TRAIL_SPEED_THRESHOLD) {
          drop.trail.unshift({ x: frame.x, y: frame.y });
          if (drop.trail.length > TRAIL_LENGTH) drop.trail.length = TRAIL_LENGTH;
        } else {
          drop.trail.length = 0;
        }

        // Reached the end of the recorded trajectory: the ball has
        // settled. Illuminate its pocket + play the bucket-impact sound,
        // then hold that beat before notifying the parent (result banner /
        // balance animation) so the player can actually see where it
        // landed first.
        if (virtualStep >= lastIdx) {
          if (drop.landedAt === null) {
            drop.landedAt = now;
          }
          if (!drop.bucketSoundPlayed) {
            drop.bucketSoundPlayed = true;
            plinkoAudio.bucketHit(vol);
            setLitBuckets((prev) => [...prev, { id: drop.id, bucket: drop.bucket }]);
            const timer = setTimeout(() => {
              litTimersRef.current.delete(drop.id);
              setLitBuckets((prev) => prev.filter((l) => l.id !== drop.id));
            }, LIT_VISUAL_MS);
            litTimersRef.current.set(drop.id, timer);
          }
          if (!drop.landedNotified && now - drop.landedAt >= LAND_PAUSE_MS) {
            drop.landedNotified = true;
            const value = multiplierTableRef.current[drop.bucket] ?? 0;
            if (value >= bigWinMultiplierRef.current) plinkoAudio.bigWin(vol);
            else if (value >= 1) plinkoAudio.win(vol);
            onLanded(drop.id);
          }
          if (now - drop.landedAt >= BALL_VISIBLE_AFTER_LAND_MS) {
            toRemove.push(drop.id);
          }
        }
      }

      for (const id of toRemove) {
        dropsMapRef.current.delete(id);
        const timer = litTimersRef.current.get(id);
        if (timer) {
          clearTimeout(timer);
          litTimersRef.current.delete(id);
        }
      }

      drawBackground(ctx, activeLayout, now, liveDrops, flashesRef.current, particlesRef.current);
      for (const { frame, speed } of liveDrops) drawBall(ballCtx, frame, activeLayout.ballRadius, speed);
    }

    setBoardVisible(true);
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // layout/onLanded are intentionally read fresh via refs/closures — this
    // loop is started once and lives for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, onLanded]);

  // Whenever new drop requests show up, kick off their headless simulation
  // right away (a few milliseconds each, synchronous) and hand the recorded
  // trajectory to the render loop above. Never re-processes an id it's
  // already seen, so the parent can just keep appending.
  useEffect(() => {
    for (const req of drops) {
      if (seenIdsRef.current.has(req.id)) continue;
      seenIdsRef.current.add(req.id);
      const sim = simulateUntilMatch(rows, req.bucket, layout);
      dropsMapRef.current.set(req.id, {
        id: req.id,
        layout,
        frames: sim.frames,
        pegHits: sim.pegHits,
        bucket: req.bucket,
        startedAt: null,
        landedAt: null,
        landedNotified: false,
        bucketSoundPlayed: false,
        nextHitIdx: 0,
        trail: [],
      });
      plinkoAudio.ensureStarted();
      plinkoAudio.ballRelease(soundRef.current.enabled ? soundRef.current.volume : 0);
    }
  }, [drops, rows, layout]);

  const bucketCount = rows + 1;
  const leftPct = (layout.leftWallX / VIRTUAL_WIDTH) * 100;
  const widthPct = ((layout.rightWallX - layout.leftWallX) / VIRTUAL_WIDTH) * 100;
  const labelsTopPct = (layout.bucketTop / VIRTUAL_HEIGHT) * 100;
  const labelsBottomPct = 100 - (layout.bucketBottom / VIRTUAL_HEIGHT) * 100;

  return (
    // Outer wrapper: a soft teal ambient glow sitting behind the whole
    // cabinet (product spec: "environmental lighting... teal ambient glow
    // behind Plinko"), so the machine reads as a lit object sitting in a
    // dark room rather than a card pasted on the page background.
    <div className="relative w-full lg:mx-auto lg:max-w-[480px]">
      <div
        className="pointer-events-none absolute -inset-3 -z-10 rounded-[28px] opacity-70 blur-2xl sm:-inset-6"
        style={{ background: "radial-gradient(60% 65% at 50% 38%, rgba(45,191,176,0.28), transparent 72%)" }}
        aria-hidden
      />
      {/* Metal bezel: a physical machine casing (brushed-steel gradient)
          wrapping the actual playfield, matching the metallic side rails
          drawn on the canvas just inside it. */}
      <div className="relative rounded-2xl bg-gradient-to-b from-[#4a545e] via-[#23292f] to-[#101316] p-[3px] shadow-card-lift">
        <div
          ref={containerRef}
          className="relative w-full overflow-hidden rounded-[14px] bg-[#0b0d10]"
          style={{ aspectRatio: `${VIRTUAL_WIDTH} / ${VIRTUAL_HEIGHT}` }}
        >
          <canvas
            ref={canvasRef}
            className={cn("absolute inset-0 z-0 h-full w-full transition-opacity duration-300", boardVisible ? "opacity-100" : "opacity-0")}
          />

          {/* Compact landing-pocket labels — short pills anchored at the very
              bottom of each pocket, not tall bars filling the board. The
              pockets themselves (dividers, floor, rim lighting) are drawn on
              the canvas below so their visuals stay pixel-locked to the real
              Matter.js divider bodies. */}
          <div
            className="pointer-events-none absolute z-10 flex items-end gap-[2px]"
            style={{ left: `${leftPct}%`, width: `${widthPct}%`, top: `${labelsTopPct}%`, bottom: `${labelsBottomPct}%` }}
          >
            {Array.from({ length: bucketCount }).map((_, i) => {
              const value = multiplierTable[i] ?? 0;
              const lit = litBuckets.some((l) => l.bucket === i);
              const tier = bucketTier(value);
              return (
                <div key={i} className="flex flex-1 items-end justify-center pb-[3%]">
                  <span
                    className={cn(
                      "rounded-full px-1 py-0.5 text-center text-[8px] font-extrabold leading-none transition-all duration-200 ease-snappy sm:px-1.5 sm:py-1 sm:text-[11px]",
                      lit ? "-translate-y-1 scale-125 bg-accent-sc text-bg shadow-glow-sc-lg" : bucketTierClasses[tier]
                    )}
                  >
                    {value.toFixed(1)}x
                  </span>
                </div>
              );
            })}
          </div>

          {/* Ball layer sits above the pocket labels so balls stay visible
              while resting settled inside a pocket, not just while airborne. */}
          <canvas
            ref={ballCanvasRef}
            className={cn("pointer-events-none absolute inset-0 z-20 h-full w-full transition-opacity duration-300", boardVisible ? "opacity-100" : "opacity-0")}
          />
        </div>
      </div>
    </div>
  );
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  layout: PlinkoLayout,
  now: number,
  liveDrops: { frame: TrajectoryFrame; speed: number; trail: { x: number; y: number }[] }[],
  flashes: Map<string, PegFlash>,
  particles: AmbientParticle[]
) {
  const { width, height } = layout;

  // Base: dark charcoal "casino machine" panel, not flat black — a soft
  // vertical gradient plus a faint radial vault-door texture and a teal
  // ambient wash behind the peg field, so the board reads as a physical lit
  // cabinet rather than dots floating on a webpage.
  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, "#1a1e24");
  base.addColorStop(0.45, "#121519");
  base.addColorStop(1, "#0a0c0f");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  // Faint concentric "vault door" rings, centered above the peg field.
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = "#8fb8c9";
  ctx.lineWidth = 1;
  const ringCx = layout.centerX;
  const ringCy = layout.pegTopY - height * 0.06;
  for (let r = 30; r < width * 1.1; r += 26) {
    ctx.beginPath();
    ctx.arc(ringCx, ringCy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // Faint brushed-metal texture behind the peg field — a set of thin
  // diagonal hairlines, barely-there, giving the dark backing plate a
  // physical machined-panel quality rather than a flat CSS gradient.
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.strokeStyle = "#cfe4e0";
  ctx.lineWidth = 1;
  const brushTop = layout.pegTopY - 14;
  const brushBottom = layout.floorY;
  for (let bx = -height; bx < width + height; bx += 7) {
    ctx.beginPath();
    ctx.moveTo(bx, brushTop);
    ctx.lineTo(bx + (brushBottom - brushTop), brushBottom);
    ctx.stroke();
  }
  ctx.restore();

  // Subtle recessed geometry: a soft inner-shadow rectangle around the peg
  // field, as if it sits in a machined recess of the cabinet rather than
  // floating flush with the panel.
  ctx.save();
  const recessInset = width * 0.03;
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 4;
  ctx.strokeRect(
    layout.leftWallX - recessInset,
    layout.pegTopY - 16,
    layout.rightWallX - layout.leftWallX + recessInset * 2,
    layout.floorY - layout.pegTopY + 16
  );
  ctx.restore();

  // Teal ambient glow washing the peg field.
  const tealGlow = ctx.createRadialGradient(
    layout.centerX,
    (layout.pegTopY + layout.pegBottomY) / 2,
    0,
    layout.centerX,
    (layout.pegTopY + layout.pegBottomY) / 2,
    width * 0.62
  );
  tealGlow.addColorStop(0, "rgba(80, 210, 195, 0.10)");
  tealGlow.addColorStop(1, "rgba(80, 210, 195, 0)");
  ctx.fillStyle = tealGlow;
  ctx.fillRect(0, 0, width, height);

  // Slow ambient dust motes.
  ctx.save();
  for (const p of particles) {
    const t = (now + p.phase) / p.period;
    const x = p.baseX + Math.sin(t * Math.PI * 2) * p.driftAmp;
    const y = height - ((now * p.speedY + p.phase) % (height + 20));
    const alpha = 0.10 + 0.06 * Math.sin(t * Math.PI * 2 + 1.4);
    ctx.beginPath();
    ctx.fillStyle = `rgba(150, 210, 205, ${Math.max(0.03, alpha).toFixed(3)})`;
    ctx.arc(x, y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Spotlight following each moving ball.
  for (const { frame, speed } of liveDrops) {
    if (speed <= 0.3) continue;
    const spot = ctx.createRadialGradient(frame.x, frame.y, 0, frame.x, frame.y, width * 0.4);
    spot.addColorStop(0, "rgba(240, 195, 90, 0.10)");
    spot.addColorStop(1, "rgba(240, 195, 90, 0)");
    ctx.save();
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  // Pocket shelf: a subtly lighter raised panel behind the landing pockets,
  // giving them real physical presence instead of just floating labels.
  const shelfTop = layout.bucketTop - (layout.floorY - layout.bucketTop) * 0.3;
  const shelf = ctx.createLinearGradient(0, shelfTop, 0, layout.bucketBottom);
  shelf.addColorStop(0, "rgba(255,255,255,0.05)");
  shelf.addColorStop(0.08, "rgba(255,255,255,0.02)");
  shelf.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = shelf;
  ctx.fillRect(layout.leftWallX, shelfTop, layout.rightWallX - layout.leftWallX, layout.floorY - shelfTop);
  // Bright rim line at the pocket mouth.
  ctx.save();
  ctx.strokeStyle = "rgba(120, 225, 210, 0.35)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(layout.leftWallX, shelfTop);
  ctx.lineTo(layout.rightWallX, shelfTop);
  ctx.stroke();
  ctx.restore();

  // Pocket dividers — short physical walls between adjacent buckets,
  // matching the real Matter.js divider bodies used in the simulation.
  const dividerThickness = Math.max(1.8, layout.spacingX * 0.07);
  for (const bx of layout.bucketBoundaries.slice(1, -1)) {
    const grad = ctx.createLinearGradient(bx - dividerThickness, 0, bx + dividerThickness, 0);
    grad.addColorStop(0, "rgba(70,80,90,0.9)");
    grad.addColorStop(0.5, "rgba(150,170,175,0.95)");
    grad.addColorStop(1, "rgba(50,58,66,0.9)");
    ctx.fillStyle = grad;
    ctx.fillRect(bx - dividerThickness / 2, shelfTop, dividerThickness, layout.floorY - shelfTop);
  }
  // Outer walls: real metallic physical rails (not a hairline) — a
  // brushed-steel vertical gradient with a bright teal-lit inner edge,
  // matching the metal bezel wrapped around the whole cabinet.
  const railW = Math.max(4, layout.spacingX * 0.14);
  const railTop = layout.pegTopY - 4;
  const railH = layout.floorY - layout.pegTopY + 4;
  drawRail(ctx, layout.leftWallX - railW, railW, railTop, railH, "left");
  drawRail(ctx, layout.rightWallX, railW, railTop, railH, "right");

  // Pegs — physical depth: dark metallic center, teal illuminated rim, a
  // tiny specular reflection. A struck peg flashes brighter/warmer and
  // scales up subtly (2-4%), then eases straight back.
  for (const peg of layout.pegs) {
    const flash = flashes.get(`${peg.row}:${peg.index}`);
    let intensity = 0;
    if (flash) {
      const age = now - flash.startedAt;
      if (age < PEG_FLASH_MS) intensity = 1 - age / PEG_FLASH_MS;
      else flashes.delete(`${peg.row}:${peg.index}`);
    }
    drawPeg(ctx, peg.x, peg.y, layout.pegRadius, intensity);
  }

  // Ball trails (motion-blur echoes) — drawn under the balls themselves,
  // which render on the separate ball canvas above.
  for (const { trail } of liveDrops) {
    if (trail.length < 2) continue;
    for (let i = trail.length - 1; i >= 1; i--) {
      const p = trail[i];
      const alpha = 0.22 * (1 - i / trail.length);
      ctx.beginPath();
      ctx.fillStyle = `rgba(235, 195, 90, ${alpha.toFixed(3)})`;
      ctx.arc(p.x, p.y, layout.ballRadius * 1.0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** A physical metallic side rail: brushed-steel gradient across its width
 * plus a bright, teal-lit edge on the side that faces the playfield. */
function drawRail(ctx: CanvasRenderingContext2D, x: number, w: number, y: number, h: number, side: "left" | "right") {
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, "rgba(30,35,40,0.95)");
  grad.addColorStop(0.4, "rgba(120,134,144,0.95)");
  grad.addColorStop(0.55, "rgba(180,196,204,0.98)");
  grad.addColorStop(1, "rgba(28,33,38,0.95)");
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  const edgeX = side === "left" ? x + w - 1.1 : x + 1.1;
  ctx.save();
  ctx.shadowColor = "rgba(100,225,208,0.65)";
  ctx.shadowBlur = 6;
  ctx.strokeStyle = "rgba(120,230,213,0.7)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(edgeX, y);
  ctx.lineTo(edgeX, y + h);
  ctx.stroke();
  ctx.restore();
}

function drawPeg(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, hitIntensity: number) {
  // Subtle scale bump on hit — kept small (spec: ~2-4%) so it reads as a
  // physical jolt, not a cartoon bounce.
  const r = radius * (1 + hitIntensity * 0.035);

  // A small dark contact shadow first, so the peg reads as a raised metal
  // bump standing proud of the dark panel behind it rather than a flat dot
  // that blends into an equally dark background.
  ctx.beginPath();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.ellipse(x, y + r * 0.32, r * 1.05, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.shadowColor = hitIntensity > 0 ? "rgba(255, 205, 100, 0.95)" : "rgba(110, 220, 208, 0.55)";
  ctx.shadowBlur = hitIntensity > 0 ? 10 + hitIntensity * 8 : 5;

  // Lit gunmetal center (bright enough to read clearly against the dark
  // board even before the teal rim kicks in) -> mid steel -> teal
  // illuminated rim.
  const grad = ctx.createRadialGradient(x - r * 0.32, y - r * 0.34, r * 0.04, x, y, r);
  if (hitIntensity > 0) {
    grad.addColorStop(0, "#fffaf0");
    grad.addColorStop(0.4, `rgba(255, ${Math.round(205 + hitIntensity * 35)}, 120, 1)`);
    grad.addColorStop(0.75, "rgba(224, 168, 56, 0.98)");
    grad.addColorStop(1, "rgba(140, 100, 34, 0.95)");
  } else {
    grad.addColorStop(0, "#7c8892");
    grad.addColorStop(0.32, "#525c66");
    grad.addColorStop(0.68, "#333b42");
    grad.addColorStop(1, "#1c2226");
  }
  ctx.beginPath();
  ctx.fillStyle = grad;
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // Teal illuminated rim stroke.
  ctx.beginPath();
  ctx.lineWidth = Math.max(0.6, r * 0.16);
  ctx.strokeStyle = hitIntensity > 0 ? "rgba(255, 220, 140, 0.95)" : "rgba(104, 224, 210, 0.8)";
  ctx.arc(x, y, r * 0.92, 0, Math.PI * 2);
  ctx.stroke();

  // Tiny specular reflection.
  ctx.beginPath();
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.arc(x - r * 0.32, y - r * 0.32, Math.max(0.6, r * 0.2), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBall(ctx: CanvasRenderingContext2D, frame: TrajectoryFrame, physicalRadius: number, speed: number) {
  const { x, y, angle } = frame;
  // Rendered noticeably larger than the physical collision body (product
  // spec: "approximately 1.5-2x more visually prominent") — the extra size
  // is purely a render-time scale-up plus bloom, so the ball's actual
  // physics footprint (spacing/gap math against pegs) doesn't have to grow
  // by the same amount.
  const radius = physicalRadius * 1.55;

  // Drop shadow for depth.
  ctx.save();
  ctx.beginPath();
  ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
  ctx.ellipse(x, y + radius * 0.55, radius * 0.9, radius * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Tiny motion-blur elongation at high speed — a plinko ball's fast motion
  // is overwhelmingly vertical (falling/bouncing), so a simple vertical
  // stretch with a slight horizontal squeeze (area-preserving-ish) reads as
  // "moving fast" without needing a full velocity-vector direction, which
  // TrajectoryFrame doesn't carry (only position/angle/speed magnitude).
  const speedFactor = Math.min(1, speed / 9);
  ctx.save();
  ctx.translate(x, y);
  if (speedFactor > 0.15) {
    ctx.scale(1 - speedFactor * 0.08, 1 + speedFactor * 0.2);
  }
  ctx.translate(-x, -y);

  ctx.shadowColor = "rgba(255, 214, 120, 0.85)";
  ctx.shadowBlur = 12 + Math.min(14, speed * 2.4);

  const grad = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.38, radius * 0.1, x, y, radius);
  grad.addColorStop(0, "#fffdf3");
  grad.addColorStop(0.32, "#f8e08a");
  grad.addColorStop(0.68, "#dcae35");
  grad.addColorStop(1, "#9c701a");
  ctx.beginPath();
  ctx.fillStyle = grad;
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Spin fleck — rotates with the ball's real physics angle, the only thing
  // that makes rotation actually visible rather than just simulated.
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.fillStyle = "rgba(110, 76, 10, 0.55)";
  ctx.arc(radius * 0.5, 0, radius * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Tight bright highlight, fixed relative to camera (a specular
  // reflection, not the ball's rotation) — the single brightest point on
  // the board, so the ball is instantly the thing the eye locks onto.
  ctx.beginPath();
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.arc(x - radius * 0.32, y - radius * 0.34, radius * 0.3, 0, Math.PI * 2);
  ctx.fill();
}
