#!/bin/sh
# Emulator test of what a page asks of the browser (asks.html; the emulator booted by ./emu.sh start, the pages
# served with `node mobile/serve.js 8477`): the location (TRIF's question, then Android's, then the page has it; a
# second ask is answered without a question), the camera (Allow → Android's ask), the camera and mic (Don't Allow →
# the page is refused), a page's file input (the system picker; Back gives the page nothing), full screen (on, Back
# leaves it), downloads (a mod file → Add this mod?, a page's made .js file → Add this mod?, a style sheet → let go).
# Exit 0 = passed.
cd "$(dirname "$0")/.."
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
APP=com.timsrobot.trif
P=http://localhost:8477
mkdir -p shots
fail() { echo "FAIL: $*"; "$ADB" logcat -d -s TRIF | tail -20; shot pageasks-fail; exit 1; }
shot() { "$ADB" exec-out screencap -p > "shots/$1.png"; }
ui() { "$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; "$ADB" shell cat /sdcard/ui.xml; }
address() { ui | tr '>' '\n' | grep 'class="android.widget.EditText"' | sed 's/.* text="\([^"]*\)".*/\1/' | head -1; }
tap() {
  b=$(ui | tr '>' '\n' | grep -E "(content-desc|text)=\"$1\"" | head -1 | sed 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/')
  [ -n "$b" ] || fail "nothing to tap: $1"
  set -- $b; "$ADB" shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
}
expect() { i=0; while [ "$(address)" != "$1" ]; do i=$((i+1)); [ $i -gt 10 ] && fail "$2: address is '$(address)'"; sleep 1; done; }
see() { i=0; until ui | grep -qE "(content-desc|text)=\"$1\""; do i=$((i+1)); [ $i -gt ${3:-10} ] && fail "$2: no '$1'"; sleep 1; done; }
logged() { i=0; until "$ADB" logcat -d -s TRIF | grep -qF "$1"; do i=$((i+1)); [ $i -gt ${3:-10} ] && fail "$2: no log '$1'"; sleep 1; done; }
notlogged() { "$ADB" logcat -d -s TRIF | grep -qF "$1" && fail "$2: logged '$1'"; true; }
front() { "$ADB" shell dumpsys activity activities | grep -m1 -E 'topResumedActivity|mResumedActivity' | sed 's/.* u0 \([^/ ]*\).*/\1/'; }
# Android's own permission dialog: its "While using the app" (or "Only this time") button
android_allow() { see "(While using the app|Only this time)" "$1" 15; tap "While using the app"; }

"$ADB" reverse tcp:8477 tcp:8477 >/dev/null
"$ADB" shell am force-stop $APP; "$ADB" shell input keyevent KEYCODE_HOME
"$ADB" install -r app/build/outputs/apk/debug/app-debug.apk >/dev/null || fail "install"
"$ADB" shell pm clear $APP >/dev/null
"$ADB" shell cmd location set-location-enabled true
"$ADB" logcat -c
"$ADB" shell am start -W -S -a android.intent.action.VIEW -d "$P/asks.html" -n $APP/.MainActivity >/dev/null
expect "$P/asks.html" "the asks page"
see "ready" "the page"

# 1. the location: TRIF's question, then Android's, then the page has it
# (the emulator's GPS starts slowly: fixes sent every second through the step)
( while :; do "$ADB" emu geo fix -73.57 45.50 >/dev/null 2>&1; sleep 1; done ) & FIXES=$!
trap 'kill $FIXES 2>/dev/null' EXIT
tap "Location"
see "Allow “localhost:8477” to use your current location[?]" "TRIF's location question"
shot pageasks-1-question
logged "page ask: localhost:8477 location: asked" "the location question"
tap "ALLOW"
logged "asking Android for ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION" "Android's ask"
android_allow "Android's location dialog"
shot pageasks-1-android
logged "page ask: localhost:8477: location granted" "location granted"
# (the emulator's GPS reports only while asked: fixes sent until the page has one; a page timed out asks again)
i=0; until ui | grep -q 'text="location: 45.50 -73.57"'; do
  i=$((i+1)); [ $i -gt 45 ] && fail "the page's location: $(ui | tr '>' '\n' | grep -oE 'text="location[^"]*"')"
  ui | grep -q 'text="location: error 3"' && tap "Location"
  sleep 1
done
# …asked again: answered without a question
"$ADB" logcat -c
tap "Location"
logged "location: answered earlier, Allow" "the second location ask"
see "location: 45.50 -73.57" "the page's second location"
notlogged "location: asked" "the second location ask"
kill $FIXES 2>/dev/null

# 2. the camera: Allow, then Android's ask (the emulator's camera may be missing: the grant is what's checked)
"$ADB" logcat -c
tap "Camera"
see "Allow “localhost:8477” to use your camera[?]" "TRIF's camera question"
tap "ALLOW"
android_allow "Android's camera dialog"
logged "page ask: localhost:8477: camera granted" "camera granted"
i=0; until ui | grep -qE 'text="camera: [^"]+"'; do i=$((i+1)); [ $i -gt 10 ] && fail "the page's camera answer"; sleep 1; done
echo "page: $(ui | tr '>' '\n' | grep -oE "camera: [^\"]+")"

# 3. the camera and mic: Don't Allow, the page is refused
"$ADB" logcat -c
tap "Camera and mic"
see "Allow “localhost:8477” to use your camera and microphone[?]" "TRIF's camera and mic question"
tap "DON.{1,3}T ALLOW"
logged "camera+mic: Don't Allow" "Don't Allow"
see "camera and mic: NotAllowedError" "the page refused"
"$ADB" shell dumpsys package $APP | grep -q "RECORD_AUDIO: granted=true" && fail "Android gave the mic after Don't Allow"

# 4. a page's file input: the system's picker; Back gives the page nothing
"$ADB" logcat -c
tap "No file chosen"
logged "file input: the picker (image/* .js, several)" "the file input"
i=0; until [ "$(front)" != "$APP" ]; do i=$((i+1)); [ $i -gt 10 ] && fail "no picker came up"; sleep 1; done
echo "picker: $(front)"
shot pageasks-4-picker
"$ADB" shell input keyevent KEYCODE_BACK
logged "file input: 0 picked" "the picker closed"
i=0; until [ "$(front)" = "$APP" ]; do i=$((i+1)); [ $i -gt 10 ] && fail "back from the picker"; sleep 1; done

# 5. full screen: on, Back leaves it
"$ADB" logcat -c
tap "Full screen"
logged "full screen: on" "full screen"
see "fullscreen: on" "the page in full screen"
shot pageasks-5-full
# (--compressed: only what accessibility shows; the browser under the full-screen page is hidden from it)
"$ADB" shell uiautomator dump --compressed /sdcard/ui.xml >/dev/null 2>&1
"$ADB" shell cat /sdcard/ui.xml | grep -q 'class="android.widget.EditText"' && fail "the address bar shows in full screen"
"$ADB" shell input keyevent KEYCODE_BACK
logged "full screen: off" "leaving full screen"
see "fullscreen: off" "the page out of full screen"
expect "$P/asks.html" "after full screen"

# 6. downloads: a mod file → Add this mod?; a page's made .js → Add this mod?; a style sheet → let go
"$ADB" logcat -c
tap "Download a mod"
logged "download: downloaded calmer-feed.js" "the mod download"
see "Add this mod[?]" "the downloaded mod's offer"
see "Calmer feed" "the offer's mod"
shot pageasks-6-offer
tap "Cancel"
"$ADB" logcat -c
tap "Made file"
logged "download: downloaded" "the page's made file"
see "Add this mod[?]" "the made file's offer"
see "Made here" "the made file's mod"
tap "Cancel"
"$ADB" logcat -c
tap "Download a style sheet"
logged "download: page.css: let go" "the style sheet"
expect "$P/asks.html" "after the downloads"
echo "PASS: page asks (location, camera, camera and mic, file input, full screen, downloads)"
