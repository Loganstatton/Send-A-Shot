// Deterministic, original CSS-gradient "artwork" generator for game tiles.
// No real casino's imagery is fetched or referenced — this produces a
// distinctive abstract pattern per game slug so the lobby never ships with
// broken image links while there's no real game-art pipeline yet.

const PALETTES: [string, string][] = [
  ["#e8a842", "#2dbfb0"], // amber / teal (brand pair)
  ["#6b5bd6", "#2dbfb0"],
  ["#d6556b", "#e8a842"],
  ["#3a6bd6", "#8a5bd6"],
  ["#2dbf85", "#1c2430"],
  ["#d68a3a", "#6b3ad6"],
  ["#d63a7d", "#3a6bd6"],
  ["#3ad6c4", "#3a4bd6"],
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function tileGradient(seed: string): string {
  const h = hashString(seed);
  const [c1, c2] = PALETTES[h % PALETTES.length];
  const angle = (h % 6) * 30 + 45;
  return `linear-gradient(${angle}deg, ${c1} 0%, ${c2} 100%)`;
}

export function tilePatternId(seed: string): number {
  return hashString(seed) % 4;
}
