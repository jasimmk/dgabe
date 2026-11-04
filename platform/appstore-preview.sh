#!/bin/bash
# Mac App Store app preview capture: real frames from the release build
# (--record: fixed 60 Hz steps, every second frame kept = 30 fps) with scripted
# demo input (--autoplay). Frames are converted to PNG with sips and packed as
# OUT_DIR/preview-frames.tar for encoding (1920x1080 H.264 + silent AAC).
#   bash platform/appstore-preview.sh [OUT_DIR]
set -euo pipefail
gabe_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$gabe_root"
gabe_out="${1:-evidence/appstore/preview}"
mkdir -p "$gabe_out"
gabe_tmp="$(mktemp -d -t gabe-preview)"
trap 'rm -rf "$gabe_tmp"' EXIT
cargo build --locked --release
gabe_bin="$gabe_root/target/release/dangerous-gabe"
gabe_clip() { # NAME FRAMES ARGS...
    local name="$1" frames="$2"; shift 2
    mkdir -p "$gabe_tmp/bmp/$name" "$gabe_tmp/png/$name"
    "$gabe_bin" --window 960x540 --frames "$frames" --record "$gabe_tmp/bmp/$name" "$@" > /dev/null
    sips -s format png "$gabe_tmp/bmp/$name"/*.bmp --out "$gabe_tmp/png/$name" > /dev/null
    rm -rf "$gabe_tmp/bmp/$name"
    echo "$name $(ls "$gabe_tmp/png/$name" | wc -l) frames"
}
gabe_clip 1-title 180 --scene title
gabe_clip 2-s01 360 --scene play --level 0 --autoplay
gabe_clip 3-s03 360 --scene play --level 2 --autoplay
gabe_clip 4-s07 360 --scene play --level 6 --autoplay
gabe_clip 5-s11 330 --scene play --level 10 --autoplay
tar -cf "$gabe_out/preview-frames.tar" -C "$gabe_tmp/png" .
ls -la "$gabe_out/preview-frames.tar"
echo PREVIEW_OK
