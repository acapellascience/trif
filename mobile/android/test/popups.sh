#!/bin/sh
# Emulator test of real popup windows (headless; the emulator booted by ./emu.sh start, the pages served on two
# ports, `node mobile/serve.js 8477` and `node mobile/serve.js 8478`): a sign-in-style window on another origin
# opens as a new tab, hands its result back to its opener and closes itself, back to the opener; a target=_blank
# link opens a new tab; a window.open as a page loads (no tap) is blocked. Screenshots in shots/. Exit 0 = passed.
cd "$(dirname "$0")/.."
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
APP=com.timsrobot.trif
P=http://localhost:8477
mkdir -p shots
fail() { echo "FAIL: $*"; exit 1; }
shot() { "$ADB" exec-out screencap -p > "shots/$1.png"; }
ui() { "$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; "$ADB" shell cat /sdcard/ui.xml; }
address() { ui | tr '>' '\n' | grep 'class="android.widget.EditText"' | sed 's/.* text="\([^"]*\)".*/\1/' | head -1; }
tap() {
  b=$(ui | tr '>' '\n' | grep -E "(content-desc|text)=\"$1\"" | head -1 | sed 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/')
  [ -n "$b" ] || fail "nothing to tap: $1"
  set -- $b; "$ADB" shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
}
expect() { i=0; while [ "$(address)" != "$1" ]; do i=$((i+1)); [ $i -gt 10 ] && fail "$2: address is '$(address)'"; sleep 1; done; }
# waits up to 10 s for a node with text or content-desc $1 on the screen
see() { i=0; until ui | grep -qE "(content-desc|text)=\"$1\""; do i=$((i+1)); [ $i -gt 10 ] && fail "$2: no '$1'"; sleep 1; done; }
count() { see "Tabs, $1 open" "$2"; }

"$ADB" reverse tcp:8477 tcp:8477 >/dev/null
"$ADB" reverse tcp:8478 tcp:8478 >/dev/null
# (not in front while updating: Android 17 relaunches an app updated in front with its last link, racing the test)
"$ADB" shell am force-stop $APP; "$ADB" shell input keyevent KEYCODE_HOME
"$ADB" install -r app/build/outputs/apk/debug/app-debug.apk >/dev/null || fail "install"
"$ADB" shell pm clear $APP >/dev/null
"$ADB" shell am start -S -W -a android.intent.action.VIEW -d "$P/signin.html" -n $APP/.MainActivity >/dev/null
expect "$P/signin.html" "the sign-in page"
see "Signed out" "the sign-in page's state"
# 0. the page's window.open as it loads, with no tap behind it: blocked
see "untapped window blocked" "a window opened without a tap"
count 1 "after the untapped window.open"

# 1. the sign-in window: a new tab on the other origin, with an opener
tap "Continue with Stand-in"
expect "http://127.0.0.1:8478/signin-popup.html" "the sign-in window"
count 2 "with the sign-in window open"
see "Choose an account" "the window has no opener"
shot popups-1-window
# 2. choosing: the result goes back to the opener and the window closes itself, back to the opener
tap "Test Person"
expect "$P/signin.html" "after the window closed itself"
count 1 "after the window closed itself"
see "Signed in as Test Person" "the opener didn't get the result"
shot popups-2-signed-in

# 3. a target=_blank link: a new tab
tap "Plain page in a new window"
expect "$P/plain.html" "the target=_blank link"
count 2 "after the target=_blank link"
tap "Tabs, 2 open"; sleep 1
tap "Close TRIF probe: plain page"; sleep 1
"$ADB" shell input keyevent KEYCODE_BACK; sleep 1
expect "$P/signin.html" "after closing the new window's tab"
shot popups-3-back
echo "PASS popups"
