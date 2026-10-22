# Face check: what runs on each GPU drive (22 Oct 2026)

The photo GPU loads `custom_nodes/sienna_nodes` straight from the network drive it starts on. The app tries the main
US drive first and the EU backup when no US GPU is free, so **the face check a photo gets depends on which region had
a free GPU**. The two drives currently carry different versions. Read from both drives on 22 Oct (read-only, md5 of
every file) and matched against git.

## Summary

| | Main drive — US-IL-1 (`u4odco714x`) | Backup drive — EU-RO-1 (`gu7oy3ormz`) |
|---|---|---|
| Node package | git `2fc5602` (11 Oct, the deployed production face check) | git `98cb748` (17 Oct) = current repo |
| `sienna_face.py` | 11 Oct version **+ face-selection fix only** (22 Oct live patch, md5 `00c27ee8`) | repo version incl. face-selection fix (md5 `fba6c81b`) |
| Previous `sienna_face.py` | kept as `sienna_face.py.bak-20261022` (md5 `ba508d9b` = `2fc5602`) | kept as `sienna_face.py.bak-20261022` (md5 `b93628bc` = `7dd9df0`) |
| `__init__.py` | md5 `bd941e97` (11 Oct) | md5 `8f06f7c7` (17 Oct) |
| `sienna_frame.py`, `sienna_stabilize.py` | not present | present (video safe framing, Lock Camera) |
| All other node files | identical on both drives | identical on both drives |

## What differs in behaviour

**Face report fields.** Both drives now pick her face the same way (clear face first, never a region directly under
her head, `clear` flag in the report). On top of that, the EU drive also reports:

- `yaw`, `eye_ratio`, `mouth_ratio`, `detector_score` — head turn and landmark layout. The production (strict) rule
  doesn't use them; only the experimental pose-aware rule (`SIENNA_EXPERIMENTAL=true`) does.
- `hair_rel`, `skin_hue`, `skin_l`, `mono` — hair and skin colour signals. **The production rule does use `hair_rel`**
  (`lib/identity.ts` `faceVerdict`): a face scoring 0.70–0.74 ("likely Sienna") with `hair_rel > 1.0` (hair much
  lighter than hers) becomes a mismatch and is redone.

**Consequence.** For a photo whose face scores 0.70–0.74 and whose hair reads much lighter than hers (mostly
backlit or blonde-drift photos):

- on the US drive it is accepted as "likely" (no `hair_rel` in the report),
- on the EU drive it is redone (an extra GPU attempt).

Every other verdict is the same on both drives. The calibration in `docs/FACE_CHECK_CALIBRATION.md` found that the hair
signal misflags about 15 of 171 confirmed Sienna photos under backlight — which is why it was kept dev-only on the
main drive.

**Video nodes.** `SiennaSafeFrame` and the Lock Camera stabiliser exist only on the EU drive. The video GPU installs
`sienna_nodes` from the app's own kit at start-up, so this does not affect video; it only matters if a photo-GPU
session were used for video work.

## Options (not done — needs a decision)

1. **Make EU match US** (recommended if production behaviour must be identical everywhere): install the US live file
   (`sienna_face.py` md5 `00c27ee8`) on the EU drive. One cheap CPU session; the EU backup file stays as a `.bak`.
   The video nodes on EU can stay (unused by photos).
2. **Promote the newer face check to US**: install the repo version on the US drive. This turns the hair-colour rule on
   for every photo — a behaviour change that should get its own test first.
3. Leave as is and accept the small difference for photos that land on the backup drive.

The face-selection fix itself is identical on both drives and covered by `scripts/comfy_nodes/tests` (52 tests) and
the 1,350-photo offline validation.

## Offline comparison of the two versions (22 Oct, no GPU)

Both node versions were run on the same saved photos (the archive set uses its saved measurements; its images are
gone), and the app's production rule was replayed on each report: verified ≥ 0.74, "likely" 0.70–0.74 accepted,
below 0.70 redone. The EU report adds the hair rule: a "likely" face with `hair_rel > 1.0` is redone.

