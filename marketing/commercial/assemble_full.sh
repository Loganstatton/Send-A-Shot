#!/usr/bin/env bash
# Assemble the full NEXT commercial from rendered scenes.
#   OPENER=dir/of/opener/frames REST=dir/with/scene2,scene3,scene4 OUT=dir ./assemble_full.sh
# Produces (1080x1920, 30 fps, H.264 + AAC):
#   NEXT-commercial-22s.mp4   the main 22.2 s ad
#   NEXT-commercial-9s.mp4    hook cut: opener + logo/call to action
set -euo pipefail
cd "$(dirname "$0")"
PY=${PY:-post-venv/bin/python}
OUT=${OUT:-out}
mkdir -p "$OUT/frames"
# Grade + type every scene into one global frame sequence (4 workers).
{
  echo "$OPENER 1-90 0"
  echo "$REST/scene2 1-90 90";  echo "$REST/scene2 91-180 90"
  echo "$REST/scene3 1-108 270"; echo "$REST/scene3 109-216 270"
  echo "$REST/scene4 1-90 486";  echo "$REST/scene4 91-180 486"
} | xargs -P 4 -L 1 sh -c "$PY post.py \$0 '$OUT/frames' --frames \$1 --offset \$2 > /dev/null"
$PY music.py "$OUT/music.wav" 22.2
$PY audio.py "$OUT/soundtrack.wav" 22.2 --music "$OUT/music.wav"
ENC="-c:v libx264 -preset slow -crf 15 -pix_fmt yuv420p -profile:v high -level 4.2 -x264-params aq-mode=3 -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a aac -b:a 320k -ar 48000 -movflags +faststart"
ffmpeg -hide_banner -loglevel error -y -framerate 30 -i "$OUT/frames/p%04d.png" -i "$OUT/soundtrack.wav" $ENC -shortest "$OUT/NEXT-commercial-22s.mp4"
# Hook cut: frames 1–90 (opener) + 487–666 (logo + call to action); audio 0–3 s + 16.2–22.2 s.
ffmpeg -hide_banner -loglevel error -y -i "$OUT/NEXT-commercial-22s.mp4" -filter_complex \
  "[0:v]trim=start_frame=0:end_frame=90,setpts=PTS-STARTPTS[v1];[0:v]trim=start_frame=486:end_frame=666,setpts=PTS-STARTPTS[v2];[v1][v2]concat=n=2:v=1:a=0[v];\
   [0:a]atrim=0:3,asetpts=PTS-STARTPTS,afade=t=out:st=2.985:d=0.015[a1];[0:a]atrim=16.2:22.2,asetpts=PTS-STARTPTS,afade=t=in:d=0.015[a2];[a1][a2]concat=n=2:v=0:a=1[a]" \
  -map "[v]" -map "[a]" $ENC "$OUT/NEXT-commercial-9s.mp4"
for f in "$OUT"/NEXT-commercial-*.mp4; do ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of compact "$f"; done
