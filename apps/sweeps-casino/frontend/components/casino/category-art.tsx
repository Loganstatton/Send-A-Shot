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

/** Three-reel cabinet: alternating reel columns, three round symbol windows. */
function SlotsClassic({ seed, c1, c2, angle }: { seed: string; c1: string; c2: string; angle: number }) {
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
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
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

/** Five-reel jackpot cabinet: five thin reels, a marquee arc glow up top, one big central jackpot symbol. */
function SlotsJackpotCabinet({ seed, c1, c2, angle }: { seed: string; c1: string; c2: string; angle: number }) {
  const reelCount = 5;
  const symbolShape = pick(seed, "shape", 3); // 0 = seven, 1 = star, 2 = diamond
  return (
    <div className="absolute inset-0" style={{ background: `linear-gradient(${angle}deg, ${c1} 0%, ${c2} 145%)` }}>
      <div className="absolute inset-0" style={{ background: "radial-gradient(65% 40% at 50% 8%, rgba(255,255,255,0.22), transparent 60%)" }} />
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
        {Array.from({ length: reelCount - 1 }).map((_, i) => {
          const x = ((i + 1) * VB_W) / reelCount;
          return <line key={i} x1={x} y1={24} x2={x} y2={VB_H - 12} stroke="rgba(255,255,255,0.14)" strokeWidth={1} />;
        })}
        <rect x={4} y={20} width={VB_W - 8} height={VB_H - 34} rx={5} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={1.5} />
        {/* Marquee bulbs along the top arc */}
        {Array.from({ length: 7 }).map((_, i) => (
          <circle key={i} cx={10 + i * ((VB_W - 20) / 6)} cy={11} r={2} fill="rgba(255,255,255,0.55)" />
        ))}
        <g transform={`translate(${VB_W / 2} ${VB_H / 2 + 6})`}>
          {symbolShape === 0 && (
            <path d="M-13 -18 H13 L-3 18" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
          )}
          {symbolShape === 1 &&
            Array.from({ length: 5 }).map((_, i) => {
              const a = (-90 + i * 72) * (Math.PI / 180);
              const a2 = (-90 + i * 72 + 36) * (Math.PI / 180);
              return (
                <polygon
                  key={i}
                  points={`0,0 ${Math.cos(a) * 18},${Math.sin(a) * 18} ${Math.cos(a2) * 8},${Math.sin(a2) * 8}`}
                  fill="rgba(255,255,255,0.8)"
                />
              );
            })}
          {symbolShape === 2 && (
            <path d="M0 -20 L16 0 L0 20 L-16 0 Z" fill="rgba(255,255,255,0.8)" stroke="rgba(255,255,255,0.4)" strokeWidth={1} />
          )}
        </g>
      </svg>
      <div className="absolute inset-0" style={{ background: "linear-gradient(0deg, rgba(0,0,0,0.4), transparent 45%)" }} />
    </div>
  );
}

function SlotsArt({ seed }: { seed: string }) {
  const [c1, c2] = SLOTS_PALETTES[pick(seed, "pal", SLOTS_PALETTES.length)];
  const angle = 145 + pick(seed, "angle", 4) * 10;
  return pick(seed, "variant", 2) === 0 ? (
    <SlotsClassic seed={seed} c1={c1} c2={c2} angle={angle} />
  ) : (
    <SlotsJackpotCabinet seed={seed} c1={c1} c2={c2} angle={angle} />
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
  const suit = pick(seed, "suit", 4); // 0 diamond, 1 club, 2 spade, 3 heart

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
        <g opacity="0.45" transform={`rotate(${suitRot} 60 96)`} stroke="rgba(255,255,255,0.4)" strokeWidth={1.3} fill="none">
          {suit === 0 && <path d="M60 64 L74 96 L60 128 L46 96 Z" />}
          {suit === 1 && (
            <>
              <circle cx={60} cy={80} r={11} />
              <circle cx={48} cy={100} r={11} />
              <circle cx={72} cy={100} r={11} />
              <rect x={57} y={100} width={6} height={18} fill="rgba(255,255,255,0.3)" stroke="none" />
            </>
          )}
          {suit === 2 && (
            <path d="M60 62 C 78 82, 78 100, 60 108 C 42 100, 42 82, 60 62 Z M60 108 L60 128 M50 122 L70 122" />
          )}
          {suit === 3 && (
            <path d="M60 128 C 30 104, 34 76, 54 76 C 58 76, 60 80, 60 84 C 60 80, 62 76, 66 76 C 86 76, 90 104, 60 128 Z" />
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

/** Off-center fragment of a roulette wheel, as if cropped from a live table shot. */
function LiveWheelFragment({ seed, c1, c2, angle }: { seed: string; c1: string; c2: string; angle: number }) {
  const spokes = 8 + pick(seed, "spokes", 4) * 2;
  const cx = 88 + pick(seed, "cx", 4) * 8;
  const cy = 26 + pick(seed, "cy", 3) * 10;
  return (
    <div className="absolute inset-0" style={{ background: `linear-gradient(${angle}deg, ${c1} 0%, ${c2} 140%)` }}>
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
        <g transform={`translate(${cx} ${cy})`} opacity="0.55">
          {Array.from({ length: spokes }).map((_, i) => {
            const a = (i * 360) / spokes;
            const rad = (a * Math.PI) / 180;
            return (
              <line key={i} x1={0} y1={0} x2={Math.cos(rad) * 58} y2={Math.sin(rad) * 58} stroke="rgba(255,255,255,0.16)" strokeWidth={1} />
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

/** Broadcast-studio feel: a bright horizontal camera light bar + a dealer "button" chip lower corner. */
function LiveStudioGlare({ seed, c1, c2, angle }: { seed: string; c1: string; c2: string; angle: number }) {
  const barY = 18 + pick(seed, "bary", 4) * 8;
  const chipX = 22 + pick(seed, "chipx", 3) * 32;
  return (
    <div className="absolute inset-0" style={{ background: `linear-gradient(${angle}deg, ${c1} 0%, ${c2} 140%)` }}>
      <div
        className="absolute inset-x-0"
        style={{ top: `${(barY / VB_H) * 100}%`, height: "10%", background: "linear-gradient(180deg, rgba(255,255,255,0.28), transparent)" }}
      />
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
        <line x1={0} y1={barY} x2={VB_W} y2={barY} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
        <g transform={`translate(${chipX} ${VB_H - 26})`} opacity="0.8">
          <circle r={13} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={1.5} strokeDasharray="3 3" />
          <circle r={8} fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.4)" strokeWidth={1} />
        </g>
        {/* Faint fanned card-back edges suggesting a dealt hand off-frame */}
        <g transform={`translate(${VB_W - 20} ${VB_H - 8})`} opacity="0.35">
          {[-10, 0, 10].map((r, i) => (
            <rect key={i} x={-7} y={-30} width={14} height={20} rx={2} transform={`rotate(${r})`} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={1} />
          ))}
        </g>
      </svg>
      <div className="absolute inset-0" style={{ background: "linear-gradient(0deg, rgba(0,0,0,0.45), transparent 55%)" }} />
    </div>
  );
}

function LiveArt({ seed }: { seed: string }) {
  const [c1, c2] = LIVE_PALETTES[pick(seed, "pal", LIVE_PALETTES.length)];
  const angle = 150 + pick(seed, "angle", 5) * 8;
  return pick(seed, "variant", 2) === 0 ? (
    <LiveWheelFragment seed={seed} c1={c1} c2={c2} angle={angle} />
  ) : (
    <LiveStudioGlare seed={seed} c1={c1} c2={c2} angle={angle} />
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

/** Off-top radial spotlight fan, as if a stage light is sweeping the tile. */
function ShowsSpotlight({ seed, c1, c2, angle }: { seed: string; c1: string; c2: string; angle: number }) {
  const beams = 8 + pick(seed, "beams", 3) * 2;
  const cx = 25 + pick(seed, "cx", 5) * 14;
  return (
    <div className="absolute inset-0" style={{ background: `linear-gradient(${angle}deg, ${c1} 0%, ${c2} 145%)` }}>
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
        <g transform={`translate(${cx} -6)`} opacity="0.4">
          {Array.from({ length: beams }).map((_, i) => {
            const a = -70 + (i * 140) / (beams - 1);
            const rad = (a * Math.PI) / 180;
            const x2 = Math.sin(rad) * 220;
            const y2 = Math.cos(rad) * 220;
            return (
              <polygon key={i} points={`0,0 ${x2 - 4},${y2} ${x2 + 4},${y2}`} fill={i % 2 === 0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.045)"} />
            );
          })}
        </g>
        <circle cx={cx} cy={-6} r={10} fill="rgba(255,255,255,0.3)" />
      </svg>
      <div className="absolute inset-0" style={{ background: "radial-gradient(55% 40% at 50% 105%, rgba(0,0,0,0.45), transparent 60%)" }} />
    </div>
  );
}

/** Big-wheel segment fragment: alternating wedges arcing off one edge, as if the tile were cropped from the wheel itself. */
function ShowsBigWheel({ seed, c1, c2, angle }: { seed: string; c1: string; c2: string; angle: number }) {
  const segCount = 10 + pick(seed, "segs", 3) * 2;
  const cx = VB_W * (0.15 + pick(seed, "cx2", 3) * 0.15);
  const cy = VB_H + 34;
  const r = 96;
  return (
    <div className="absolute inset-0" style={{ background: `linear-gradient(${angle}deg, ${c1} 0%, ${c2} 145%)` }}>
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
        <g transform={`translate(${cx} ${cy})`}>
          {Array.from({ length: segCount }).map((_, i) => {
            const a1 = ((-90 - 60) + (i * 120) / segCount) * (Math.PI / 180);
            const a2 = ((-90 - 60) + ((i + 1) * 120) / segCount) * (Math.PI / 180);
            return (
              <path
                key={i}
                d={`M0 0 L${Math.cos(a1) * r} ${Math.sin(a1) * r} A ${r} ${r} 0 0 1 ${Math.cos(a2) * r} ${Math.sin(a2) * r} Z`}
                fill={i % 2 === 0 ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.04)"}
                stroke="rgba(255,255,255,0.22)"
                strokeWidth={0.75}
              />
            );
          })}
          <circle r={14} fill="rgba(0,0,0,0.3)" stroke="rgba(255,255,255,0.35)" strokeWidth={1.5} />
        </g>
        {/* Pointer/flapper at the top of the visible arc */}
        <polygon points={`${cx} ${cy - r - 8}, ${cx - 4} ${cy - r + 2}, ${cx + 4} ${cy - r + 2}`} fill="rgba(255,255,255,0.55)" />
      </svg>
      <div className="absolute inset-0" style={{ background: "linear-gradient(0deg, rgba(0,0,0,0.35), transparent 45%)" }} />
    </div>
  );
}

function ShowsArt({ seed }: { seed: string }) {
  const [c1, c2] = SHOWS_PALETTES[pick(seed, "pal", SHOWS_PALETTES.length)];
  const angle = 140 + pick(seed, "angle", 5) * 8;
  return pick(seed, "variant", 2) === 0 ? (
    <ShowsSpotlight seed={seed} c1={c1} c2={c2} angle={angle} />
  ) : (
    <ShowsBigWheel seed={seed} c1={c1} c2={c2} angle={angle} />
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
