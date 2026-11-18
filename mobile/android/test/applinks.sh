#!/bin/sh
# Emulator test of links to other apps (headless; the emulator booted by ./emu.sh start, the pages served with
# `node mobile/serve.js 8477`): a tapped tel: link goes to Android (the phone app comes up); a tapped link no app
# takes is only logged (and a note shown); an intent: link no app takes opens its fallback page; a target=_blank
# tel: link goes to Android and its empty window closes; a page trying by itself (7 s after a tap) gets the question;
# a page trying as it loads is asked once, its frame's try and its second try are dropped. Exit 0 = passed.
cd "$(dirname "$0")/.."
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
APP=com.timsrobot.trif
P=http://localhost:8477
mkdir -p shots
fail() { echo "FAIL: $*"; "$ADB" logcat -d -s TRIF | tail -20; exit 1; }
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
# waits up to 10 s for a TRIF log line containing $1
logged() { i=0; until "$ADB" logcat -d -s TRIF | grep -qF "$1"; do i=$((i+1)); [ $i -gt 10 ] && fail "$2: no log '$1'"; sleep 1; done; }
notlogged() { "$ADB" logcat -d -s TRIF | grep -qF "$1" && fail "$2: logged '$1'"; true; }
front() { "$ADB" shell dumpsys activity activities | grep -m1 -E 'topResumedActivity|mResumedActivity' | sed 's/.* u0 \([^/ ]*\).*/\1/'; }
back_to_app() { "$ADB" shell am start -W -n $APP/.MainActivity >/dev/null; i=0; until [ "$(front)" = "$APP" ]; do i=$((i+1)); [ $i -gt 10 ] && fail "the app didn't come back"; sleep 1; done; sleep 1; }

"$ADB" reverse tcp:8477 tcp:8477 >/dev/null
# (not in front while updating: Android 17 relaunches an app updated in front with its last link, racing the test)
"$ADB" shell am force-stop $APP; "$ADB" shell input keyevent KEYCODE_HOME
"$ADB" install -r app/build/outputs/apk/debug/app-debug.apk >/dev/null || fail "install"
"$ADB" shell pm clear $APP >/dev/null
"$ADB" logcat -c
"$ADB" shell am start -W -a android.intent.action.VIEW -d "$P/applinks.html" -n $APP/.MainActivity >/dev/null
expect "$P/applinks.html" "the app links page"
see "Call the stand-in" "the page"

# 1. a tapped tel: link: to Android, the phone app comes up
tap "Call the stand-in"
logged "tel: from a page, tapped: handed to Android" "the tapped tel: link"
i=0; until [ "$(front)" != "$APP" ]; do i=$((i+1)); [ $i -gt 10 ] && fail "no other app came up for tel:"; sleep 1; done
echo "tel: went to $(front)"
shot applinks-1-phone
back_to_app

# 2. a tapped link no app takes: only logged (and the note)
tap "An app nobody has"
logged "nosuchapp-trif-test: from a page, tapped: no app for it" "the link nobody takes"
expect "$P/applinks.html" "after the link nobody takes"

# 3. an intent: link no app takes: its fallback page
tap "Intent with a fallback"
logged "intent: from a page, tapped: no app for it, its fallback page" "the intent link"
expect "$P/plain.html" "the intent's fallback"
"$ADB" shell input keyevent KEYCODE_BACK
expect "$P/applinks.html" "back from the fallback"

# 4. a target=_blank tel: link: to Android, and its empty window's tab closes
tap "Call in a new window"
logged "tel: from a page's new window, tapped: handed to Android" "the new window's tel: link"
sleep 2
back_to_app
see "Tabs, 1 open" "the empty window's tab"
expect "$P/applinks.html" "after the new window's tel: link"

# 5. the page by itself, 7 s after a tap: the question; Cancel
tap "By itself in 7 s"
see "Open this page in another app[?]" "the page's own try" 30
logged "sms: from a page: asked" "the question"
shot applinks-5-question
tap "CANCEL"
logged "sms: from a page: asked, Cancel" "Cancel"
[ "$(front)" = "$APP" ] || fail "Cancel opened another app"

# 6. trying as it loads: asked once; the frame's try and the second try dropped
"$ADB" shell am start -W -a android.intent.action.VIEW -d "$P/applinks.html?auto" -n $APP/.MainActivity >/dev/null
see "Open this page in another app[?]" "the load's try" 30
logged "tel: from a page, not opened: a frame inside the page, not tapped" "the frame's try"
logged "tel: from a page, not opened: a question is already up" "the second try"
tap "CANCEL"
[ "$("$ADB" logcat -d -s TRIF | grep -c 'tel: from a page: asked *$')" = 1 ] || fail "asked more than once"
echo "PASS applinks"