| Set (label) | Photos | Accepted US / EU | Redone US / EU |
|---|---|---|---|
| Generated Sienna, 11 Oct archive | 1,538 | 1,421 / 1,421 | 117 / 117 |
| Generated, hand-labelled different woman | 46 | 11 / 11 | 35 / 35 |
| Training and approved photos (many angles) | 134 | 89 / 89 | 39 / 39 |
| Live photos 21 Oct, blind-labelled Sienna | 55 | 51 / 51 | 4 / 4 |
| Live photos 21 Oct, blind-labelled not her | 3 | 3 / 3 | 0 / 0 |
| Today's benchmark photos (all Sienna) | 34 | 33 / 33 | 1 / 1 |
| Unrelated women | 263 | 0 / 0 | 246 / 246 |

- **The two versions made the same decision on all 2,078 photos.** The face picked and its score are identical
  (same selection code); the hair rule never fired inside the 0.70–0.74 band.
- **The hair rule catches the wrong kind of face.** Every different-looking face that reached 0.70+ (14) had dark
  hair (`hair_rel` 0.28–0.85), so the rule can't stop them. The faces it does flag (8.7 % of other women) already
  score far below 0.70. The 6 Sienna photos it flags (0.3 %) score 0.69–0.75 — right next to the band — and in the
  11 Oct GPU A/B it misfired on 15 of 171 backlit Sienna photos. On this evidence it can only add unnecessary redos.
- **Head turn** (`yaw`) doesn't separate Sienna from lookalikes (3 % "turned" in both groups at 0.60–0.74). Strongly
  turned training photos (yaw > 0.35, 7) fail on both versions alike; only the experimental pose-aware rule uses yaw.
- **Shared weakness:** both versions accept dark-haired lookalikes scoring 0.70–0.75 ("likely" band: 12 different of
  230). Neither version fixes this; it needs its own change.

**Recommendation:** standardise both drives on the newer node code (it records head turn and hair/skin colour for
diagnostics and any future pose-aware rule), and drop the hair rule from the "likely" decision in the app so that
decisions are identical on both drives and don't depend on lighting. Not applied — waiting for approval.

## Known failure: dark-haired lookalikes in the 0.70–0.76 band (documented 22 Oct, not changed)

Labelled photos scoring 0.70–0.76 against her reference: **350 Sienna, 14 a different woman** (12 generated photos
hand-labelled in the 11 Oct archive, 2 of the 3 blind-labelled "not her" live photos of 21 Oct). Their scores:
0.715, 0.715, 0.717, 0.717, 0.724, 0.725, 0.726, 0.726, 0.727, 0.728, 0.731, 0.739, 0.748, 0.748. All have dark
hair, so no colour signal can catch them; 12 of them land in the "likely" band and are accepted, the two at 0.748 are
verified. In this band the current single averaged reference separates her from them only weakly (AUC 0.71).

**Recommended separate improvement (offline first, using these labelled photos):** a second opinion only for faces in
the 0.70–0.76 band, never for clear matches or clear misses, so retries elsewhere don't change. Candidates:

1. **Compare with her nearest approved photos** (mean of the 3 closest of the 134 training/approved photos) instead of
   one averaged reference. Measured now: AUC in the band 0.71 → 0.81. Trade-off at a few cut-offs: 1 of 14 lookalikes
   caught for 5 % of her band photos redone; 3 of 14 for 10 %; 8 of 14 for 20 %. Cheap (same model, no download).
2. **A stronger face-recognition model as the second opinion** (e.g. the ArcFace model already on disk in
   `insight_models/buffalo_l`; check its licence for commercial use first). Not measured yet; expected to separate
   lookalikes much better than SFace, which is a small model.

Pass bar for either: catch at least half the 14 lookalikes while redoing no more than 5 % of her band photos (about
1 % of all photos), checked on the 63 blind-labelled live photos as well. If neither reaches it, keep the current rule
and keep sending "likely" photos with any doubt to Needs Review instead of retrying.
