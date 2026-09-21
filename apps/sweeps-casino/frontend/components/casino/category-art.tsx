// Category-aware procedural art for the broader demo catalog (everything
// that isn't a hand-authored Vaultline Original — see originals-art.tsx).
// Rather than one undifferentiated hash-based gradient for all 38+ demo
// games (lib/tile-art.ts's tileGradient(), still kept as the final safety
// net for any unrecognized category), each GameCategory gets its own
// visual template — a palette family + a thematic motif rendered as CSS
// gradients + simple inline SVG — so every SLOTS game shares a "reel
// strip" language distinct from TABLE_GAMES' felt-table language, distinct
// from LIVE_CASINO's wheel-spoke language, distinct from GAME_SHOWS'
// spotlight-burst language. Within a category, `hashString(game.slug)`
// (reused from lib/tile-art.ts) deterministically drives palette pick,
// angle, and pattern density so category-mates still read as visually
// distinct individual games, not clones.
//
// No external images, no icon/asset libraries, no imagery copied from any
// real casino or game — every motif here is an abstract, original
// composition built from gradients/lines/shapes.

import { hashString } from "@/lib/tile-art";

const VB_W = 120;
const VB_H = 160;

/** Deterministic sub-hash for one variation axis (palette, angle, density, ...). */
function pick(seed: string, salt: string, mod: number): number {
  return hashString(`${seed}:${salt}`) % mod;
}

const CATEGORIES = ["SLOTS", "TABLE_GAMES", "LIVE_CASINO", "GAME_SHOWS"] as const;
type ArtCategory = (typeof CATEGORIES)[number];

export function hasCategoryArt(category: string): category is ArtCategory {
  return (CATEGORIES as readonly string[]).includes(category);
}

// ---- SLOTS: vertical reel-strip motif, warm gold/amber/deep-red family ----
// Classic slot-machine cabinet feel: alternating vertical bands suggesting
// reel columns, with two reel dividers and three symbol "windows".

const SLOTS_PALETTES: [string, string][] = [
  ["#2e1a05", "#e8a842"],
  ["#3a0f14", "#d6556b"],
  ["#241004", "#e8c542"],
  ["#3a1206", "#e8792f"],
];

function SlotsArt({ seed }: { seed: string }) {
  const [c1, c2] = SLOTS_PALETTES[pick(seed, "pal", SLOTS_PALETTES.length)];
  const angle = 145 + pick(seed, "angle", 4) * 10;
  const stripeW = 10 + pick(seed, "stripe", 4) * 3;
  const reelX = [VB_W / 3, (VB_W / 3) * 2];
  const symbolCols = [1, 2, 3].map((col) => ({
    cx: (VB_W / 3) * col - VB_W / 6,
    cy: 28 + pick(seed, `sym${col}`, 3) * ((VB_H - 56) / 2),
  }));

  return (
    <div className="absolute inset-0" style={{ background: `linear-gradient(${angle}deg, ${c1} 0%, ${c2} 130%)` }}>
      <div
        className="absolute inset-0"
        style={{
          background: `repeating-linear-gradient(90deg, rgba(0,0,0,0.28) 0 ${stripeW}px, rgba(255,255,255,0.05) ${stripeW}px ${stripeW * 2}px)`,
        }}
      />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        {reelX.map((x, i) => (
          <line key={i} x1={x} y1={16} x2={x} y2={VB_H - 16} stroke="rgba(255,255,255,0.18)" strokeWidth={1.5} />
        ))}
        {symbolCols.map((s, i) => (
          <circle key={i} cx={s.cx} cy={s.cy} r={7.5} fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.4)" strokeWidth={1} />
        ))}
      </svg>
      <div className="absolute inset-0" style={{ background: "linear-gradient(0deg, rgba(0,0,0,0.35), transparent 40%)" }} />
    </div>
  );
}

// ---- TABLE_GAMES: felt table + card-suit pip, deep emerald family ----
// Green-felt-adjacent palette (deliberately not a literal texture) with a
// soft overhead-light vignette and one large outlined suit pip.

const TABLE_PALETTES: [string, string][] = [
  ["#081f16", "#155c3e"],
  ["#061a17", "#116b52"],
  ["#0b2115", "#1c7a4d"],
  ["#071a14", "#146b4a"],
];

