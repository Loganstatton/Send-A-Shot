/**
 * Safe framing for video: room around Sienna for the whole movement, so her head and feet stay in the frame.
 *
 * Why: photos are usually framed tight (head at the top edge). Video can't invent what is outside the first frame
 * without the subject leaving it, so in the jump test her head left the frame at the peak.
 *
 * How (GPU, SiennaSafeFrame node + SDXL outpaint, see buildSafeFrame in lib/video.ts):
 *  1. The node segments her (hair included) and measures her standing body height H in the photo.
 *  2. The movement's margins below (fractions of H) say how much room is needed above, below and beside her.
 *  3. Only the missing room is added, on the sides that lack it — she is never made smaller than the margins require,
 *     and a photo that already has room is left untouched. Extra width is added only if the frame would otherwise get
 *     taller than 9:16 (a phone held upright). The added strip is filled by SDXL from the photo's own edges and the
 *     original pixels are pasted back unchanged.
 *  4. The framed photo is scaled to the usual 480p/720p pixel count, so her size in the video changes only by the
 *     added room.
 *
 * Margins come from the motion-capture reference data (CMU Graphics Lab Motion Capture Database):
 *  jump   peak foot lift 0.18 H in the reference jump (16_02) + arms/hair → 0.24 H above her head
 *  bend   head goes down, arms reach forward/sideways → small side room only
 *  turn   hair and arms swing out → side room
 *  walk   toward the camera she grows in the frame (≈ 10–15% over a few steps) → room on every side
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

export const MOVEMENT_MARGINS: Record<MovementKind, MovementMargins> = {
  still: { top: 0, bottom: 0, side: 0 },
  small: { top: 0.02, bottom: 0, side: 0.04 },
  walk: { top: 0.08, bottom: 0.03, side: 0.1 },
  bend: { top: 0.02, bottom: 0.02, side: 0.1 },
  turn: { top: 0.04, bottom: 0.02, side: 0.12 },
  jump: { top: 0.24, bottom: 0.03, side: 0.08 },
  athletic: { top: 0.24, bottom: 0.03, side: 0.15 },
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
  if (/\b(jump|hop|leap|bounc)/.test(t)) return 'jump';
  if (/\b(danc|twirl|spin|run|kick|cartwheel|workout|exercis)/.test(t)) return 'athletic';
  if (/\bturns?\s+(all the way\s+)?around\b|\bturning around\b|\bback (faces|to) the camera\b/.test(t)) return 'turn';
  if (/\b(bend|bends|bending|pick(s|ing)? (it |something )?up|crouch|squat|kneel)/.test(t)) return 'bend';
  if (/\b(walk|step|stroll|approach)/.test(t)) return 'walk';
  if (/\b(sway|shift|rock|stance|lean)/.test(t)) return 'small';
  return 'still';
}
