"use client";

// The Plinko board — a real Matter.js physics simulation, not a scripted
// animation. The backend has already decided the round's outcome before
// any of this runs (`resultDetail.path` / `resultDetail.bucket`); this
// component's job is to render a physically honest visualization of a
// drop that actually lands there.
//
// How the honesty guarantee works (see plinkoPhysics.ts for the full
// simulation): the moment a new result comes in, we run the headless
// Matter.js simulation repeatedly (real gravity, real peg collisions, real
// restitution — just stepped far faster than real time, with no
// rendering) with small randomized jitter until one full run's ball
// actually, physically settles in the correct bucket. We record that run's
// exact trajectory (ball x/y/angle every physics step) and play back
// *that* recording in real time here, driven entirely by
// requestAnimationFrame reading the recorded physics state each frame —
// never CSS keyframes, never a hand-authored path. Every drop replays a
// genuinely different physical run (different jitter, different bounces),
// so no two drops look the same, but the bucket the ball lands in always
// matches the server's result, with zero exceptions.
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  computePlinkoLayout,
  simulateUntilMatch,
  VIRTUAL_WIDTH,
  VIRTUAL_HEIGHT,
  BUCKET_TOP_FRAC,
  type PlinkoLayout,
  type TrajectoryFrame,
  type PegHitEvent,
} from "./plinkoPhysics";

interface PlinkoBoardProps {
  rows: number;
  multiplierTable: number[];
  path: ("L" | "R")[] | null;
  bucket: number | null;
  /** Bump this whenever a new drop resolves to (re-)trigger the animation. */
  runId: number;
  onLanded: () => void;
  /**
   * Sound/haptic-effect hook points — scaffolding for a future audio pass.
   * There's no audio system in this codebase yet, so these are optional
   * and default to uncalled no-ops; callers can leave them unset entirely.
   */
  onPegImpact?: () => void;
  onLandImpact?: () => void;
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
  cold: "bg-surface-raised/60 text-text-muted border border-border/30",
  neutral: "bg-surface-raised text-text-primary border border-border/60",
  warm: "bg-accent-gc/10 text-accent-gc border border-accent-gc/40",
  hot: "bg-accent-gc/15 text-accent-gc border border-accent-gc/60 text-glow-gold animate-jackpot-pulse",
};

const bucketTierShadow: Record<BucketTier, string | undefined> = {
  cold: undefined,
  neutral: undefined,
  warm: "0 0 14px -3px rgb(var(--color-accent-gc) / 0.45)",
  hot: "0 0 22px -2px rgb(var(--color-accent-gc) / 0.65)",
};

const FRAME_MS = 1000 / 60;
const PEG_FLASH_MS = 260;
const TRAIL_LENGTH = 5;
const TRAIL_SPEED_THRESHOLD = 1.4;
// How long the ball visibly sits settled in the bucket before the result
// banner / balance animation takes over (product spec: ~300-500ms).
const LAND_PAUSE_MS = 420;

interface PegFlash {
  startedAt: number;
}

