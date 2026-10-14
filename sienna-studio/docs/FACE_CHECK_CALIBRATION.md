# Face check: pose-aware verification — offline calibration

Status: **dev branch only, not deployed.** Needs the real-GPU A/B (below) and the owner's approval first.

## What changes

The deployed face check redoes any photo whose face scores below 0.74 against Sienna's reference, up to four
photos in all, then keeps the closest. From-behind shots (looking back over her shoulder, kneeling, the sink
selfie) score lower because her face is turned, so they almost always use all four attempts.

The proposed check has three outcomes (`lib/identity.ts`, `faceVerdict`):

| Outcome | When | What happens |
|---|---|---|
| **Verified** | similarity ≥ 0.74, any pose | Counts as Sienna. The only outcome that does. |
| **Inconclusive** | her face is turned away (from-behind request, looking-back preset, Kneeling/Sink packs, or a measured head turn) **and** 0.68 ≤ similarity < 0.74 **and** hair/skin colour consistent with hers; or no face could be read | Not retried. Never counted as a match. Flagged in the gallery: "Face not verified", with *Looks like Sienna* / *Not her* buttons. |
| **Mismatch** | anything else below 0.74 | Redone with a new seed, as today. After four, the closest is kept and flagged "Face didn't match". |

Facing-the-camera photos keep exactly today's rule.

## Data (all offline, CPU, same YuNet + SFace models as the GPU node)

| Set | Photos with a readable face | Notes |
|---|---|---|
| Sienna, generated | 1,586 | every completed Sienna Lock generation in the test archives, 55 of them from-behind requests |
| Sienna, training/anchors | 83 | approved dataset photos, many head angles |
| Our own generations that look like a **different woman** | 46 | hand-labelled from the 338 generated photos scoring below 0.74 (conservative: unsure = different) |
| Unrelated women | 270 | SFW sample photos from Civitai's public gallery (RealVisXL, Juggernaut, epiCRealism, CyberRealistic), gender-filtered |

## Findings

**Unrelated women** score at most 0.63:

| Similarity ≥ | 0.50 | 0.55 | 0.60 | 0.65 | 0.70 |
|---|---|---|---|---|---|
| Unrelated women | 11.1 % | 4.4 % | 1.1 % | 0 % | 0 % |

**SDXL's own drifted lookalikes** (brunette, same styling, different face) are the real risk. How often a generated
photo looks like a different woman, by score:

| Similarity | 0–0.50 | 0.50–0.60 | 0.60–0.65 | 0.65–0.70 | 0.70–0.74 | ≥ 0.74 |
|---|---|---|---|---|---|---|
| Different-looking | 80 % | 45 % | 37 % | 8 % | 6 % | 0 % (none found) |

So **0.50 was not safe**: about 1 in 9 unrelated women and most drifted lookalikes would have skipped their retry.

**Sienna turned away** scores 0.52–0.85 (from-behind requests, median 0.74), so no floor separates her cleanly
from lookalikes. The floor was chosen by replaying every recorded retry sequence (199 photos, 433 generations)
under each rule, weighting each delivered photo by the chance it's a different woman at its score
(an upper bound for turned faces, since that table comes mostly from facing-camera photos):

| From-behind rule | Generations per photo | Wrong-looking photos delivered (estimate) |
|---|---|---|
| Deployed (0.74 only) | 3.08 | 11.4 % |
| Floor 0.70 | 2.64 | 11.6 % |
| **Floor 0.68 (chosen)** | **2.50** | **11.6 %** |
| Floor 0.65 | 1.97 | 12.4 % |
| Floor 0.60 | 1.58 | 17.2 % |
| Floor 0.50 | 1.25 | 17.5 % |

The deployed rule is not risk-free either: when all four attempts fail it keeps the closest, which is where most
of its 11 % comes from. At 0.68 the new rule delivers no more wrong-looking faces than today while saving about
one generation in five on from-behind shots, and every unverified photo is now flagged in the gallery instead of
only in a warning line. Facing-camera photos are unchanged (replayed: identical attempts and picks).

**Hair and skin colour** (secondary signals; `sienna_face.appearance`):

| Flag rate | Sienna generated | Sienna training | Different (ours) | Unrelated women |
|---|---|---|---|---|
| Hair much lighter (hair/skin brightness > 1.0) | 0.3 % | 1.2 % | 4.3 % | 9.3 % |
| Skin hue outside 30–65° | 0 % | 0 % | 0 % | 19.3 % |

Hair brightness is measured relative to her skin in the same photo, so the light cancels out: Sienna stays at
0.14–0.65 in 99 % of photos from shade to golden hour. The 0.3 % of her photos that trip it have a bright sky or
white wall right behind her hair. These signals catch blondes and different skin tones, **not** dark-haired
lookalikes, so they are only used to stop an inconclusive photo from skipping its retry. They never verify a face
and never fail a verified one; a false flag costs one retry, never the photo.

Head-turn landmarks (yaw, eye ratio) do not separate kneeling/looking-back shots from facing-camera ones well
(kneeling faces measured yaw 0.12–0.27), so the request itself (pose text, preset, pack) is the main turned signal.

