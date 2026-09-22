"use client";

// The Plinko board — the centerpiece of the game. The backend resolves a
// round in one shot and hands back the exact deterministic path the ball
// took (`resultDetail.path`, one 'L'/'R' per row) plus the landing
// `bucket`, so there's no physics engine here: this walks that path to
// build (x,y) waypoints across a triangular peg grid (standard Galton
// board offset math — each 'L' shifts the ball half a peg-spacing left,
// each 'R' half a peg-spacing right) and animates through them with
// requestAnimationFrame, landing exactly in the real bucket.
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Point {
  x: number;
  y: number;
}

interface PlinkoBoardProps {
  rows: number;
  multiplierTable: number[];
  path: ("L" | "R")[] | null;
  bucket: number | null;
  /** Bump this whenever a new drop resolves to (re-)trigger the animation. */
  runId: number;
  onLanded: () => void;
}

const PEG_TOP_PCT = 7;
const PEG_BOTTOM_PCT = 76;
const BOARD_SPAN_PCT = 74;

function pegSpacingPct(rows: number) {
  return BOARD_SPAN_PCT / (rows + 2);
}

function buildWaypoints(rows: number, bucket: number, path: ("L" | "R")[]): Point[] {
  const spacing = pegSpacingPct(rows);
  const points: Point[] = [{ x: 50, y: 3 }];
  let offset = 0;
  for (let i = 0; i < rows; i++) {
    offset += path[i] === "R" ? 0.5 : -0.5;
    const y = PEG_TOP_PCT + ((i + 1) / rows) * (PEG_BOTTOM_PCT - PEG_TOP_PCT);
    points.push({ x: 50 + offset * spacing, y });
  }
  // Final drop into the actual bucket slot (snaps to the bucket's true
  // center so the ball visibly lands inside the illuminated bucket even
  // if float rounding nudged the offset math off by a hair).
  const bucketCount = rows + 1;
  const bucketCenterX = 3 + (94 / bucketCount) * (bucket + 0.5);
  points.push({ x: bucketCenterX, y: 90 });
  return points;
}

function animateSegment(
  from: Point,
  to: Point,
  duration: number,
  onFrame: (p: Point) => void,
  rafRef: React.MutableRefObject<number | null>
) {
  return new Promise<void>((resolve) => {
    const start = performance.now();
    function frame(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 2);
      onFrame({ x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased });
      if (t < 1) {
        rafRef.current = requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }
    rafRef.current = requestAnimationFrame(frame);
  });
}

export function PlinkoBoard({ rows, multiplierTable, path, bucket, runId, onLanded }: PlinkoBoardProps) {
  const [ballPos, setBallPos] = useState<Point>({ x: 50, y: 3 });
  const [squashY, setSquashY] = useState(1);
  const [visible, setVisible] = useState(false);
  const [litBucket, setLitBucket] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!path || bucket == null || runId === 0) return;
    const waypoints = buildWaypoints(rows, bucket, path);
    let cancelled = false;
    setLitBucket(null);
    setVisible(true);
    setBallPos(waypoints[0]);
    setSquashY(1);

    const SEGMENT_MS = 260;

    async function run() {
      for (let i = 1; i < waypoints.length; i++) {
        if (cancelled) return;
        await animateSegment(waypoints[i - 1], waypoints[i], SEGMENT_MS, setBallPos, rafRef);
        if (cancelled) return;
        setSquashY(0.6);
        setTimeout(() => !cancelled && setSquashY(1), 110);
      }
      if (cancelled) return;
      setLitBucket(bucket);
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
    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-casino-ambient sm:aspect-[6/5] lg:aspect-square">
      {pegRows.map((rowIdx) => {
        const pegCount = rowIdx + 2;
        const y = PEG_TOP_PCT + ((rowIdx + 1) / rows) * (PEG_BOTTOM_PCT - PEG_TOP_PCT);
        const spanPct = spacing * (pegCount - 1);
        return (
          <div
            key={rowIdx}
            className="absolute"
            style={{ top: `${y}%`, left: `${50 - spanPct / 2}%`, width: `${spanPct}%` }}
          >
            {Array.from({ length: pegCount }).map((_, p) => (
              <span
                key={p}
                className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border"
                style={{
                  left: pegCount > 1 ? `${(p / (pegCount - 1)) * 100}%` : "50%",
                  top: 0,
                  boxShadow: "0 0 5px rgb(var(--color-border) / 0.9)",
                }}
              />
            ))}
          </div>
        );
      })}

      {visible && (
        <div
          className="absolute z-20 h-3.5 w-3.5 rounded-full bg-accent-gc shadow-glow-gc sm:h-4 sm:w-4"
          style={{
            left: `${ballPos.x}%`,
            top: `${ballPos.y}%`,
            transform: `translate(-50%, -50%) scale(${2 - squashY}, ${squashY})`,
          }}
        />
      )}

      <div className="absolute inset-x-0 bottom-0 flex gap-[2px] px-[3%]" style={{ height: "17%" }}>
        {Array.from({ length: bucketCount }).map((_, i) => {
          const value = multiplierTable[i] ?? 0;
          const lit = litBucket === i;
          const distanceFromCenter = Math.abs(i - (bucketCount - 1) / 2) / ((bucketCount - 1) / 2 || 1);
          return (
            <div
              key={i}
              className={cn(
                "flex flex-1 items-end justify-center rounded-t-md pb-1 text-center text-[8px] font-bold transition-all duration-200 ease-snappy sm:pb-1.5 sm:text-[11px]",
                lit
                  ? "-translate-y-1.5 scale-110 bg-accent-sc text-bg shadow-glow-sc"
                  : cn("bg-surface-raised", distanceFromCenter > 0.55 ? "text-accent-gc" : "text-text-muted")
              )}
            >
              {value.toFixed(1)}x
            </div>
          );
        })}
      </div>
    </div>
  );
}
