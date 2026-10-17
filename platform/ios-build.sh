#!/bin/bash
set -euo pipefail
gabe_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$gabe_root"
case "${1:-simulator}" in
    simulator) gabe_target=aarch64-apple-ios-sim; gabe_sdk=iphonesimulator ;;
    device) gabe_target=aarch64-apple-ios; gabe_sdk=iphoneos ;;
    *) echo "Usage: bash platform/ios-build.sh [simulator|device]" >&2; exit 2 ;;
esac
export SDKROOT="$(xcrun --sdk "$gabe_sdk" --show-sdk-path)"
export IPHONEOS_DEPLOYMENT_TARGET=15.0
export CMAKE_TOOLCHAIN_FILE="$gabe_root/platform/ios.cmake"
cargo build --locked --release --target "$gabe_target"
gabe_app="$gabe_root/target/$gabe_target/release/bundle/DangerousGabe.app"
mkdir -p "$gabe_app"
cp "$gabe_root/target/$gabe_target/release/dangerous-gabe" "$gabe_app/dangerous-gabe"
cp "$gabe_root/platform/Info.plist" "$gabe_app/Info.plist"
plutil -lint "$gabe_app/Info.plist"
if [ "$gabe_sdk" = iphonesimulator ]; then
    codesign --force --sign - "$gabe_app"
    echo "Simulator app: $gabe_app"
    echo "Install: xcrun simctl install booted '$gabe_app'"
    echo "Launch: xcrun simctl launch booted dev.dangerousgabe.game"
else
    echo "Unsigned device app: $gabe_app"
    echo "A matching provisioning profile and user signing identity are required before device installation."
fi
