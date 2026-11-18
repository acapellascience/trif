#!/bin/sh
# Tim's sign-in test (SIGN-IN-TEST.md): builds the probe, starts the emulator WITH a window, opens the sign-in
# screen. `./signin.sh log` prints what was logged; `./signin.sh stop` shuts the emulator down.
cd "$(dirname "$0")" || exit 1
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
PKG=com.timsrobot.trif.probe
case "$1" in
  log) "$ADB" exec-out run-as $PKG cat files/signin.log; exit ;;
  stop) ./emu.sh stop; exit ;;
esac
./gradlew -q assembleDebug || exit 1
if "$ADB" devices | grep -q emulator- && [ -z "$(pgrep -f 'emulator.*trif-probe.*no-window')" ]; then :; else ./emu.sh stop >/dev/null 2>&1; sleep 3; ./emu.sh window || exit 1; fi
"$ADB" install -r app/build/outputs/apk/debug/app-debug.apk >/dev/null && "$ADB" shell am start -n $PKG/.SignInActivity >/dev/null && echo "The sign-in screen is open in the emulator window."
