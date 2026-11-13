#!/usr/bin/env bash
# Assemble the v2 NEXT commercial (24.0 s) from rendered scenes.
#   OPENER=dir REST=dir/with/v2_buy,v2_market,v2_hero ASSETS=dir OUT=dir [PY=python] ./assemble_v2.sh
# Produces (1080x1920, 30 fps, H.264 + AAC):
#   NEXT-ad-v2-24s.mp4   the main ad
#   NEXT-ad-v2-hook.mp4  9.6 s hook cut: opener → straight into THE HIT (the card) → logo + call to action
# Every splice in the hook cut sits on the same beat of the bar (100 BPM, 4/4), with 15 ms audio fades.
set -euo pipefail
cd "$(dirname "$0")"
PY=${PY:-post-venv/bin/python}
OUT=${OUT:-out}
mkdir -p "$OUT/frames"
{
  echo "$OPENER 1-90 0"
  echo "$REST/v2_buy 1-81 90";     echo "$REST/v2_buy 82-162 90"
  echo "$REST/v2_market 1-81 252"; echo "$REST/v2_market 82-162 252"
  echo "$REST/v2_hero 1-77 414";   echo "$REST/v2_hero 78-154 414"
  echo "$REST/v2_hero 155-230 414"; echo "$REST/v2_hero 231-306 414"
} | xargs -P 4 -L 1 sh -c "$PY post.py \$0 '$OUT/frames' --assets '$ASSETS' --frames \$1 --offset \$2 > /dev/null"
n=$(ls "$OUT/frames" | wc -l); [ "$n" -ge 720 ] || { echo "only $n frames"; exit 1; }
$PY music.py "$OUT/music.wav" 24.0
$PY audio.py "$OUT/soundtrack.wav" 24.0 --music "$OUT/music.wav"
ENC="-c:v libx264 -preset slow -crf 15 -pix_fmt yuv420p -profile:v high -level 4.2 -x264-params aq-mode=3 -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a aac -b:a 320k -ar 48000 -movflags +faststart"
ffmpeg -hide_banner -loglevel error -y -framerate 30 -i "$OUT/frames/p%04d.png" -i "$OUT/soundtrack.wav" $ENC -shortest "$OUT/NEXT-ad-v2-24s.mp4"
# Hook: frames 1–90 (0–3.0 s), 451–504 (15.0–16.8 s), 577–720 (19.2–24.0 s).
ffmpeg -hide_banner -loglevel error -y -i "$OUT/NEXT-ad-v2-24s.mp4" -filter_complex \
  "[0:v]trim=start_frame=0:end_frame=90,setpts=PTS-STARTPTS[v1];[0:v]trim=start_frame=450:end_frame=504,setpts=PTS-STARTPTS[v2];[0:v]trim=start_frame=576:end_frame=720,setpts=PTS-STARTPTS[v3];[v1][v2][v3]concat=n=3:v=1:a=0[v];\
   [0:a]atrim=0:3,asetpts=PTS-STARTPTS,afade=t=out:st=2.985:d=0.015[a1];\
   [0:a]atrim=15:16.8,asetpts=PTS-STARTPTS,afade=t=in:d=0.015,afade=t=out:st=1.785:d=0.015[a2];\
   [0:a]atrim=19.2:24,asetpts=PTS-STARTPTS,afade=t=in:d=0.015[a3];[a1][a2][a3]concat=n=3:v=0:a=1[a]" \
  -map "[v]" -map "[a]" $ENC "$OUT/NEXT-ad-v2-hook.mp4"
for f in "$OUT"/NEXT-ad-v2-*.mp4; do ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of compact "$f"; done
