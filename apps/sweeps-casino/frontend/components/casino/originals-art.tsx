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

const SIX_PIPS: [number, number][] = [
  [0.3, 0.3],
  [1.7, 0.3],
  [0.3, 1],
  [1.7, 1],
  [0.3, 1.7],
  [1.7, 1.7],
];

/** Tumbling-motion streaks trailing a die, teal-gold lit. */
function MotionStreaks({ cx, cy, rot }: { cx: number; cy: number; rot: number }) {
  return (
    <g transform={`rotate(${rot} ${cx} ${cy})`} opacity="0.4">
      {[0, 1, 2].map((i) => (
        <line
          key={i}
          x1={cx - 46 - i * 8}
          y1={cy + 6 - i * 5}
          x2={cx - 20 - i * 8}
          y2={cy + 6 - i * 5}
          stroke="rgba(45,191,176,0.8)"
          strokeWidth={2.5 - i * 0.6}
          strokeLinecap="round"
        />
      ))}
    </g>
  );
}

export function DiceArt() {
  return (
    <div
      className="absolute inset-0"
      style={{ background: "linear-gradient(160deg, #0f1626 0%, #1c2440 40%, #2a6b66 78%, #e8a842 150%)" }}
    >
      {/* Spotlight pool the pair of dice sit in — teal-gold lighting cue. */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(60% 50% at 42% 62%, rgba(45,191,176,0.35), transparent 65%)",
        }}
      />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <defs>
          <filter id="dice-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <MotionStreaks cx={40} cy={60} rot={-14} />
        <g transform="rotate(-14 40 60)" opacity="0.95" filter="url(#dice-glow)">
          <DiePips cx={40} cy={60} r={30} pips={SIX_PIPS} />
        </g>
        <g transform="rotate(22 90 110)" opacity="0.8">
          <DiePips cx={90} cy={110} r={19} pips={THREE_PIPS} />
        </g>
        {/* Landed-tumble arc, echoing motion without literal animation. */}
        <path
          d="M14 96 Q 40 118 70 100"
          fill="none"
          stroke="rgba(232,168,66,0.35)"
          strokeWidth={2}
          strokeDasharray="1 6"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

// ---- Mines -------------------------------------------------------------

const MINE_COLS = 4;
const MINE_ROWS = 5;
const MINE_CELL = { r: 1, c: 2 };
// Cells that reveal a gem instead of staying an unopened tile — an
// "underground vault" feel of mostly-buried treasure with one live mine,
// rather than a uniform grid of identical squares.
const GEM_CELLS: { r: number; c: number; color: "gold" | "teal" }[] = [
  { r: 0, c: 0, color: "teal" },
  { r: 0, c: 3, color: "gold" },
  { r: 2, c: 1, color: "gold" },
  { r: 3, c: 3, color: "teal" },
  { r: 4, c: 0, color: "gold" },
];

function Gem({ cx, cy, size, color }: { cx: number; cy: number; size: number; color: "gold" | "teal" }) {
  const fill = color === "gold" ? "rgba(232,168,66,0.85)" : "rgba(45,191,176,0.85)";
  const glow = color === "gold" ? "rgba(232,168,66,0.5)" : "rgba(45,191,176,0.5)";
  const top = cy - size;
  const mid = cy - size * 0.35;
  const bottom = cy + size * 0.7;
  return (
    <g>
      <circle cx={cx} cy={cy} r={size * 1.6} fill={glow} opacity="0.25" />
      <path
        d={`M${cx - size} ${mid} L${cx} ${top} L${cx + size} ${mid} L${cx} ${bottom} Z`}
        fill={fill}
        stroke="rgba(255,255,255,0.5)"
        strokeWidth={0.6}
      />
      <path d={`M${cx - size} ${mid} L${cx} ${bottom} L${cx} ${top} Z`} fill="rgba(255,255,255,0.18)" />
    </g>
  );
}

export function MinesArt() {
  const cellW = VB_W / MINE_COLS;
  const cellH = VB_H / MINE_ROWS;
  const cells: { r: number; c: number }[] = [];
  for (let r = 0; r < MINE_ROWS; r++) {
    for (let c = 0; c < MINE_COLS; c++) cells.push({ r, c });
  }
  const mineX = MINE_CELL.c * cellW + cellW / 2;
  const mineY = MINE_CELL.r * cellH + cellH / 2;
  const gemAt = (r: number, c: number) => GEM_CELLS.find((g) => g.r === r && g.c === c);

  return (
    <div
      className="absolute inset-0"
      style={{ background: "linear-gradient(175deg, #060a09 0%, #0d1512 45%, #142019 78%, #1c2430 130%)" }}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        {cells.map(({ r, c }) => {
          const isMine = r === MINE_CELL.r && c === MINE_CELL.c;
          const gem = gemAt(r, c);
          const x = c * cellW + 3;
          const y = r * cellH + 3;
          const w = cellW - 6;
          const h = cellH - 6;
          return (
            <rect
              key={`${r}-${c}`}
              x={x}
              y={y}
              width={w}
              height={h}
              rx={4}
              fill={isMine ? "rgba(214,85,107,0.22)" : gem ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.035)"}
              stroke={isMine ? "rgba(214,85,107,0.55)" : "rgba(255,255,255,0.1)"}
              strokeWidth={1}
            />
          );
        })}
        {GEM_CELLS.map((g, i) => (
          <Gem
            key={i}
            cx={g.c * cellW + cellW / 2}
            cy={g.r * cellH + cellH / 2}
            size={cellW * 0.24}
            color={g.color}
          />
        ))}
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

// Multiplier slots along the bottom rail — a low-in-the-middle, high-on-
// the-edges curve (as in the real payout table) rendered as colored bars
// of varying height rather than literal digits, which would be illegible
// at tile size.
const SLOT_COUNT = 9;
const SLOT_HEIGHTS = [0.9, 0.65, 0.45, 0.3, 0.22, 0.3, 0.45, 0.65, 0.9];
function slotColor(h: number): string {
  if (h >= 0.8) return "rgba(214,85,107,0.85)";
  if (h >= 0.5) return "rgba(232,168,66,0.85)";
  return "rgba(45,191,176,0.75)";
}

export function PlinkoArt() {
  const slotAreaY = VB_H - 22;
  const slotW = (VB_W - 8) / SLOT_COUNT;

  return (
    <div
      className="absolute inset-0"
      style={{ background: "linear-gradient(160deg, #0a1220 0%, #16233a 40%, #1c2430 68%, #3a6bd6 150%)" }}
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
        {/* Ball drop trail + ball */}
        <line x1={60} y1={4} x2={60} y2={18} stroke="rgba(232,168,66,0.4)" strokeWidth={3} strokeLinecap="round" />
        <circle cx={60} cy={18} r={5.5} fill="rgba(232,168,66,0.95)" />
        <circle cx={60} cy={18} r={9} fill="rgba(232,168,66,0.25)" />
        {/* Multiplier slot rail */}
        {SLOT_HEIGHTS.map((h, i) => {
          const x = 4 + i * slotW;
          const barH = h * 18;
          return (
            <rect
              key={i}
              x={x + 1.5}
              y={slotAreaY - barH}
              width={slotW - 3}
              height={barH}
              rx={1.5}
              fill={slotColor(h)}
              opacity={0.85}
            />
          );
        })}
        <line x1={2} y1={slotAreaY + 2} x2={VB_W - 2} y2={slotAreaY + 2} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
      </svg>
    </div>
  );
}

export function OriginalArt({ slug }: { slug: OriginalSlug }) {
  if (slug === "dice") return <DiceArt />;
  if (slug === "mines") return <MinesArt />;
  return <PlinkoArt />;
}
