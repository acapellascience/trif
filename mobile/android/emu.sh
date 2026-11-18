#!/bin/sh
# The one emulator (the probe's AVD), headless (no window, no sound): ./emu.sh start | stop | window
#   window = the same emulator with a window
export ANDROID_HOME="$HOME/Library/Android/sdk"
ADB="$ANDROID_HOME/platform-tools/adb"
case "$1" in
  start|window)
    if "$ADB" devices | grep -q emulator-; then echo "an emulator is already running"; exit 0; fi
    extra="-no-window"; [ "$1" = window ] && extra=""
    nohup "$ANDROID_HOME/emulator/emulator" -avd trif-probe $extra -no-audio -no-boot-anim -memory 2048 -cores 2 -no-snapshot-save $EMU_EXTRA > "${TMPDIR:-/tmp}/trif-android-emulator.log" 2>&1 &
    "$ADB" wait-for-device
    until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do sleep 2; done
    echo "booted" ;;
  stop)
    "$ADB" emu kill 2>/dev/null; echo "stopped" ;;
  *) echo "usage: $0 start|stop|window"; exit 1 ;;
esac