## Real-GPU A/B (prepared, not run)

`scripts/face_check_ab.py` compares the two rules on **identical photos**: for each case and base seed the GPU
makes the four photos a request could use (seeds s…s+3, app retries off); every photo is scored offline with the
same code, both rules are replayed on the same sequence, and the delivered photos are labelled by eye.

- 5 from-behind cases (kneeling beach/bed, sink selfie, looking back on a street, side profile) × 6 seeds × 4 = 120 photos
- 2 facing-camera controls × 3 seeds × 4 = 24 photos
- About 45 GPU minutes on an RTX 4090 ≈ **$0.70–0.90**; hard stop at $1.50.

Pass criteria for deploying:

1. Facing-camera cases: identical picks under both rules.
2. From-behind cases: the new rule delivers **no more** different-looking women than the current rule (by eye),
   and none that the current rule would have avoided.
3. Every delivered photo that isn't verified is flagged in the gallery.
4. Fewer generations on from-behind cases.

If (2) fails, raise the floor (0.70) or keep the deployed rule.

## Real-GPU A/B result (run 2026-10-11, RTX 4090)

204 photos (5 from-behind cases × 6 seeds × 6 attempts, 2 facing-camera cases × 3 seeds × 4 attempts), every
photo labelled **blind** (random codes, no score, case or policy shown) as Sienna / different woman / can't judge,
then both rules replayed on the same photos (first 4 attempts). GPU cost ≈ $0.64 (incl. one failed start).

- Blind labels: 171 Sienna, **2 different women** (scores 0.65 and 0.63, both kneel-on-bed), 31 can't judge
  (strict profile / face hidden).
- **Neither rule delivered a different woman** (0 of 36 each). Both rejected the two lookalikes. With 36 photos
  this rules out a high error rate but not a rare one (95 % upper bound ≈ 8 %).
- The earlier 11.4 % estimate was too pessimistic for today's pipeline: only 1 % of all photos in this run were
  a different woman. But the deployed rule still sent **16 of 30** from-behind photos to the gallery unverified
  (closest-of-4); the pose-aware rule 19 of 30 (inconclusive).

| | Current 0.74 | Pose-aware 0.68 |
|---|---|---|
| From-behind generations (30 photos) | 100 (3.33 / photo) | 73 (2.43 / photo) |
| GPU time per from-behind photo | ≈ 40 s | ≈ 29 s |
| Verified photos | 14 / 30 | 11 / 30 |
| Unverified (→ Needs Review) | 16 / 30 | 19 / 30 |
| Different woman delivered | 0 | 0 |
| Facing-camera (6 photos) | 6 verified, 6 generations | identical |

- Where the rules disagreed (5 of 30), both kept Sienna; in 2 of those the current rule found a *verified*
  photo by trying longer.
- 6 attempts instead of 4 (current rule): +31 % generations for 2 more verified photos — not worth it.
- **Hair/skin colour signal misfired** on 15 of 171 blind-confirmed Sienna photos (backlit beach, white sheets
  behind her hair), far above the offline 0.3 %. It changed no decision here, but it fails the "lighting must not
  fail legitimate photos" bar for from-behind shots, so it should not gate decisions.
- Only 21 % of from-behind attempts of the real Sienna reach 0.74; 58 % score below 0.68.

## Production decision (owner, 2026-10-12)

- **Strict 0.74 rule stays** for every photo: below 0.74 is redone, up to four photos.
- **If none verifies, the closest goes to Needs Review**, never the approved gallery.
- **Manual review:** "Looks like Sienna — approve" moves a photo into the gallery as the owner's approval; it stays
  labelled "face unverified" and its automated status never changes. "Not her" keeps it out.
- **Hair/skin colour** is measured by the node but used in no decision.
- **Pose-aware 0.68** is kept for future consideration, active only with `SIENNA_EXPERIMENTAL=true` (unset on Render).
- **No face to compare** (none found, or too small — often hidden or turned away on purpose): not retried, never a
  match, filed in Needs Review as "Face not verified — manual review required" (owner's follow-up decision).

### Face check unavailable (owner's follow-up, 2026-10-14)

"Verification could not run" is never a pass. Every finished photo records a face outcome; anything other than
**verified** goes to Needs Review as "Face not verified — manual review required", and the photo details tell
**Face not detected** apart from **Face check unavailable** (with the cause):

| Cause | Outcome |
|---|---|
| Face check node not installed on the GPU | unavailable → Needs Review |
| Face models fail to load / node reports an error | unavailable → Needs Review |
| Node returns no result | unavailable → Needs Review |
| Face check turned off with Sienna Lock on | unavailable → Needs Review |
| Edit Outfit result (no face check runs) | unavailable → Needs Review |
| Mock backend | unavailable → Needs Review (it used to report a fake 0.85 "verified") |
| A finished photo with no outcome recorded at all | treated as unavailable by the gallery (fail closed) |
| GPU job error or timeout | no photo is delivered (job fails, as before) |
| Sienna Lock off | not applicable — the photo isn't meant to be Sienna; gallery as before |

Nothing is deleted or rejected automatically; manual approval keeps the unverified status.
