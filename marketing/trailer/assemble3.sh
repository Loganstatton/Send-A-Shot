#!/usr/bin/env bash
# Assemble the NEXT reveal trailer from the rendered scenes.
#   V=dir/with/{opening3,reveal3,finale3}  WD=dir/with/{opening3_wide,reveal3_wide,finale3_wide}  OUT=dir  PY=python ./assemble3.sh
# Produces (30 fps, H.264 High + AAC 48 kHz):
#   NEXT-trailer-vertical.mp4        1080x1920, 40 s (main)
#   NEXT-trailer-16x9.mp4            1920x1080, 40 s
#   NEXT-trailer-teaser-15s.mp4      1080x1920, 15 s  (2–5.5 + 8.7–10.7 + 13–17 + 34–39.5 s)
#   NEXT-trailer-teaser-15s-16x9.mp4 1920x1080, 15 s
#   NEXT-trailer-soundtrack.wav      the score with its synchronized SFX (48 kHz)
#   NEXT-trailer-cover.png / -16x9   cover images
set -euo pipefail
cd "$(dirname "$0")"
PY=${PY:-post-venv/bin/python}
mkdir -p "$OUT"
post() {   # $1 frames dir  $2 range  $3 offset  $4 out dir  $5.. extra
  local src=$1 rng=$2 off=$3 dst=$4; shift 4
  "$PY" post3.py "$src" "$dst" --frames "$rng" --offset "$off" "$@" > /dev/null
}
for fmt in v w; do
  if [ $fmt = v ]; then D=$V; sfx=""; extra=""; else D=$WD; sfx="_wide"; extra="--wide"; fi
  [ "$(ls "$OUT/frames_$fmt" 2>/dev/null | wc -l)" -eq 1200 ] && continue      # already posted
  for args in "opening3 1-130 0" "opening3 131-260 0" "opening3 261-390 0" "reveal3 1-180 390" "reveal3 181-360 390" \
              "finale3 1-150 750" "finale3 151-300 750" "finale3 301-450 750"; do
    set -- $args; post "$D/$1$sfx" "$2" "$3" "$OUT/frames_$fmt" $extra &
    while [ "$(jobs -r | wc -l)" -ge 4 ]; do sleep 1; done
  done; wait
  n=$(ls "$OUT/frames_$fmt" | wc -l); [ "$n" -eq 1200 ] || { echo "frames_$fmt has $n frames"; exit 1; }
done
"$PY" music3.py "$OUT/music.wav" 40.0
ffmpeg -hide_banner -loglevel error -y -i "$OUT/music.wav" -ar 48000 "$OUT/NEXT-trailer-soundtrack.wav"
ENC="-c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -profile:v high -level 4.2 -x264-params aq-mode=3 -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a aac -b:a 256k -ar 48000 -movflags +faststart"
ffmpeg -hide_banner -loglevel error -y -framerate 30 -i "$OUT/frames_v/p%04d.png" -i "$OUT/music.wav" $ENC -shortest "$OUT/NEXT-trailer-vertical.mp4"
ffmpeg -hide_banner -loglevel error -y -framerate 30 -i "$OUT/frames_w/p%04d.png" -i "$OUT/music.wav" $ENC -shortest "$OUT/NEXT-trailer-16x9.mp4"
# teaser: four moments, cut on the score's own phrases (short audio crossfades, picture cuts on the frame)
SEG="2.0-5.5 8.7-10.7 13.0-17.0 34.0-39.5"
"$PY" - "$OUT/music.wav" "$OUT/teaser.wav" $SEG <<'PYEOF'
import sys, numpy as np
from scipy.io import wavfile
sr, x = wavfile.read(sys.argv[1]); x = x.astype(np.float32)
xf = int(0.05 * sr); out = None
for seg in sys.argv[3:]:
    a, b = (float(v) for v in seg.split('-')); s = x[int(a * sr) - xf // 2:int(b * sr) + xf // 2].copy()
    ramp = np.linspace(0, 1, xf)[:, None]
    if out is None: out = s
    else:
        out[-xf:] = out[-xf:] * (1 - ramp) + s[:xf] * ramp; out = np.concatenate([out, s[xf:]])
fade = int(0.6 * sr); out[-fade:] *= np.linspace(1, 0, fade)[:, None]
wavfile.write(sys.argv[2], sr, out.astype(np.int16))
PYEOF
for fmt in v w; do
  name=NEXT-trailer-teaser-15s$([ $fmt = w ] && echo -16x9 || true).mp4
  ffmpeg -hide_banner -loglevel error -y -framerate 30 -i "$OUT/frames_$fmt/p%04d.png" -i "$OUT/teaser.wav" -filter_complex \
    "[0:v]trim=start_frame=60:end_frame=165,setpts=PTS-STARTPTS[a];[0:v]trim=start_frame=261:end_frame=321,setpts=PTS-STARTPTS[b];\
     [0:v]trim=start_frame=390:end_frame=510,setpts=PTS-STARTPTS[c];[0:v]trim=start_frame=1020:end_frame=1185,setpts=PTS-STARTPTS,fade=t=out:st=5.0:d=0.5[d];\
     [a][b][c][d]concat=n=4:v=1:a=0[v]" -map "[v]" -map 1:a $ENC -shortest "$OUT/$name"
done
"$PY" post3.py "$V/reveal3" "$OUT" --cover 310 --offset 390
"$PY" post3.py "$WD/reveal3_wide" "$OUT" --cover 310 --offset 390 --wide
for f in "$OUT"/NEXT-trailer-*.mp4; do echo "$(basename "$f") $(ffprobe -v error -count_frames -select_streams v -show_entries stream=width,height,nb_read_frames:format=duration -of csv=p=0 "$f" | tr '\n' ' ')"; done
