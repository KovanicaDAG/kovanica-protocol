#!/bin/bash
# Test Android APK on connected device/emulator
# Usage: ./test-android-apk.sh [apk-path]

set -euo pipefail

APK_PATH="${1:-/root/kovanica/apps/android/app/build/outputs/apk/release/app-release.apk}"
ADB="/tmp/opencode/android-sdk/platform-tools/adb"

if [[ ! -f "${APK_PATH}" ]]; then
  echo "Error: APK not found at ${APK_PATH}"
  exit 1
fi

echo "=== Testing Android APK ==="
echo "APK: ${APK_PATH}"
echo ""

# Check for connected devices
echo "Checking for connected devices..."
DEVICES=$(${ADB} devices | grep -v "List" | grep -v "^$" | wc -l)

if [[ ${DEVICES} -eq 0 ]]; then
  echo "No devices connected. Available options:"
  echo "  1. Connect physical device with USB debugging enabled"
  echo "  2. Start emulator: /tmp/opencode/android-sdk/emulator/emulator -avd kovanica_test -no-window &"
  exit 1
fi

echo "Found ${DEVICES} device(s):"
${ADB} devices

# Install APK
echo ""
echo "Installing APK..."
${ADB} install -r -t "${APK_PATH}"

# Launch app
echo ""
echo "Launching app..."
${ADB} shell monkey -p com.kovanica.wallet -c android.intent.category.LAUNCHER 1

# Get logs
echo ""
echo "Recent logs (filter: Kovanica):"
${ADB} logcat -d | grep -i kovanica | tail -20

echo ""
echo "=== Test Complete ==="
echo "Check device for app launch. Use 'adb logcat' for live logs."