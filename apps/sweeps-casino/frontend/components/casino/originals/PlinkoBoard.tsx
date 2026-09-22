"use client";

// The Plinko board — the centerpiece of the game. The backend resolves a
// round in one shot and hands back the exact deterministic path the ball
// took (`resultDetail.path`, one 'L'/'R' per row) plus the landing
// `bucket`, so there's no physics engine here: this walks that path to
// build (x,y) waypoints across a triangular peg grid (standard Galton
// board offset math — each 'L' shifts the ball half a peg-spacing left,
// each 'R' half a peg-spacing right) and animates through them with
// requestAnimationFrame, landing exactly in the real bucket.
//
// Visual polish pass: pegs and the ball glow much brighter, buckets are
// tiered by multiplier value, the ball hops between pegs with a small
// bounce arc instead of a straight tween, and each row the ball crosses
// fires a brief impact flash on the peg nearest the ball's x — all of
// this is purely cosmetic and layered on top of the same waypoint math,
// so the bucket the ball lands in still always matches `bucket` exactly.
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Point {
  x: number;
  y: number;
}

interface PegImpact {
  id: number;
  row: number;
  peg: number;
  x: number;
  y: number;
  fading: boolean;
}

interface PlinkoBoardProps {
  rows: number;
  multiplierTable: number[];
  path: ("L" | "R")[] | null;
  bucket: number | null;
  /** Bump this whenever a new drop resolves to (re-)trigger the animation. */
  runId: number;
  onLanded: () => void;
  /**
   * Sound-effect hook points — scaffolding for a future audio pass. There's
   * no audio system in this codebase yet, so these are optional and default
   * to uncalled no-ops; callers can leave them unset entirely.
   */
  onPegImpact?: () => void;
  onLandImpact?: () => void;
}

const PEG_TOP_PCT = 7;
const PEG_BOTTOM_PCT = 76;
const BOARD_SPAN_PCT = 74;

function pegSpacingPct(rows: number) {
  return BOARD_SPAN_PCT / (rows + 2);
}

function rowY(rowIdx: number, rows: number) {
  return PEG_TOP_PCT + ((rowIdx + 1) / rows) * (PEG_BOTTOM_PCT - PEG_TOP_PCT);
}

function buildWaypoints(rows: number, bucket: number, path: ("L" | "R")[]): Point[] {
  const spacing = pegSpacingPct(rows);
  const points: Point[] = [{ x: 50, y: 3 }];
  let offset = 0;
  for (let i = 0; i < rows; i++) {
    offset += path[i] === "R" ? 0.5 : -0.5;
    points.push({ x: 50 + offset * spacing, y: rowY(i, rows) });
  }
  // Final drop into the actual bucket slot (snaps to the bucket's true
  // center so the ball visibly lands inside the illuminated bucket even
  // if float rounding nudged the offset math off by a hair).
  const bucketCount = rows + 1;
  const bucketCenterX = 3 + (94 / bucketCount) * (bucket + 0.5);
  points.push({ x: bucketCenterX, y: 90 });
  return points;
}

/** Which peg (row + index within that row) the ball's x nearest reflects — used only to place the impact flash, never to alter the real path. */
function pegHitForRow(rowIdx: number, rows: number, ballX: number) {
  const pegCount = rowIdx + 2;
  const spacing = pegSpacingPct(rows);
  const y = rowY(rowIdx, rows);
  if (pegCount <= 1) return { peg: 0, x: 50, y };
  const spanPct = spacing * (pegCount - 1);
  const left = 50 - spanPct / 2;
  const raw = Math.round((ballX - left) / spacing);
  const peg = Math.max(0, Math.min(pegCount - 1, raw));
  return { peg, x: left + peg * spacing, y };
}

// Row-to-row segment length shortens across the board — later rows fall
// faster than earlier ones, like gravity accelerating the drop — while
// keeping total animation time reasonable regardless of row count.
function segmentDurationMs(rowIndex: number, totalRows: number) {
  if (totalRows <= 1) return 240;
  const t = rowIndex / (totalRows - 1);
  return Math.round(300 - t * 150);
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number) => t * t * t;

