#!/bin/bash
# Mac App Store packaging: universal (arm64 + x86_64) sandboxed .app and an
# installer .pkg, built without an Xcode project.
#
# Signing is parameterized and nothing is committed:
#   GABE_MAC_APP_IDENTITY        codesign identity for the .app
#                                (default "-" = ad hoc, for local testing;
#                                 App Store: "Apple Distribution: NAME (TEAMID)")
#   GABE_MAC_INSTALLER_IDENTITY  productbuild identity for the .pkg
#                                (unset = unsigned .pkg;
#                                 App Store: "3rd Party Mac Developer Installer: NAME (TEAMID)"
#                                 or "Mac Installer Distribution")
#   GABE_MAC_PROFILE             Mac App Store provisioning profile, copied to
#                                Contents/embedded.provisionprofile (optional)
#   GABE_MAC_BUNDLE_ID           overrides CFBundleIdentifier (optional)
#   GABE_MAC_PKG=0               skip the .pkg step
set -euo pipefail
gabe_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$gabe_root"

gabe_identity="${GABE_MAC_APP_IDENTITY:--}"
gabe_targets=(aarch64-apple-darwin x86_64-apple-darwin)
for gabe_target in "${gabe_targets[@]}"; do
    cargo build --locked --release --target "$gabe_target"
done

gabe_target_dir="${CARGO_TARGET_DIR:-$gabe_root/target}"
gabe_target_dir="$(cd "$gabe_target_dir" && pwd)"
gabe_out="$gabe_target_dir/universal-apple-darwin/release/appstore"
gabe_app="$gabe_out/DangerousGabe.app"
rm -rf "$gabe_out"
mkdir -p "$gabe_app/Contents/MacOS" "$gabe_app/Contents/Resources"

gabe_plist="$gabe_app/Contents/Info.plist"
cp "$gabe_root/platform/macos/Info.plist" "$gabe_plist"
gabe_executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$gabe_plist")"
lipo -create \
    "$gabe_target_dir/aarch64-apple-darwin/release/dangerous-gabe" \
    "$gabe_target_dir/x86_64-apple-darwin/release/dangerous-gabe" \
    -output "$gabe_app/Contents/MacOS/$gabe_executable"
chmod 755 "$gabe_app/Contents/MacOS/$gabe_executable"
lipo "$gabe_app/Contents/MacOS/$gabe_executable" -verify_arch arm64 x86_64

# Keep the bundle version in step with Cargo.toml.
gabe_version="$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $gabe_version" "$gabe_plist"
if [ -n "${GABE_MAC_BUNDLE_ID:-}" ]; then
    /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $GABE_MAC_BUNDLE_ID" "$gabe_plist"
fi
printf 'APPL????' > "$gabe_app/Contents/PkgInfo"
cp "$gabe_root/assets/icons/app.icns" "$gabe_app/Contents/Resources/AppIcon.icns"
cp "$gabe_root/platform/PrivacyInfo.xcprivacy" "$gabe_app/Contents/Resources/PrivacyInfo.xcprivacy"
if [ -n "${GABE_MAC_PROFILE:-}" ]; then
    cp "$GABE_MAC_PROFILE" "$gabe_app/Contents/embedded.provisionprofile"
fi
plutil -lint "$gabe_plist" "$gabe_app/Contents/Resources/PrivacyInfo.xcprivacy"

gabe_entitlements="$gabe_root/platform/macos/DangerousGabe.entitlements"
codesign --force --sign "$gabe_identity" --entitlements "$gabe_entitlements" \
    $( [ "$gabe_identity" = - ] || echo --timestamp ) "$gabe_app"
codesign --verify --strict --verbose=1 "$gabe_app"
codesign -d --entitlements - "$gabe_app" 2>/dev/null | grep -q 'com.apple.security.app-sandbox'
echo "Built $gabe_app (signed with: $gabe_identity)"

if [ "${GABE_MAC_PKG:-1}" != 0 ]; then
    gabe_pkg="$gabe_out/DangerousGabe-$gabe_version.pkg"
    if [ -n "${GABE_MAC_INSTALLER_IDENTITY:-}" ]; then
        productbuild --component "$gabe_app" /Applications --sign "$GABE_MAC_INSTALLER_IDENTITY" "$gabe_pkg"
    else
        productbuild --component "$gabe_app" /Applications "$gabe_pkg"
    fi
    pkgutil --check-signature "$gabe_pkg" || true
    echo "Built $gabe_pkg"
fi
