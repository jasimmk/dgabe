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
gabe_executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$gabe_root/platform/Info.plist")"
if [ "$gabe_executable" != "$(basename "$gabe_app" .app)" ]; then
    echo 'iOS bundle executable must match its app basename for sideload compatibility.' >&2
    exit 1
fi
cp "$gabe_target_dir/$gabe_target/release/dangerous-gabe" "$gabe_app/$gabe_executable"
chmod 755 "$gabe_app/$gabe_executable"
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
elif [ -n "${GABE_PROFILE:-}" ]; then
    gabe_bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$gabe_app/Info.plist")"
    gabe_profile_plist="$(mktemp -t gabe-profile)"
    gabe_entitlements="$(mktemp -t gabe-entitlements)"
    trap 'rm -f "$gabe_partial" "$gabe_profile_plist" "$gabe_entitlements"' EXIT
    security cms -D -i "$GABE_PROFILE" > "$gabe_profile_plist"
    /usr/libexec/PlistBuddy -x -c 'Print :Entitlements' "$gabe_profile_plist" > "$gabe_entitlements"
    gabe_team="$(/usr/libexec/PlistBuddy -c 'Print :TeamIdentifier:0' "$gabe_profile_plist")"
    gabe_app_identifier="$(/usr/libexec/PlistBuddy -c 'Print :application-identifier' "$gabe_entitlements")"
    case "$gabe_app_identifier" in
        "$gabe_team".*) gabe_profile_bundle_id="${gabe_app_identifier#"$gabe_team".}" ;;
        *) echo "Profile App ID $gabe_app_identifier is not prefixed by team $gabe_team." >&2; exit 1 ;;
    esac
    case "$gabe_profile_bundle_id" in
        *'*'*) echo "Wildcard profile App ID $gabe_app_identifier is not supported; use an explicit App ID." >&2; exit 1 ;;
    esac
    if [ "$gabe_profile_bundle_id" != "$gabe_bundle_id" ]; then
        echo "Using profile bundle identifier $gabe_profile_bundle_id instead of $gabe_bundle_id for this device bundle."
        /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $gabe_profile_bundle_id" "$gabe_app/Info.plist"
        gabe_bundle_id="$gabe_profile_bundle_id"
    fi
    cp "$GABE_PROFILE" "$gabe_app/embedded.mobileprovision"
    codesign --force --timestamp=none --sign "${GABE_SIGN_IDENTITY:-Apple Development}" \
        --entitlements "$gabe_entitlements" "$gabe_app"
    codesign --verify --strict "$gabe_app"
    gabe_cert_dir="$(mktemp -d -t gabe-certs)"
    codesign -d --extract-certificates="$gabe_cert_dir/signer" "$gabe_app" 2>/dev/null
    gabe_signer_sha1="$(openssl x509 -inform der -in "$gabe_cert_dir/signer0" -noout -fingerprint -sha1 | cut -d= -f2)"
    gabe_profile_sha1s=""
    gabe_cert_index=0
    while /usr/libexec/PlistBuddy -c "Print :DeveloperCertificates:$gabe_cert_index" "$gabe_profile_plist" > "$gabe_cert_dir/profile.der" 2>/dev/null; do
        perl -pe 'chomp if eof' "$gabe_cert_dir/profile.der" > "$gabe_cert_dir/profile$gabe_cert_index.der"
        gabe_profile_sha1s="$gabe_profile_sha1s $(openssl x509 -inform der -in "$gabe_cert_dir/profile$gabe_cert_index.der" -noout -fingerprint -sha1 | cut -d= -f2)"
        gabe_cert_index=$((gabe_cert_index + 1))
    done
    rm -rf "$gabe_cert_dir"
    case " $gabe_profile_sha1s " in
        *" $gabe_signer_sha1 "*) ;;
        *) echo "Signing certificate $gabe_signer_sha1 is not one of the profile's development certificates:$gabe_profile_sha1s" >&2
           echo "Install the profile's Apple Development certificate and private key, then set GABE_SIGN_IDENTITY to its SHA-1." >&2
           exit 1 ;;
    esac
    echo "Signed device app: $gabe_app"
    echo "Install: xcrun devicectl device install app --device <device-id> '$gabe_app'"
    echo "Launch: xcrun devicectl device process launch --device <device-id> $gabe_bundle_id"
else
    gabe_ipa="$(dirname "$gabe_app")/DangerousGabe-unsigned.ipa"
    gabe_payload="$(mktemp -d -t gabe-ipa)"
    mkdir "$gabe_payload/Payload"
    ditto "$gabe_app" "$gabe_payload/Payload/$(basename "$gabe_app")"
    rm -f "$gabe_ipa"
    (cd "$gabe_payload" && ditto -c -k --norsrc --keepParent Payload "$gabe_ipa")
    rm -rf "$gabe_payload"
    unzip -l "$gabe_ipa" "Payload/$(basename "$gabe_app")/$gabe_executable" > /dev/null
    echo "Unsigned device app: $gabe_app"
    echo "Unsigned device IPA: $gabe_ipa"
    echo "Set GABE_PROFILE (and optionally GABE_SIGN_IDENTITY) to sign for device installation."
fi