interface DropState {
  layout: PlinkoLayout;
  frames: TrajectoryFrame[];
  pegHits: PegHitEvent[];
  bucket: number;
  startedAt: number | null;
  landedAt: number | null;
  landedNotified: boolean;
  nextHitIdx: number;
  flashes: Map<string, PegFlash>;
  trail: { x: number; y: number }[];
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function PlinkoBoard({
  rows,
  multiplierTable,
  path,
  bucket,
  runId,
  onLanded,
  onPegImpact,
  onLandImpact,
}: PlinkoBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Two stacked canvases: `canvasRef` (below the bucket DOM row) draws
  // pegs, the motion trail and the ambient spotlight; `ballCanvasRef`
  // (above the bucket row) draws only the ball. The ball needs its own,
  // higher-stacked layer so it's still visible resting *inside* a bucket
  // once it lands — the buckets are opaque DOM elements, so a ball drawn
  // underneath them would be invisible right when the player most needs to
  // see it settle.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ballCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const dropRef = useRef<DropState | null>(null);
  const [litBucket, setLitBucket] = useState<number | null>(null);
  const [boardVisible, setBoardVisible] = useState(false);

  const layout = useMemo(() => computePlinkoLayout(rows), [rows]);

  // Keep both canvases' backing-store resolution matched to their actual
  // on-screen size (times devicePixelRatio) so drawing stays crisp — the
  // container's aspect ratio is CSS-locked to the same VIRTUAL_WIDTH /
  // VIRTUAL_HEIGHT ratio the physics simulation uses, so the scale factor
  // is uniform in x and y (no circle-distorting stretch).
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
  // lifetime and just draws whatever `dropRef.current` says the physics
  // state is *right now* — an idle board (pegs only) when there's no drop
  // in flight, or the current frame of the recorded trajectory otherwise.
  // This is the only place ball position ever comes from: real recorded
  // physics state, read fresh every frame, never a CSS animation.
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

      const drop = dropRef.current;
      const activeLayout = drop?.layout ?? layout;

      let ballFrame: TrajectoryFrame | null = null;
      let ballSpeed = 0;

      if (drop) {
        if (drop.startedAt === null) drop.startedAt = now;
        const virtualStep = (now - drop.startedAt) / FRAME_MS;
        const lastIdx = drop.frames.length - 1;
        const clampedStep = Math.min(virtualStep, lastIdx);
        const i0 = Math.floor(clampedStep);
        const i1 = Math.min(i0 + 1, lastIdx);
        const t = clampedStep - i0;
        const f0 = drop.frames[i0];
        const f1 = drop.frames[i1];
        ballFrame = { x: lerp(f0.x, f1.x, t), y: lerp(f0.y, f1.y, t), angle: lerp(f0.angle, f1.angle, t), speed: lerp(f0.speed, f1.speed, t) };
        ballSpeed = ballFrame.speed;

        // Fire peg-impact flashes as the playback crosses each recorded
        // collision's step.
        while (drop.nextHitIdx < drop.pegHits.length && drop.pegHits[drop.nextHitIdx].step <= clampedStep) {
          const hit = drop.pegHits[drop.nextHitIdx];
          drop.flashes.set(`${hit.row}:${hit.index}`, { startedAt: now });
          onPegImpact?.();
          drop.nextHitIdx++;
        }

        // Motion trail while moving fast.
        if (ballSpeed > TRAIL_SPEED_THRESHOLD) {
          drop.trail.unshift({ x: ballFrame.x, y: ballFrame.y });
          if (drop.trail.length > TRAIL_LENGTH) drop.trail.length = TRAIL_LENGTH;
        } else {
          drop.trail.length = 0;
        }

        // Reached the end of the recorded trajectory: the ball has
        // settled. Light the bucket, then hold the visible "ball resting
        // in the bucket" beat before notifying the parent so the result
        // banner / balance animation appears after the player can actually
        // see where it landed.
        if (virtualStep >= lastIdx) {
          if (drop.landedAt === null) {
            drop.landedAt = now;
            setLitBucket(drop.bucket);
            onLandImpact?.();
          } else if (!drop.landedNotified && now - drop.landedAt >= LAND_PAUSE_MS) {
            drop.landedNotified = true;
            onLanded();
          }
        }
      }

      drawBackground(ctx, activeLayout, drop, ballFrame, ballSpeed, now);
      if (ballFrame) drawBall(ballCtx, ballFrame, activeLayout.ballRadius, ballSpeed);
    }

