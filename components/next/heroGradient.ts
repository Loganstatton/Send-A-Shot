// Deterministic per-artist gradient for the card hero when there's no real
// photo yet — cycles through the same hue set as the approved mockup so the
// grid reads as varied/alive rather than a wall of identical tiles.
const HERO_GRADIENTS = [
  'linear-gradient(155deg, oklch(70% 0.19 35 / 0.55), oklch(30% 0.08 320 / 0.65) 60%, oklch(16% 0.01 40))',
  'linear-gradient(155deg, oklch(65% 0.17 20 / 0.5), oklch(24% 0.03 40) 65%)',
  'linear-gradient(155deg, oklch(55% 0.1 260 / 0.5), oklch(22% 0.02 40) 65%)',
  'linear-gradient(155deg, oklch(60% 0.1 340 / 0.45), oklch(22% 0.02 40) 65%)',
  'linear-gradient(155deg, oklch(58% 0.14 250 / 0.5), oklch(22% 0.02 40) 65%)',
  'linear-gradient(155deg, oklch(62% 0.14 75 / 0.45), oklch(22% 0.02 40) 65%)',
];

export function heroGradient(seed: number): string {
  return HERO_GRADIENTS[Math.abs(seed) % HERO_GRADIENTS.length];
}
