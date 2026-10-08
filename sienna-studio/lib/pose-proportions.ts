/**
 * Sienna's body proportions for pose retargeting, in units of torso length (neck → mid-hip),
 * as OpenPose bone groups (longer side of each left/right pair).
 *
 * MEASURED: null until measured from approved v2 images with DWPose (see the Phase 1 test
 * session). Until then GENERIC is used — average adult-female proportions — and the UI says so.
 */
export const GENERIC_POSE_PROPORTIONS = {
  shoulder: 0.34,
  upper_arm: 0.58,
  forearm: 0.48,
  hip: 0.95,
  thigh: 0.82,
  shin: 0.8,
  head: 0.4,
} as const;

export const SIENNA_POSE_PROPORTIONS: Record<string, number> | null = null;

export function poseProportions(): { values: Record<string, number>; source: 'sienna' | 'generic' } {
  // Measured values can be supplied at runtime (e.g. during a test session) without a rebuild.
  const env = typeof process !== 'undefined' ? process.env.SIENNA_POSE_PROPORTIONS_JSON : undefined;
  if (env) {
    try {
      const v = JSON.parse(env);
      if (v && typeof v === 'object' && Object.values(v).every((n) => typeof n === 'number' && n > 0 && n < 3)) {
        return { values: v as Record<string, number>, source: 'sienna' };
      }
    } catch {
      /* ignore malformed override */
    }
  }
  return SIENNA_POSE_PROPORTIONS
    ? { values: SIENNA_POSE_PROPORTIONS, source: 'sienna' }
    : { values: { ...GENERIC_POSE_PROPORTIONS }, source: 'generic' };
}
