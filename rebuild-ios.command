#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
exec > >(tee rebuild-ios.log) 2>&1
dist="$(security find-identity -v -p codesigning | grep 'Apple Distribution: Jasim Muhammed (4WDYEV5QQZ)' | head -1 | awk '{print $2}')"
GABE_PROFILE=.profiles/devdangerousgabegameiosjasimmkiosappstorprovision.mobileprovision \
  GABE_SIGN_IDENTITY="$dist" GABE_APPSTORE_IPA=1 bash platform/ios-build.sh device
echo REBUILD_OK
