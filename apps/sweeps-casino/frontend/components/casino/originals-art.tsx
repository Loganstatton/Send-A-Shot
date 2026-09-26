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
//
// Card art rebuild (design pass — #1-priority game): the old version read
// as scattered dots on a flat gradient. This one is built the same way the
// real board is (see PlinkoBoard.tsx) — a dark physical cabinet with a
// metal frame, a triangular peg field in forced perspective (tight/small up
// top, wide/large at the bottom, like looking slightly up at a tall
// machine), a big glowing gold ball caught mid-drop, and a real-looking
// pocket rail at the bottom — a "game poster", not an icon.

// Perspective peg triangle: 6 rows, narrow at the top, splayed wide at the
// bottom, with peg radius growing toward camera (bottom) for a forced-depth
// read at a glance.
function plinkoPegs(): { x: number; y: number; row: number; r: number }[] {
  const rows = 6;
  const pegs: { x: number; y: number; row: number; r: number }[] = [];
  const topY = 34;
  const bottomY = 108;
  for (let r = 0; r < rows; r++) {
    const t = rows > 1 ? r / (rows - 1) : 0;
    const count = r + 3;
    const y = topY + t * (bottomY - topY);
    // Ease the horizontal spread outward (perspective: wide fan near
    // camera) rather than a plain linear triangle.
    const halfSpan = (VB_W * 0.5 - 10) * (0.32 + 0.68 * t * t);
    const spacing = (halfSpan * 2) / (count + 1);
    const rPeg = 1.7 + t * 1.6;
    for (let i = 1; i <= count; i++) {
      pegs.push({ x: VB_W / 2 - halfSpan + i * spacing, y, row: r, r: rPeg });
    }
  }
  return pegs;
}

const PLINKO_PEGS = plinkoPegs();

// Multiplier pockets along the bottom rail — a low-in-the-middle,
// high-on-the-edges curve (as in the real payout table), drawn as real
// physical pockets (divider walls + a lit floor) rather than a bare bar
// chart, echoing the real board's pocket shelf.
const SLOT_COUNT = 9;
const SLOT_HEIGHTS = [0.55, 0.36, 0.22, 0.14, 0.1, 0.14, 0.22, 0.36, 0.55];
function slotColor(h: number): [string, string] {
  if (h >= 0.5) return ["#e8748c", "#a23349"];
  if (h >= 0.3) return ["#f3c467", "#b9812a"];
  return ["#5fe0cf", "#1f8d80"];
}

export function PlinkoArt() {
  const railTop = 118;
  const railBottom = 140;
  const slotW = (VB_W - 12) / SLOT_COUNT;
  const ballX = VB_W * 0.42;
  const ballY = 64;

  return (
    <div className="absolute inset-0" style={{ background: "linear-gradient(170deg, #0d1420 0%, #141c2c 45%, #0c1118 100%)" }}>
      {/* Teal ambient glow washing the peg field, gold pool low behind the
          pockets — the same two-tone environmental lighting language as the
          real board. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 55% at 50% 45%, rgba(45,191,176,0.22), transparent 68%), radial-gradient(55% 40% at 50% 92%, rgba(232,168,66,0.16), transparent 70%)",
        }}
      />
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
        <defs>
          <radialGradient id="plinko-ball-grad" cx="35%" cy="32%" r="70%">
            <stop offset="0%" stopColor="#fffdf3" />
            <stop offset="35%" stopColor="#f8e08a" />
            <stop offset="70%" stopColor="#dcae35" />
            <stop offset="100%" stopColor="#8f680f" />
          </radialGradient>
          <filter id="plinko-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="plinko-rail" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(150,168,178,0.9)" />
            <stop offset="50%" stopColor="rgba(70,82,92,0.9)" />
            <stop offset="100%" stopColor="rgba(30,36,42,0.9)" />
          </linearGradient>
        </defs>

        {/* Metal cabinet frame, giving the whole poster a physical machine
            edge rather than art bleeding straight to the tile border. */}
        <rect
          x={2.5}
          y={2.5}
          width={VB_W - 5}
          height={VB_H - 5}
          rx={9}
          fill="none"
          stroke="url(#plinko-rail)"
          strokeWidth={2.5}
          opacity={0.8}
        />

        {/* Drop chute at the top, aligned above the ball. */}
        <rect x={ballX - 3} y={8} width={6} height={16} rx={2} fill="rgba(120,220,208,0.28)" />

        {/* Pegs, in perspective, small+dim near the top and large+lit near
            the bottom — teal illuminated rim + tiny specular dot, same
            recipe as the real board's drawPeg(). */}
        {PLINKO_PEGS.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y + p.r * 0.35} r={p.r * 0.9} fill="rgba(0,0,0,0.35)" />
            <circle cx={p.x} cy={p.y} r={p.r} fill="#3a434c" />
            <circle cx={p.x} cy={p.y} r={p.r * 0.88} fill="none" stroke="rgba(100,220,205,0.75)" strokeWidth={p.r * 0.22} filter="url(#plinko-glow)" />
            <circle cx={p.x - p.r * 0.3} cy={p.y - p.r * 0.3} r={Math.max(0.4, p.r * 0.22)} fill="rgba(255,255,255,0.85)" />
          </g>
        ))}

        {/* Motion trail arcing behind the ball, selling "mid-drop" motion. */}
        <path
          d={`M${ballX - 26} ${ballY - 22} Q ${ballX - 10} ${ballY - 8} ${ballX} ${ballY}`}
          fill="none"
          stroke="rgba(240,200,100,0.35)"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray="0.5 5"
        />

        {/* The ball — the strongest focal point on the card, bright gold
            with bloom, exactly like the real board's drawBall(). */}
        <circle cx={ballX} cy={ballY} r={13} fill="rgba(240,195,90,0.22)" />
        <circle cx={ballX} cy={ballY} r={8.5} fill="url(#plinko-ball-grad)" filter="url(#plinko-glow)" />
        <circle cx={ballX - 2.6} cy={ballY - 2.8} r={2.3} fill="rgba(255,255,255,0.95)" />

        {/* Pocket rail: real dividers + a lit shelf, not a bar chart. */}
        <rect x={4} y={railTop} width={VB_W - 8} height={railBottom - railTop} rx={3} fill="rgba(0,0,0,0.28)" />
        <line x1={4} y1={railTop} x2={VB_W - 4} y2={railTop} stroke="rgba(120,225,210,0.4)" strokeWidth={1} />
        {SLOT_HEIGHTS.map((h, i) => {
          const x = 6 + i * slotW;
          const [top, bottom] = slotColor(h);
          const litH = 2 + h * (railBottom - railTop - 4);
          return (
            <g key={i}>
              <rect x={x + 1} y={railBottom - litH - 2} width={slotW - 2} height={litH} rx={1.5} fill={top} opacity={0.85} />
              <rect x={x + 1} y={railBottom - 2} width={slotW - 2} height={2} fill={bottom} opacity={0.9} />
            </g>
          );
        })}
        {Array.from({ length: SLOT_COUNT + 1 }).map((_, i) => (
          <line
            key={i}
            x1={4 + i * slotW}
            y1={railTop + 2}
            x2={4 + i * slotW}
            y2={railBottom}
            stroke="rgba(200,212,218,0.22)"
            strokeWidth={1}
          />
        ))}
      </svg>
    </div>
  );
}

export function OriginalArt({ slug }: { slug: OriginalSlug }) {
  if (slug === "dice") return <DiceArt />;
  if (slug === "mines") return <MinesArt />;
  return <PlinkoArt />;
}
