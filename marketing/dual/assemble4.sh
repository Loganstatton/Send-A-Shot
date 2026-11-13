#!/usr/bin/env bash
# Assemble SCOUT × NEXT — "BEFORE THE BREAKOUT" from the rendered scenes.
#   V=dir/with/{scout,transition,next4,finale4}  WD=dir/with/{scout_wide,transition_wide,next4_wide,finale4_wide}
#   OUT=dir  PY=python ./assemble4.sh
# Produces (30 fps, H.264 High + AAC 48 kHz):
#   SCOUT-NEXT-before-the-breakout-vertical.mp4   1080x1920, 40 s (main)
#   SCOUT-NEXT-before-the-breakout-16x9.mp4       1920x1080, 40 s
#   SCOUT-NEXT-15s.mp4 / SCOUT-NEXT-15s-16x9.mp4  the 15 s cut: hook · approve · the connection · trade · the card · the reveal
#   SCOUT-NEXT-soundtrack.wav                     the score with its synchronized sound design (48 kHz)
#   SCOUT-NEXT-thumb-*.png                        thumbnails (vertical + 16:9)
set -euo pipefail
cd "$(dirname "$0")"
PY=${PY:-post-venv/bin/python}
mkdir -p "$OUT"
post() {   # $1 frames dir  $2 range  $3 offset  $4 out dir  $5.. extra
  local src=$1 rng=$2 off=$3 dst=$4; shift 4
  "$PY" post4.py "$src" "$dst" --frames "$rng" --offset "$off" "$@" > /dev/null
}
for fmt in v w; do
  if [ $fmt = v ]; then D=$V; sfx=""; extra=""; else D=$WD; sfx="_wide"; extra="--wide"; fi
  [ "$(ls "$OUT/frames_$fmt" 2>/dev/null | wc -l)" -eq 1200 ] && continue      # already posted
  for args in "scout 1-150 0" "scout 151-300 0" "transition 1-120 300" "transition 121-240 300" "next4 1-150 540" "next4 151-300 540" \
              "finale4 1-120 840" "finale4 121-240 840" "finale4 241-360 840"; do
    set -- $args; post "$D/$1$sfx" "$2" "$3" "$OUT/frames_$fmt" $extra &
    while [ "$(jobs -r | wc -l)" -ge 4 ]; do sleep 1; done
  done; wait
  n=$(ls "$OUT/frames_$fmt" | wc -l); [ "$n" -eq 1200 ] || { echo "frames_$fmt has $n frames"; exit 1; }
done
"$PY" music4.py "$OUT/music.wav" 40.0
cp "$OUT/music.wav" "$OUT/SCOUT-NEXT-soundtrack.wav"
ENC="-c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -profile:v high -level 4.2 -x264-params aq-mode=3 -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a aac -b:a 256k -ar 48000 -movflags +faststart"
ffmpeg -hide_banner -loglevel error -y -framerate 30 -i "$OUT/frames_v/p%04d.png" -i "$OUT/music.wav" $ENC -shortest "$OUT/SCOUT-NEXT-before-the-breakout-vertical.mp4"
ffmpeg -hide_banner -loglevel error -y -framerate 30 -i "$OUT/frames_w/p%04d.png" -i "$OUT/music.wav" $ENC -shortest "$OUT/SCOUT-NEXT-before-the-breakout-16x9.mp4"
# the 15 s cut (seconds): picture and sound cut together, 50 ms audio crossfades
SEG="0.4-2.4 6.3-7.3 11.3-17.0 21.6-23.0 29.0-30.4 36.5-40.0"
"$PY" - "$OUT/music.wav" "$OUT/cut15.wav" $SEG <<'PYEOF'
import sys, numpy as np
from scipy.io import wavfile
sr, x = wavfile.read(sys.argv[1]); x = x.astype(np.float32)
xf = int(0.05 * sr); out = None
for seg in sys.argv[3:]:
    a, b = (float(v) for v in seg.split('-')); s = x[max(0, int(a * sr) - xf // 2):int(b * sr) + xf // 2].copy()
    r = np.linspace(0, 1, xf)[:, None]
    if out is None: out = s
    else: out[-xf:] = out[-xf:] * (1 - r) + s[:xf] * r; out = np.concatenate([out, s[xf:]])
wavfile.write(sys.argv[2], sr, out.astype(np.int16))
PYEOF
FILTER=""; i=0; LBL=""
for seg in $SEG; do a=${seg%-*}; b=${seg#*-}
  fa=$(python3 -c "print(round($a*30))"); fb=$(python3 -c "print(round($b*30))")
  FILTER+="[0:v]trim=start_frame=$fa:end_frame=$fb,setpts=PTS-STARTPTS[s$i];"; LBL+="[s$i]"; i=$((i+1))
done
FILTER+="${LBL}concat=n=$i:v=1:a=0[v]"
for fmt in v w; do
  name=SCOUT-NEXT-15s$([ $fmt = w ] && echo -16x9 || true).mp4
  ffmpeg -hide_banner -loglevel error -y -framerate 30 -i "$OUT/frames_$fmt/p%04d.png" -i "$OUT/cut15.wav" -filter_complex "$FILTER" -map "[v]" -map 1:a $ENC -shortest "$OUT/$name"
done
"$PY" make_thumbs4.py "$OUT"
for f in "$OUT"/SCOUT-NEXT-*.mp4; do echo "$(basename "$f") $(ffprobe -v error -count_frames -select_streams v -show_entries stream=width,height,nb_read_frames:format=duration -of csv=p=0 "$f" | tr '\n' ' ')"; done
