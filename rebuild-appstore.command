#!/bin/bash
# Rebuilds the App Store .ipa and .pkg (build 7). Double-click from Finder.
set -euo pipefail
cd "$(dirname "$0")"
exec > >(tee rebuild-appstore.log) 2>&1
echo "Xcode: $(xcodebuild -version | tr '\n' ' ')"
sha() { security find-identity -v -p "$2" | grep "$1" | head -1 | awk '{print $2}'; }
dist="$(sha 'Apple Distribution: Jasim Muhammed (4WDYEV5QQZ)' codesigning)"
inst="$(security find-identity -v | grep -E '3rd Party Mac Developer Installer|Mac Installer Distribution' | grep 4WDYEV5QQZ | head -1 | awk '{print $2}')"
[ -n "$dist" ] || { echo "No Apple Distribution identity found"; exit 1; }
[ -n "$inst" ] || inst="$(security find-identity -v -p basic | grep -E 'Installer' | grep 4WDYEV5QQZ | head -1 | awk '{print $2}')"
[ -n "$inst" ] || { echo "No Mac installer identity found"; exit 1; }
GABE_PROFILE=.profiles/devdangerousgabegameiosjasimmkiosappstorprovision.mobileprovision \
  GABE_SIGN_IDENTITY="$dist" GABE_APPSTORE_IPA=1 bash platform/ios-build.sh device
GABE_MAC_BUNDLE_ID=dev.dangerousgabe.game.4WDYEV5QQZ GABE_MAC_APP_IDENTITY="$dist" \
  GABE_MAC_INSTALLER_IDENTITY="$inst" \
  GABE_MAC_PROFILE=.profiles/devdangerousgabegameiosjasimmkmaceprovision.provisionprofile \
  bash platform/macos-appstore.sh
pkg=target/universal-apple-darwin/release/appstore/DangerousGabe-1.2.0.pkg
xattr -lr target/universal-apple-darwin/release/appstore/DangerousGabe.app | grep -c quarantine || echo "no quarantine attrs"
echo REBUILD_OK
