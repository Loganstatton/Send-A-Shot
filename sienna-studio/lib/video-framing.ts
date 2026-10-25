/**
 * Safe framing for video: room around Sienna for the whole movement, so her head and feet stay in the frame.
 *
 * Why: photos are usually framed tight (head at the top edge). Video can't invent what is outside the first frame
 * without the subject leaving it, so in the jump test her head left the frame at the peak.
 *
 * How (GPU, SiennaSafeFrame node + SDXL outpaint, see buildSafeFrame in lib/video.ts):
 *  1. The node segments her (hair included) and measures her standing body height H in the photo.
 *  2. The movement's margins below (fractions of H) say how much room is needed above, below and beside her.
 *  3. Only the missing room is added, above and below her — she is never made smaller than the margins require, and
 *     a photo that already has room is left untouched. If the frame would get taller than 9:16 (a phone held upright)
 *     the room is reduced instead (reported as capped). No side strips: in the Phase 2 test they showed seams. The
 *     added strip is filled by SDXL from the photo's own edges and the original pixels are pasted back unchanged.
 *  4. The framed photo is scaled to the usual 480p/720p pixel count, so her size in the video changes only by the
 *     added room.
 *
 * Margins come from the motion-capture reference data (CMU Graphics Lab Motion Capture Database):
 *  jump   peak foot lift 0.18 H in the reference jump (16_02) + arms/hair → 0.24 H above her head
 *  bend   head goes down, arms reach forward → a little room above and below
 *  turn   hair lifts as it swings → a little room above
 *  walk   toward the camera she grows in the frame (≈ 10–15% over a few steps) → room above and below
 */
export type MovementKind = 'still' | 'small' | 'walk' | 'bend' | 'turn' | 'jump' | 'athletic';

export interface MovementMargins {
  /** Room needed above the top of her head, as a fraction of her standing height (head top → feet). */
  top: number;
  /** Room below her feet. */
  bottom: number;
  /** Room left and right of her silhouette. */
  side: number;
}

export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  still: 'Small movements (face, hands)',
  small: 'Swaying, shifting her stance',
  walk: 'Walking',
  bend: 'Bending, picking up',
  turn: 'Turning around',
  jump: 'Jumping',
  athletic: 'Dance, athletic, fast',
};

/**
 * Room above/below only. Phase 2 GPU test (Oct 2026): a strip above her head (sky, trees) filled seamlessly, but side
 * strips next to a busy beach background came out as a different scene with a visible box around the photo — so no
 * side room is added until the fill can be made seamless there. `side` stays in the type for that later step.
 */
export const MOVEMENT_MARGINS: Record<MovementKind, MovementMargins> = {
  still: { top: 0, bottom: 0, side: 0 },
  small: { top: 0.02, bottom: 0, side: 0 },
  walk: { top: 0.08, bottom: 0.03, side: 0 },
  bend: { top: 0.02, bottom: 0.02, side: 0 },
  turn: { top: 0.04, bottom: 0.02, side: 0 },
  jump: { top: 0.24, bottom: 0.03, side: 0 },
  athletic: { top: 0.24, bottom: 0.03, side: 0 },
};

/** Movements where safe framing is switched on by default (the user can turn it off; nothing happens silently). */
export const SAFE_FRAMING_DEFAULT: Record<MovementKind, boolean> = {
  still: false,
  small: false,
  walk: false,
  bend: false,
  turn: true,
  jump: true,
  athletic: true,
};

/** Never add more than this fraction of the photo's height (or width) — beyond it she'd get too small. */
export const SAFE_FRAME_MAX_PAD = 0.4;
/** Tallest frame safe framing will produce (width / height). */
export const SAFE_FRAME_MIN_ASPECT = 9 / 16;

/** Guess the movement from free text (Animate Image) when no preset is selected. */
export function movementFromText(text: string): MovementKind {
  const t = text.toLowerCase();
  if (/\b(jump(s|ing|ed)?|hop(s|ping|ped)?|leap(s|ing|t)?|bounc(e|es|ing))\b/.test(t)) return 'jump';
  if (/\b(danc(e|es|ing)|twirl(s|ing)?|spin(s|ning)?|run(s|ning)?|kick(s|ing)?|cartwheels?|workout|exercis(e|es|ing))\b/.test(t)) return 'athletic';
  if (/\bturns?\s+(all the way\s+)?around\b|\bturning around\b|\bback (faces|to) the camera\b/.test(t)) return 'turn';
  if (/\b(bend|bends|bending|pick(s|ing)? (it |something )?up|crouch(es|ing)?|squat(s|ting)?|kneel(s|ing)?)\b/.test(t)) return 'bend';
  if (/\b(walk(s|ing)?|steps? (forward|back|closer|toward|towards|in|out|aside)|stepping|stroll(s|ing)?|approach(es|ing)?)\b/.test(t)) return 'walk';
  if (/\b(sway(s|ing)?|shift(s|ing)?|rock(s|ing)|stance|lean(s|ing)?)\b/.test(t)) return 'small';
  return 'still';
}
