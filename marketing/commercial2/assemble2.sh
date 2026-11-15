#!/usr/bin/env bash
# Assemble NEXT Ad #2 and every variant from the rendered scenes.
#   OPEN=dir/with/opening[,opening_b,opening_c] REST=dir/with/body,hero,opening_b,opening_c \
#   VO=vo_dir OUT=dir PY=python ./assemble2.sh
# Produces (1080x1920, 30 fps, H.264 High + AAC 48 kHz):
#   NEXT-ad2-A-found-them-first.mp4     main, 22 s (hook A: competition)
#   NEXT-ad2-B-trade-artists.mp4        hook B (trading curiosity), same body
#   NEXT-ad2-C-next-big-artist.mp4      hook C (discovery), same body
#   NEXT-ad2-A-captions.mp4             sound-off version with captions
#   NEXT-ad2-12s.mp4                    condensed: 0–4 + 8–10 + 14–16 + 18–22 s (bar-aligned)
#   NEXT-ad2-cover.png                  cover / thumbnail
set -euo pipefail
cd "$(dirname "$0")"
PY=${PY:-post-venv/bin/python}
mkdir -p "$OUT"
post() {   # $1 frames dir  $2 range  $3 offset  $4 out dir  $5.. extra
  local src=$1 rng=$2 off=$3 dst=$4; shift 4
  "$PY" post2.py "$src" "$dst" --frames "$rng" --offset "$off" "$@" > /dev/null
}
# main (A): opening 1–120, body 121–420, hero 421–660 (4 workers)
for args in "$OPEN/opening 1-60 0" "$OPEN/opening 61-120 0" "$REST/body 1-150 120" "$REST/body 151-300 120" "$REST/hero 1-120 420" "$REST/hero 121-240 420"; do
  set -- $args; post "$1" "$2" "$3" "$OUT/frames_a" &
  while [ "$(jobs -r | wc -l)" -ge 4 ]; do sleep 1; done
done; wait
# captions version (A + captions)
for args in "$OPEN/opening 1-120 0" "$REST/body 1-150 120" "$REST/body 151-300 120" "$REST/hero 1-240 420"; do
  set -- $args; post "$1" "$2" "$3" "$OUT/frames_cap" --captions &
done; wait
# hooks B and C: frames 1–64 re-rendered (studio shows the trade screen / Juno's card); the rest is A
for h in b c; do
  rm -rf "$OUT/frames_$h"; cp -r "$OUT/frames_a" "$OUT/frames_$h"
  post "$REST/opening_$h" 1-64 0 "$OUT/frames_$h" --hook "$h"
done
for d in frames_a frames_b frames_c frames_cap; do n=$(ls "$OUT/$d" | wc -l); [ "$n" -eq 660 ] || { echo "$d has $n frames"; exit 1; }; done
# sound: one score; a mix per hook (the hook line changes); the condensed edit
"$PY" music2.py "$OUT/music.wav" 22.0
for h in a b c; do "$PY" mix2.py "$OUT/sound_$h.wav" 22.0 --music "$OUT/music.wav" --vo "$VO" --hook "$h"; done
"$PY" mix2.py "$OUT/sound_12s.wav" 22.0 --music "$OUT/music.wav" --vo "$VO" --hook a --edit "0-4,8-10,14-16,18-22"
ENC="-c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -profile:v high -level 4.2 -x264-params aq-mode=3 -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a aac -b:a 256k -ar 48000 -movflags +faststart"
enc() { ffmpeg -hide_banner -loglevel error -y -framerate 30 -i "$OUT/$1/p%04d.png" -i "$OUT/$2" $ENC -shortest "$OUT/$3"; }
enc frames_a sound_a.wav NEXT-ad2-A-found-them-first.mp4
enc frames_b sound_b.wav NEXT-ad2-B-trade-artists.mp4
enc frames_c sound_c.wav NEXT-ad2-C-next-big-artist.mp4
enc frames_cap sound_a.wav NEXT-ad2-A-captions.mp4
ffmpeg -hide_banner -loglevel error -y -i "$OUT/NEXT-ad2-A-found-them-first.mp4" -i "$OUT/sound_12s.wav" -filter_complex \
  "[0:v]trim=start_frame=0:end_frame=120,setpts=PTS-STARTPTS[v1];[0:v]trim=start_frame=240:end_frame=300,setpts=PTS-STARTPTS[v2];\
   [0:v]trim=start_frame=420:end_frame=480,setpts=PTS-STARTPTS[v3];[0:v]trim=start_frame=540:end_frame=660,setpts=PTS-STARTPTS[v4];\
   [v1][v2][v3][v4]concat=n=4:v=1:a=0[v]" -map "[v]" -map 1:a $ENC -shortest "$OUT/NEXT-ad2-12s.mp4"
"$PY" post2.py "$REST/hero" "$OUT" --thumb 118 --offset 420
for f in "$OUT"/NEXT-ad2-*.mp4; do echo "$(basename "$f") $(ffprobe -v error -count_frames -select_streams v -show_entries stream=width,height,nb_read_frames:format=duration -of csv=p=0 "$f" | tr '\n' ' ')"; done
