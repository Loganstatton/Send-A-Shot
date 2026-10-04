import type { ReviewItem } from './types';

/** Post-generation quality checklist with a practical fix hint for each issue. */
export const REVIEW_INFO: Record<ReviewItem, { label: string; fix: string }> = {
  face_drift: { label: 'Face drift', fix: 'Raise LoRA strength (+0.1) or face-reference weight; keep Sienna Lock on; use a closer framing.' },
  eye_mismatch: { label: 'Eye colour / shape mismatch', fix: 'Make sure eye colour is in the profile traits; check no field mentions eyes; try a sharper face reference.' },
  freckles_changed: { label: 'Freckles changed', fix: 'Keep “light freckles” in core traits; reduce over-smoothing (lower CFG, avoid “flawless skin”).' },
  hairline_changed: { label: 'Hairline / parting changed', fix: 'Describe the parting in core traits; avoid hats/hairstyle words that move the hairline.' },
  hands: { label: 'Hand / finger errors', fix: 'Reroll seed, hide hands in the pose, or fix with an inpaint pass.' },
  teeth: { label: 'Teeth errors', fix: 'Use a closed-mouth expression or reroll; lower CFG slightly.' },
  jewelry: { label: 'Jewelry inconsistency', fix: 'Specify jewelry explicitly in outfit (or “no jewelry”).' },
  warped_background: { label: 'Warped background', fix: 'Simplify the setting; use 1x lens instead of 0.5x; reduce LoRA strength slightly.' },
  reflections: { label: 'Bad mirror reflections', fix: 'Describe the mirror and phone placement precisely; try a pose ControlNet.' },
  duplicated_objects: { label: 'Duplicated objects', fix: 'Reduce resolution toward ~1MP, simplify the scene, reroll.' },
  anatomy: { label: 'Anatomy problems', fix: 'Use a pose ControlNet image, change framing, or reroll the seed.' },
};
