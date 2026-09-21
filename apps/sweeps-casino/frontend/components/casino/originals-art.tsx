// Original, hand-authored CSS + inline-SVG artwork for the three real
// Originals (dice/mines/plinko) — no external images, no third-party or
// copied casino art, no new npm deps. Each game gets a distinct gradient
// + thematic motif so the lobby doesn't rely on the generic hash-based
// tileGradient() (lib/tile-art.ts) for its flagship games. Non-Original
// games keep using that generator as a graceful fallback — see
// hasCustomArt() below and its use in GameTile.tsx.

const ORIGINAL_SLUGS = ["dice", "mines", "plinko"] as const;
export type OriginalSlug = (typeof ORIGINAL_SLUGS)[number];

export function hasCustomArt(slug: string): slug is OriginalSlug {
  return (ORIGINAL_SLUGS as readonly string[]).includes(slug);
}

// Shared viewBox for all three: 120x160 matches the tile's aspect-[3/4].
const VB_W = 120;
const VB_H = 160;

// ---- Dice ------------------------------------------------------------

const FIVE_PIPS: [number, number][] = [
  [0.3, 0.3],
  [1.7, 0.3],
  [1, 1],
  [0.3, 1.7],
  [1.7, 1.7],
];
const THREE_PIPS: [number, number][] = [
  [0.35, 0.35],
  [1, 1],
  [1.65, 1.65],
];

function DiePips({ cx, cy, r, pips }: { cx: number; cy: number; r: number; pips: [number, number][] }) {
  return (
    <g>
      <rect
        x={cx - r}
        y={cy - r}
        width={r * 2}
        height={r * 2}
        rx={r * 0.22}
        fill="rgba(255,255,255,0.14)"
        stroke="rgba(255,255,255,0.4)"
        strokeWidth={1}
      />
      {pips.map(([px, py], i) => (
        <circle key={i} cx={cx - r + px * r} cy={cy - r + py * r} r={r * 0.11} fill="rgba(255,255,255,0.6)" />
      ))}
    </g>
  );
}

export function DiceArt() {
  return (
    <div
      className="absolute inset-0"
      style={{ background: "linear-gradient(155deg, #241a42 0%, #6b5bd6 55%, #e8a842 135%)" }}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <g transform="rotate(-14 32 56)" opacity="0.85">
          <DiePips cx={32} cy={56} r={28} pips={FIVE_PIPS} />
        </g>
        <g transform="rotate(20 86 112)" opacity="0.75">
          <DiePips cx={86} cy={112} r={20} pips={THREE_PIPS} />
        </g>
      </svg>
    </div>
  );
}

// ---- Mines -------------------------------------------------------------

const MINE_COLS = 4;
const MINE_ROWS = 5;
const MINE_CELL = { r: 1, c: 2 };

export function MinesArt() {
  const cellW = VB_W / MINE_COLS;
  const cellH = VB_H / MINE_ROWS;
  const cells: { r: number; c: number }[] = [];
  for (let r = 0; r < MINE_ROWS; r++) {
    for (let c = 0; c < MINE_COLS; c++) cells.push({ r, c });
  }
  const mineX = MINE_CELL.c * cellW + cellW / 2;
  const mineY = MINE_CELL.r * cellH + cellH / 2;

  return (
    <div
      className="absolute inset-0"
      style={{ background: "linear-gradient(155deg, #12201b 0%, #1c2430 55%, #2dbf85 150%)" }}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        {cells.map(({ r, c }) => {
          const isMine = r === MINE_CELL.r && c === MINE_CELL.c;
          return (
            <rect
              key={`${r}-${c}`}
              x={c * cellW + 3}
              y={r * cellH + 3}
              width={cellW - 6}
              height={cellH - 6}
              rx={4}
              fill={isMine ? "rgba(214,85,107,0.3)" : "rgba(255,255,255,0.06)"}
              stroke={isMine ? "rgba(214,85,107,0.55)" : "rgba(255,255,255,0.14)"}
              strokeWidth={1}
            />
          );
        })}
        <g transform={`translate(${mineX} ${mineY})`}>
          {Array.from({ length: 8 }).map((_, i) => {
            const angle = (i * 360) / 8;
            const rad = (angle * Math.PI) / 180;
            return (
              <line
                key={i}
                x1={0}
                y1={0}
                x2={Math.cos(rad) * 13}
                y2={Math.sin(rad) * 13}
                stroke="rgba(214,85,107,0.6)"
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            );
          })}
          <circle r={7} fill="rgba(214,85,107,0.9)" />
        </g>
      </svg>
    </div>
  );
}

// ---- Plinko --------------------------------------------------------------

function plinkoPegs(): { x: number; y: number }[] {
  const rows = 6;
  const pegs: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) {
    const count = r + 2;
    const y = 28 + r * 17;
    const spacing = (VB_W - 20) / (count + 1);
    for (let i = 1; i <= count; i++) {
      pegs.push({ x: 10 + i * spacing, y });
    }
  }
  return pegs;
}

const PLINKO_PEGS = plinkoPegs();

export function PlinkoArt() {
  return (
    <div
      className="absolute inset-0"
      style={{ background: "linear-gradient(155deg, #0f1826 0%, #1c2430 45%, #3a6bd6 150%)" }}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        {PLINKO_PEGS.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.4} fill="rgba(255,255,255,0.4)" />
        ))}
        <line x1={60} y1={4} x2={60} y2={20} stroke="rgba(232,168,66,0.4)" strokeWidth={3} strokeLinecap="round" />
        <circle cx={60} cy={20} r={5.5} fill="rgba(232,168,66,0.95)" />
      </svg>
    </div>
  );
}

export function OriginalArt({ slug }: { slug: OriginalSlug }) {
  if (slug === "dice") return <DiceArt />;
  if (slug === "mines") return <MinesArt />;
  return <PlinkoArt />;
}
