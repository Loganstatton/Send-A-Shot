#!/usr/bin/env bash
# Post-process rendered frames and encode the opener MP4 (1080x1920, 30 fps).
set -euo pipefail
cd "$(dirname "$0")"
PY=${PY:-post-venv/bin/python}
$PY post.py frames post_frames --frames 1-90
$PY audio.py opener_sfx.wav 3.0
ffmpeg -hide_banner -loglevel error -y -framerate 30 -i post_frames/p%04d.png -i opener_sfx.wav \
  -c:v libx264 -preset slow -crf 14 -pix_fmt yuv420p -profile:v high -level 4.2 \
  -x264-params "aq-mode=3:deblock=-1,-1" -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a aac -b:a 320k -ar 48000 -shortest -movflags +faststart NEXT-opener-test.mp4
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,duration -of compact NEXT-opener-test.mp4
