#!/usr/bin/env bash
# Build the hero portrait frames from two Kling clips.
#   follow: head turns left -> up -> right (mapped to cursor X)
#   react:  turns to camera and smiles (played on click)
# Usage: tools/build-portrait.sh FOLLOW.mp4 REACT.mp4
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; out="$here/../public/portrait"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
python3 -I "$here/key-backdrop.py" "$1" "$tmp/follow.mp4"
python3 -I "$here/key-backdrop.py" "$2" "$tmp/react.mp4"
rm -rf "$out"; mkdir -p "$out/follow" "$out/react"
webp=(-c:v libwebp -quality 70 -compression_level 6)
# Every 2nd frame of the turn (the player blends neighbours), from frame 36 of the smile.
ffmpeg -v error -y -i "$tmp/follow.mp4" -vf "select='not(mod(n\,2))',scale=960:-2" -fps_mode vfr -start_number 0 "${webp[@]}" "$out/follow/%03d.webp"
ffmpeg -v error -y -i "$tmp/react.mp4" -vf "select='gte(n\,36)',scale=960:-2" -fps_mode vfr -start_number 0 "${webp[@]}" "$out/react/%03d.webp"
echo "follow: $(ls "$out/follow" | wc -l) frames, react: $(ls "$out/react" | wc -l) frames"