function TableArt({ seed }: { seed: string }) {
  const [c1, c2] = TABLE_PALETTES[pick(seed, "pal", TABLE_PALETTES.length)];
  const angle = 160 + pick(seed, "angle", 4) * 8;
  const suitRot = pick(seed, "suitrot", 4) * 8;
  const suit = pick(seed, "suit", 2); // 0 = diamond, 1 = club-ish quatrefoil

  return (
    <div className="absolute inset-0" style={{ background: `linear-gradient(${angle}deg, ${c1} 0%, ${c2} 140%)` }}>
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 14px), repeating-linear-gradient(-45deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 14px)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(60% 45% at 50% 12%, rgba(255,255,255,0.18), transparent 60%)" }}
      />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <g opacity="0.45" transform={`rotate(${suitRot} 60 96)`}>
          {suit === 0 ? (
            <path d="M60 64 L74 96 L60 128 L46 96 Z" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={1.4} />
          ) : (
            <>
              <circle cx={60} cy={80} r={11} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={1.3} />
              <circle cx={48} cy={100} r={11} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={1.3} />
              <circle cx={72} cy={100} r={11} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={1.3} />
              <rect x={57} y={100} width={6} height={18} fill="rgba(255,255,255,0.3)" />
            </>
          )}
        </g>
      </svg>
      <div className="absolute inset-0" style={{ background: "linear-gradient(0deg, rgba(0,0,0,0.4), transparent 45%)" }} />
    </div>
  );
}

// ---- LIVE_CASINO: off-center wheel-spoke glimpse, cool teal family ----
// A stylized fragment of a wheel (spokes + rim) tucked toward a corner, as
// if the tile were a cropped shot of a live dealer table — cooler, dimmer
// than the other categories to read as "broadcast" rather than "cabinet".

const LIVE_PALETTES: [string, string][] = [
  ["#031318", "#0f5b68"],
  ["#04191f", "#137d8a"],
  ["#02161a", "#0c6672"],
  ["#051a1e", "#189aa8"],
];

function LiveArt({ seed }: { seed: string }) {
  const [c1, c2] = LIVE_PALETTES[pick(seed, "pal", LIVE_PALETTES.length)];
  const angle = 150 + pick(seed, "angle", 5) * 8;
  const spokes = 8 + pick(seed, "spokes", 4) * 2;
  const cx = 88 + pick(seed, "cx", 4) * 8;
  const cy = 26 + pick(seed, "cy", 3) * 10;

  return (
    <div className="absolute inset-0" style={{ background: `linear-gradient(${angle}deg, ${c1} 0%, ${c2} 140%)` }}>
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <g transform={`translate(${cx} ${cy})`} opacity="0.55">
          {Array.from({ length: spokes }).map((_, i) => {
            const a = (i * 360) / spokes;
            const rad = (a * Math.PI) / 180;
            return (
              <line
                key={i}
                x1={0}
                y1={0}
                x2={Math.cos(rad) * 58}
                y2={Math.sin(rad) * 58}
                stroke="rgba(255,255,255,0.16)"
                strokeWidth={1}
              />
            );
          })}
          <circle r={40} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} />
          <circle r={6} fill="rgba(255,255,255,0.35)" />
        </g>
      </svg>
      <div className="absolute inset-0" style={{ background: "linear-gradient(0deg, rgba(0,0,0,0.4), transparent 50%)" }} />
    </div>
  );
}

// ---- GAME_SHOWS: radial spotlight burst, warm high-energy gold/red ----
// The biggest, brightest category — wide fanned beams from an off-top
// point, like a stage light or big-wheel spotlight sweeping the tile.

const SHOWS_PALETTES: [string, string][] = [
  ["#2b0705", "#e8a842"],
  ["#320a02", "#e8c542"],
  ["#22050a", "#d6556b"],
  ["#2b1400", "#e8792a"],
];

function ShowsArt({ seed }: { seed: string }) {
  const [c1, c2] = SHOWS_PALETTES[pick(seed, "pal", SHOWS_PALETTES.length)];
  const angle = 140 + pick(seed, "angle", 5) * 8;
  const beams = 8 + pick(seed, "beams", 3) * 2;
  const cx = 25 + pick(seed, "cx", 5) * 14;

  return (
    <div className="absolute inset-0" style={{ background: `linear-gradient(${angle}deg, ${c1} 0%, ${c2} 145%)` }}>
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <g transform={`translate(${cx} -6)`} opacity="0.4">
          {Array.from({ length: beams }).map((_, i) => {
            const a = -70 + (i * 140) / (beams - 1);
            const rad = (a * Math.PI) / 180;
            const x2 = Math.sin(rad) * 220;
            const y2 = Math.cos(rad) * 220;
            return (
              <polygon
                key={i}
                points={`0,0 ${x2 - 4},${y2} ${x2 + 4},${y2}`}
                fill={i % 2 === 0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.045)"}
              />
            );
          })}
        </g>
        <circle cx={cx} cy={-6} r={10} fill="rgba(255,255,255,0.3)" />
      </svg>
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(55% 40% at 50% 105%, rgba(0,0,0,0.45), transparent 60%)" }}
      />
    </div>
  );
}

export function CategoryArt({ category, seed }: { category: ArtCategory; seed: string }) {
  switch (category) {
    case "SLOTS":
      return <SlotsArt seed={seed} />;
    case "TABLE_GAMES":
      return <TableArt seed={seed} />;
    case "LIVE_CASINO":
      return <LiveArt seed={seed} />;
    case "GAME_SHOWS":
      return <ShowsArt seed={seed} />;
    default:
      return null;
  }
}
