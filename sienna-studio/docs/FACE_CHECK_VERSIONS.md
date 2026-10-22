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
