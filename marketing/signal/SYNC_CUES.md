# THE SIGNAL: first three seconds, picture/sound cue sheet

30 fps; frame 1 = 0.000 s. The camera times and speech times were measured, not estimated.

- **Camera:** the waveform crossing comes from the camera's keyed position, read from the scene.
- **Speech:** the onsets and ends come from the narration WAVs, using an energy threshold.
- **Whoosh:** its peak was measured with A-weighting.

The music sits on a 112.5 BPM grid. One beat is 16 frames, and the beats fall on frames 8, 24, 40, 56, 72, 88.

## Hook A (hero)

| Frame | Time | Picture | Sound | Text on screen |
|---|---|---|---|---|
| 1 | 0.00 | Mid-flight through the 3D candlestick chart | Bass impact, crack, metallic hit, braam | THIS ISN'T A STOCK. (hard in) |
| 4 | 0.11 | — | Two-blip synth pulse | — |
| 7.6–34.5 | 0.22–1.12 | Chart streams past | VO: "This isn't a stock." 8th-note sub pulse on the grid | Title holds until 34, out by 38 |
| 18–34 | 0.6–1.1 | Candles, price grid and last-price line dissolve; lines begin to morph | Glitter + paired whooshes at 20 / 22 | — |
| 22–40 | 0.7–1.3 | The lines pull into the waveform | Reverse swell, sucking into the lock | — |
| **40** | **1.30** | **The waveform locks** | **Boom + metal hit + pad, on beat** | IT'S AN ARTIST. (hard in) |
| 42.2–69.9 | 1.38–2.30 | The waveform opens (47–58) | VO: "It's an artist." (2 frames after the boom, so the impact doesn't mask the first consonant) | Title holds, fades 68–72 |
| 48–64 | 1.57–2.10 | SCOUT (cyan) and NEXT (orange) light up | Dual chime at 55 (the middle of the light ramp): cyan left, orange right | — |
| **61.5** | **2.02** | **The camera passes through the waveform plane** | **Whoosh peak** | — |
| 58.5–72 | 1.92–2.37 | The products approach | Riser | — |
| **72** | **2.37** | Monitor and phone near full size | **Drive downbeat: kick, 16th bass, hats, arp** | SCOUT × NEXT (snaps in, 3 frames) |
| 90 | 2.97 | Products dominant, screens readable | Drive | Lockup holds, out by 100 |
| 103 | 3.40 | — | VO: "SCOUT discovers…" | SCOUT mark (from 102) |

## Hook B

- **Narration:** "The next big artist is still unknown." Speech runs from frame 8 to 64.
- **Titles:** both lines hold to frame 66.
- **Lockup:** SCOUT × NEXT snaps in at 72, on the same drive downbeat.

## Hook C

The narration is split at its sentence gap (`vo5.py`, `SPLIT`), so each sentence lands on its own beat.

- **"One system finds them."** Speech runs from frame 5 to 43. Its title runs from 1 to 43.
- **"Another lets you back them."** Placed at 1.41 s, so the speech starts at frame 44. That is two frames after the frame-42 boom and chime that splits the two worlds. The speech runs to frame 81. Its title runs from 44 to 80.
- **Lockup:** starts at frame 81.

## Mix rules held throughout

- The music ducks under each narration line: −0.55 gain, with the speech band carved out.
- Effects keep their impacts but are carved under the narration.
- Measured speech-band margin (300–3400 Hz) during the hooks, narration over music and effects: A "stock" +11.7 dB, "artist" +12.8 dB; B +12.5 dB; C +11.0 / +12.8 dB.