    setBoardVisible(true);
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // layout is intentionally read fresh via dropRef/closure each frame —
    // this loop is started once and lives for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kick off a new drop: run the fast headless simulation right away (a
  // few milliseconds, synchronous) and hand its recorded trajectory to the
  // render loop above.
  useEffect(() => {
    if (!path || bucket == null || runId === 0) return;
    setLitBucket(null);
    const sim = simulateUntilMatch(rows, bucket, layout);
    dropRef.current = {
      layout,
      frames: sim.frames,
      pegHits: sim.pegHits,
      bucket,
      startedAt: null,
      landedAt: null,
      landedNotified: false,
      nextHitIdx: 0,
      flashes: new Map(),
      trail: [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const bucketCount = rows + 1;
  const leftPct = (layout.leftWallX / VIRTUAL_WIDTH) * 100;
  const widthPct = ((layout.rightWallX - layout.leftWallX) / VIRTUAL_WIDTH) * 100;

  return (
    <div
      ref={containerRef}
      className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-casino-ambient bg-casino-vignette shadow-card-lift lg:mx-auto lg:max-w-[480px]"
    >
      <canvas
        ref={canvasRef}
        className={cn("absolute inset-0 z-0 h-full w-full transition-opacity duration-300", boardVisible ? "opacity-100" : "opacity-0")}
      />

      <div
        className="pointer-events-none absolute z-10 flex gap-[3px]"
        style={{ left: `${leftPct}%`, width: `${widthPct}%`, top: `${BUCKET_TOP_FRAC * 100}%`, bottom: "2%" }}
      >
        {Array.from({ length: bucketCount }).map((_, i) => {
          const value = multiplierTable[i] ?? 0;
          const lit = litBucket === i;
          const tier = bucketTier(value);
          return (
            <div
              key={i}
              className={cn(
                "flex flex-1 items-end justify-center rounded-t-md pb-1.5 text-center text-[9px] font-extrabold transition-all duration-200 ease-snappy sm:pb-2 sm:text-[13px]",
                lit ? "-translate-y-2 scale-110 bg-accent-sc text-bg shadow-glow-sc-lg" : bucketTierClasses[tier]
              )}
              style={!lit ? { boxShadow: bucketTierShadow[tier] } : undefined}
            >
              {value.toFixed(1)}x
            </div>
          );
        })}
      </div>

      {/* Ball layer sits above the (opaque) bucket row so the ball stays
          visible while it's resting settled inside a bucket, not just
          while it's still up in the peg field. */}
      <canvas
        ref={ballCanvasRef}
        className={cn("pointer-events-none absolute inset-0 z-20 h-full w-full transition-opacity duration-300", boardVisible ? "opacity-100" : "opacity-0")}
      />
    </div>
  );
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  layout: PlinkoLayout,
  drop: DropState | null,
  ball: TrajectoryFrame | null,
  ballSpeed: number,
  now: number
) {
  // Soft spotlight following the ball while it's in motion.
  if (ball && ballSpeed > 0.3) {
    const spot = ctx.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, layout.width * 0.4);
    spot.addColorStop(0, "rgba(230, 190, 80, 0.09)");
    spot.addColorStop(1, "rgba(230, 190, 80, 0)");
    ctx.save();
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, layout.width, layout.height);
    ctx.restore();
  }

  // Pegs.
  for (const peg of layout.pegs) {
    const flash = drop?.flashes.get(`${peg.row}:${peg.index}`);
    let intensity = 0;
    if (flash) {
      const age = now - flash.startedAt;
      if (age < PEG_FLASH_MS) intensity = 1 - age / PEG_FLASH_MS;
      else drop!.flashes.delete(`${peg.row}:${peg.index}`);
    }
    drawPeg(ctx, peg.x, peg.y, layout.pegRadius, intensity);
  }

  // Ball trail (motion blur echoes).
  if (drop && drop.trail.length > 1) {
    for (let i = drop.trail.length - 1; i >= 1; i--) {
      const p = drop.trail[i];
      const alpha = 0.22 * (1 - i / drop.trail.length);
      ctx.beginPath();
      ctx.fillStyle = `rgba(230, 190, 80, ${alpha.toFixed(3)})`;
      ctx.arc(p.x, p.y, layout.ballRadius * 0.85, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPeg(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, hitIntensity: number) {
  // Soft ambient glow.
  ctx.save();
  ctx.shadowColor = hitIntensity > 0 ? "rgba(255, 200, 90, 0.9)" : "rgba(120, 220, 210, 0.55)";
  ctx.shadowBlur = hitIntensity > 0 ? 10 + hitIntensity * 6 : 4;

  const r = radius * (1 + hitIntensity * 0.45);
  const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, 0, x, y, r);
  if (hitIntensity > 0) {
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.55, `rgba(255, ${Math.round(190 + hitIntensity * 40)}, 90, 1)`);
    grad.addColorStop(1, "rgba(214, 158, 46, 0.95)");
  } else {
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.55, "rgba(94, 210, 196, 0.95)");
    grad.addColorStop(1, "rgba(45, 150, 140, 0.85)");
  }
  ctx.beginPath();
  ctx.fillStyle = grad;
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBall(ctx: CanvasRenderingContext2D, frame: TrajectoryFrame, radius: number, speed: number) {
  const { x, y, angle } = frame;

  // Drop shadow for depth.
  ctx.save();
  ctx.beginPath();
  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  ctx.ellipse(x, y + radius * 0.55, radius * 0.9, radius * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "rgba(255, 210, 110, 0.75)";
  ctx.shadowBlur = 10 + Math.min(10, speed * 2.2);

  const grad = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.38, radius * 0.1, x, y, radius);
  grad.addColorStop(0, "#fff9e8");
  grad.addColorStop(0.35, "#f4d675");
  grad.addColorStop(0.7, "#d4a92e");
  grad.addColorStop(1, "#a97c1a");
  ctx.beginPath();
  ctx.fillStyle = grad;
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Spin indicator: a small darker fleck offset from center, rotating with
  // the ball's real physics angle — this is what makes rotation actually
  // visible rather than just simulated invisibly.
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.fillStyle = "rgba(120, 84, 12, 0.55)";
  ctx.arc(radius * 0.5, 0, radius * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Tight bright highlight (fixed relative to camera, not rotation — like
  // a specular reflection).
  ctx.beginPath();
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.arc(x - radius * 0.32, y - radius * 0.34, radius * 0.28, 0, Math.PI * 2);
  ctx.fill();
}
