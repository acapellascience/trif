#!/bin/sh
# Every emulator test in turn, headless: builds the debug app (and the unit tests) unless --no-build, boots the
# emulator (./emu.sh start) and serves the stand-in pages on 8477 and 8478 (node mobile/serve.js) when they aren't
# already, runs each test, then stops what it started. Pass test names to run only those (./test/all.sh mods tabs).
# Exit 0 = all passed. On a shared Mac, take the device lock first (the loop prompt's devlock.sh).
cd "$(dirname "$0")/.."
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
ROOT="$(cd ../.. && pwd)"
LOG="${TMPDIR:-/tmp}/trif-android-tests"
mkdir -p "$LOG" shots
build=1
[ "$1" = --no-build ] && { build=0; shift; }
tests="${*:-startup tabs popups applinks worlds mods running modstab import offer playing}"

started_emu=0; pids=""
cleanup() {
  for p in $pids; do kill "$p" 2>/dev/null; done
  [ $started_emu = 1 ] && ./emu.sh stop >/dev/null
}
trap cleanup EXIT INT TERM

if [ $build = 1 ]; then
  export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
  echo "build + unit tests"
  ./gradlew -q assembleDebug testDebugUnitTest > "$LOG/build.txt" 2>&1 || { echo "FAIL: build (see $LOG/build.txt)"; tail -20 "$LOG/build.txt"; exit 1; }
fi
[ -f app/build/outputs/apk/debug/app-debug.apk ] || { echo "FAIL: no debug app (build first)"; exit 1; }

if ! "$ADB" devices | grep -q emulator-; then ./emu.sh start >/dev/null || exit 1; started_emu=1; fi
for port in 8477 8478; do
  if ! curl -s -o /dev/null "http://127.0.0.1:$port/"; then
    (cd "$ROOT" && exec node mobile/serve.js $port) > "$LOG/serve-$port.txt" 2>&1 &
    pids="$pids $!"
  fi
  "$ADB" reverse tcp:$port tcp:$port >/dev/null
done
i=0; until curl -s -o /dev/null http://127.0.0.1:8478/; do i=$((i+1)); [ $i -gt 20 ] && { echo "FAIL: pages not served"; exit 1; }; sleep 0.5; done

passed=""; failed=""
for t in $tests; do
  start=$(date +%s)
  "$ADB" logcat -c
  if sh "test/$t.sh" > "$LOG/$t.txt" 2>&1; then
    passed="$passed $t"; echo "PASS $t ($(( $(date +%s) - start )) s)"
  else
    failed="$failed $t"; echo "FAIL $t ($(( $(date +%s) - start )) s): $(grep -m1 'FAIL' "$LOG/$t.txt")"
  fi
done
echo "passed:${passed:- none}"
[ -z "$failed" ] && { echo "ALL PASS"; exit 0; }
echo "failed:$failed (logs in $LOG)"; exit 1