/**
 * Tweens from -> to over `duration` ms, adding a small upward hop
 * (`arcHeight`, in % units) at the midpoint so each peg-to-peg step reads
 * as a physical bounce rather than a straight-line glide. The hop is
 * purely vertical and only ever runs between two real, already-known
 * waypoints, so it never implies the ball is heading anywhere but its
 * true next stop.
 */
function animateArc(
  from: Point,
  to: Point,
  duration: number,
  arcHeight: number,
  easing: (t: number) => number,
  onFrame: (p: Point) => void,
  rafRef: React.MutableRefObject<number | null>
) {
  return new Promise<void>((resolve) => {
    const start = performance.now();
    function frame(now: number) {
      const raw = Math.min(1, (now - start) / duration);
      const eased = easing(raw);
      const hop = arcHeight > 0 ? Math.sin(Math.PI * raw) * arcHeight : 0;
      onFrame({
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased - hop,
      });
      if (raw < 1) {
        rafRef.current = requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }
    rafRef.current = requestAnimationFrame(frame);
  });
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
  const [ballPos, setBallPos] = useState<Point>({ x: 50, y: 3 });
  const [squashY, setSquashY] = useState(1);
  const [visible, setVisible] = useState(false);
  const [moving, setMoving] = useState(false);
  const [litBucket, setLitBucket] = useState<number | null>(null);
  const [trail, setTrail] = useState<Point[]>([]);
  const [impacts, setImpacts] = useState<PegImpact[]>([]);
  const rafRef = useRef<number | null>(null);
  const posRef = useRef<Point>({ x: 50, y: 3 });
  const impactIdRef = useRef(0);

  useEffect(() => {
    if (!path || bucket == null || runId === 0) return;
    const waypoints = buildWaypoints(rows, bucket, path);
    let cancelled = false;
    setLitBucket(null);
    setVisible(true);
    setMoving(true);
    setBallPos(waypoints[0]);
    posRef.current = waypoints[0];
    setTrail([]);
    setImpacts([]);
    setSquashY(1);

    const spacing = pegSpacingPct(rows);
    const arcHeight = Math.min(2.4, spacing * 0.55);

    async function run() {
      for (let i = 1; i < waypoints.length; i++) {
        if (cancelled) return;
        const isFinalDrop = i === waypoints.length - 1;
        const rowIdx = i - 1;
        const duration = isFinalDrop ? 230 : segmentDurationMs(rowIdx, rows);

        await animateArc(
          waypoints[i - 1],
          waypoints[i],
          duration,
          isFinalDrop ? 0 : arcHeight,
          isFinalDrop ? easeInCubic : easeOutCubic,
          (p) => {
            setTrail((prev) => [posRef.current, ...prev].slice(0, 3));
            posRef.current = p;
            setBallPos(p);
          },
          rafRef
        );
        if (cancelled) return;

        setSquashY(0.6);
        setTimeout(() => !cancelled && setSquashY(1), 110);

        if (!isFinalDrop) {
          const hit = pegHitForRow(rowIdx, rows, waypoints[i].x);
          const id = impactIdRef.current++;
          setImpacts((prev) => [...prev, { id, row: rowIdx, peg: hit.peg, x: hit.x, y: hit.y, fading: false }]);
          setTimeout(() => !cancelled && setImpacts((prev) => prev.map((im) => (im.id === id ? { ...im, fading: true } : im))), 90);
          setTimeout(() => !cancelled && setImpacts((prev) => prev.filter((im) => im.id !== id)), 420);
          // Sound hook: a peg-impact tick. No audio system exists yet, so
          // this is a no-op unless a caller supplies onPegImpact.
          onPegImpact?.();
        }
      }
      if (cancelled) return;
      setMoving(false);
      setTrail([]);
      setLitBucket(bucket);
      // Sound hook: the landing thud/chime. No-op unless supplied.
      onLandImpact?.();
      onLanded();
    }
    run();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const bucketCount = rows + 1;
  const pegRows = Array.from({ length: rows }, (_, i) => i);
  const spacing = pegSpacingPct(rows);

  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-casino-ambient bg-casino-vignette shadow-card-lift sm:aspect-square lg:aspect-[6/5]">
      {/* Soft spotlight that tracks the ball while it's in motion — extra
          depth layered on top of the board's static corner vignette. */}
      {visible && (
        <div
          className="pointer-events-none absolute inset-0 z-0 transition-opacity duration-300"
          style={{
            opacity: moving ? 1 : 0.35,
            background: `radial-gradient(38% 30% at ${ballPos.x}% ${ballPos.y}%, rgb(var(--color-accent-gc) / 0.10), transparent 70%)`,
          }}
        />
      )}

      {pegRows.map((rowIdx) => {
        const pegCount = rowIdx + 2;
        const y = rowY(rowIdx, rows);
        const spanPct = spacing * (pegCount - 1);
        return (
          <div
            key={rowIdx}
            className="absolute z-[1]"
            style={{ top: `${y}%`, left: `${50 - spanPct / 2}%`, width: `${spanPct}%` }}
          >
            {Array.from({ length: pegCount }).map((_, p) => {
              const hit = impacts.some((im) => !im.fading && im.row === rowIdx && im.peg === p);
              return (
                <span
                  key={p}
                  className={cn(
                    "absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform duration-150 ease-snappy sm:h-2.5 sm:w-2.5",
                    hit ? "scale-150" : "scale-100"
                  )}
                  style={{
                    left: pegCount > 1 ? `${(p / (pegCount - 1)) * 100}%` : "50%",
                    top: 0,
                    background: hit
                      ? "radial-gradient(circle at 35% 30%, #fff, rgb(var(--color-accent-gc)) 60%)"
                      : "radial-gradient(circle at 35% 30%, #fff 0%, rgb(var(--color-accent-sc) / 0.95) 55%, rgb(var(--color-accent-sc) / 0.7) 100%)",
                    boxShadow: hit
                      ? "0 0 14px 3px rgb(var(--color-accent-gc) / 0.9), 0 0 3px 1px rgb(255 255 255 / 0.9)"
                      : "0 0 7px 1px rgb(var(--color-accent-sc) / 0.55), 0 0 2px 0 rgb(255 255 255 / 0.7)",
                  }}
                />
              );
            })}
          </div>
        );
      })}

      {/* Impact flashes: a brief gold burst on the peg the ball just hit,
          layered above the peg's own scale-pulse (set via `hit` above). */}
      {impacts.map((im) => (
        <div
          key={im.id}
          className="pointer-events-none absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 sm:h-5 sm:w-5"
          style={{ left: `${im.x}%`, top: `${im.y}%` }}
        >
          <span
            className={cn(
              "block h-full w-full rounded-full transition-all duration-300 ease-snappy",
              im.fading ? "scale-[2.4] opacity-0" : "scale-100 opacity-100"
            )}
            style={{
              background:
                "radial-gradient(circle, rgb(var(--color-accent-gc) / 0.9), rgb(var(--color-accent-gc) / 0.25) 55%, transparent 75%)",
            }}
          />
        </div>
      ))}

      {/* Motion trail: a couple of fading echoes behind the ball, so fast
          drops read as movement rather than a snapping dot. */}
      {moving &&
        trail.map((p, idx) => (
          <div
            key={idx}
            className="pointer-events-none absolute z-[15] h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full sm:h-3.5 sm:w-3.5"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              opacity: 0.32 - idx * 0.1,
              background: "radial-gradient(circle, rgb(var(--color-accent-gc) / 0.9), transparent 70%)",
            }}
          />
        ))}

      {visible && (
        <div
          className="absolute z-30 h-4 w-4 rounded-full sm:h-5 sm:w-5"
          style={{
            left: `${ballPos.x}%`,
            top: `${ballPos.y}%`,
            transform: `translate(-50%, -50%) scale(${2 - squashY}, ${squashY})`,
            background: "radial-gradient(circle at 35% 28%, #fff 0%, rgb(var(--color-accent-gc)) 55%, rgb(var(--color-accent-gc)) 100%)",
            boxShadow: moving
              ? "0 0 6px 2px rgb(255 255 255 / 0.95), 0 0 22px 6px rgb(var(--color-accent-gc) / 0.6), 0 0 48px 16px rgb(var(--color-accent-gc) / 0.3)"
              : "0 0 6px 2px rgb(255 255 255 / 0.9), 0 0 18px 4px rgb(var(--color-accent-gc) / 0.45)",
          }}
        />
      )}

      <div className="absolute inset-x-0 bottom-0 z-10 flex gap-[3px] px-[3%]" style={{ height: "19%" }}>
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
    </div>
  );
}
