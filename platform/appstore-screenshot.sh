#!/bin/bash
# App Store screenshot capture with opaque output (App Store Connect rejects
# images with an alpha channel). Uses only macOS tools: simctl and sips.
#
#   mac  OUT.png WIDTHxHEIGHT [game args...]
#        Exports a real frame from the host release build (--screenshot) at
#        half the target size in points (Retina 2x), then pads it to the exact
#        size with the HUD navy, as the game's own letterbox does.
#   sim  UDID OUT.png ROTATION WIDTHxHEIGHT [game args...]
#        Launches the installed simulator build, captures the screen and
#        rotates the portrait framebuffer (ROTATION in degrees, e.g. 90 for
#        an iPad turned right, 270 for an iPhone in landscape).
#
# Every image is flattened through a maximum-quality JPEG round trip and
# checked for: no alpha channel and the exact requested pixel size.
set -euo pipefail
gabe_root="$(cd "$(dirname "$0")/.." && pwd)"
gabe_tmp="$(mktemp -d -t gabe-shot)"
trap 'rm -rf "$gabe_tmp"' EXIT

gabe_finish() { # SOURCE OUT WIDTH HEIGHT
    sips -s format jpeg -s formatOptions best "$1" --out "$gabe_tmp/flat.jpg" > /dev/null
    sips -s format png "$gabe_tmp/flat.jpg" --out "$2" > /dev/null
    local info
    info="$(sips -g hasAlpha -g pixelWidth -g pixelHeight "$2" | awk 'NR > 1 { print $2 }' | paste -sd' ' -)"
    if [ "$info" != "no $3 $4" ]; then
        echo "$2: expected 'no $3 $4' (alpha width height), got '$info'" >&2
        exit 1
    fi
    echo "$2 opaque ${3}x${4}"
}

case "${1:-}" in
    mac)
        gabe_out="$2"; gabe_size="$3"; shift 3
        gabe_w="${gabe_size%x*}"; gabe_h="${gabe_size#*x}"
        "$gabe_root/target/release/dangerous-gabe" --window "$((gabe_w / 2))x$((gabe_h / 2))" \
            --frames 90 --screenshot "$gabe_tmp/frame.bmp" "$@"
        sips -s format png "$gabe_tmp/frame.bmp" --out "$gabe_tmp/frame.png" > /dev/null
        sips -p "$gabe_h" "$gabe_w" --padColor 07111F "$gabe_tmp/frame.png" --out "$gabe_tmp/padded.png" > /dev/null
        gabe_finish "$gabe_tmp/padded.png" "$gabe_out" "$gabe_w" "$gabe_h"
        ;;
    sim)
        gabe_udid="$2"; gabe_out="$3"; gabe_rotation="$4"; gabe_size="$5"; shift 5
        xcrun simctl launch --terminate-running-process "$gabe_udid" dev.dangerousgabe.game "$@" > /dev/null
        sleep "${GABE_SHOT_DELAY:-6}"
        xcrun simctl io "$gabe_udid" screenshot "$gabe_tmp/screen.png" > /dev/null 2>&1
        sips -r "$gabe_rotation" "$gabe_tmp/screen.png" --out "$gabe_tmp/rotated.png" > /dev/null
        gabe_finish "$gabe_tmp/rotated.png" "$gabe_out" "${gabe_size%x*}" "${gabe_size#*x}"
        ;;
    *)
        echo "Usage: bash platform/appstore-screenshot.sh mac OUT.png 2880x1800 [game args]" >&2
        echo "       bash platform/appstore-screenshot.sh sim UDID OUT.png ROTATION WxH [game args]" >&2
        exit 2
        ;;
esac
