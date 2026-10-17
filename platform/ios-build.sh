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
gabe_target_dir="${CARGO_TARGET_DIR:-$gabe_root/target}"
gabe_target_dir="$(cd "$gabe_target_dir" && pwd)"
gabe_app="$gabe_target_dir/$gabe_target/release/bundle/DangerousGabe.app"
rm -rf "$gabe_app"
mkdir -p "$gabe_app"
cp "$gabe_target_dir/$gabe_target/release/dangerous-gabe" "$gabe_app/dangerous-gabe"
cp "$gabe_root/platform/Info.plist" "$gabe_app/Info.plist"
gabe_partial="$(mktemp -t gabe-icon-info)"
trap 'rm -f "$gabe_partial"' EXIT
xcrun --sdk "$gabe_sdk" actool "$gabe_root/assets/icons/Assets.xcassets" \
    --compile "$gabe_app" --platform "$gabe_sdk" \
    --minimum-deployment-target 15.0 --target-device iphone --target-device ipad \
    --app-icon AppIcon --output-partial-info-plist "$gabe_partial"
/usr/libexec/PlistBuddy -c 'Delete :CFBundleIcons' "$gabe_app/Info.plist"
/usr/libexec/PlistBuddy -c 'Delete :CFBundleIcons~ipad' "$gabe_app/Info.plist"
/usr/libexec/PlistBuddy -c "Merge $gabe_partial" "$gabe_app/Info.plist"
test -s "$gabe_app/Assets.car"
plutil -lint "$gabe_app/Info.plist"
if [ "$gabe_sdk" = iphonesimulator ]; then
    codesign --force --sign - "$gabe_app"
    codesign --verify --strict "$gabe_app"
    echo "Simulator app: $gabe_app"
    echo "Install: xcrun simctl install booted '$gabe_app'"
    echo "Launch: xcrun simctl launch booted dev.dangerousgabe.game"
else
    echo "Unsigned device app: $gabe_app"
    echo "A matching provisioning profile and user signing identity are required before device installation."
fi
