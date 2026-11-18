#!/bin/sh
# Emulator test of the tabs (headless; the emulator already booted by ./emu.sh start, the pages served by
# `node mobile/serve.js 8477`): links open in the empty tab then in new tabs, each tab keeps its own back/forward,
# and the tabs come back after the app is stopped. Screenshots in mobile/android/shots/. Exit 0 = passed.
cd "$(dirname "$0")/.."
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
APP=com.timsrobot.trif
P=http://localhost:8477
mkdir -p shots
fail() { echo "FAIL: $*"; exit 1; }
shot() { "$ADB" exec-out screencap -p > "shots/$1.png"; }
ui() { "$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; "$ADB" shell cat /sdcard/ui.xml; }
# the address field's text (the one EditText)
address() { ui | tr '>' '\n' | grep 'class="android.widget.EditText"' | sed 's/.* text="\([^"]*\)".*/\1/' | head -1; }
# taps the node whose content-desc or text matches $1
tap() {
  b=$(ui | tr '>' '\n' | grep -E "(content-desc|text)=\"$1\"" | head -1 | sed 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/')
  [ -n "$b" ] || fail "nothing to tap: $1"
  set -- $b; "$ADB" shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
}
# waits up to 10 s for the address field to show $1, else fails with $2
expect() { i=0; while [ "$(address)" != "$1" ]; do i=$((i+1)); [ $i -gt 10 ] && fail "$2: address is '$(address)'"; sleep 1; done; }
saved() { "$ADB" shell run-as $APP cat no_backup/tabs.json 2>/dev/null; }
view() { "$ADB" shell am start -W -a android.intent.action.VIEW -d "$1" -n $APP/.MainActivity >/dev/null; sleep 2; }

"$ADB" reverse tcp:8477 tcp:8477 >/dev/null
"$ADB" install -r app/build/outputs/apk/debug/app-debug.apk >/dev/null || fail "install"
"$ADB" shell pm clear $APP >/dev/null
"$ADB" shell am start -W -n $APP/.MainActivity >/dev/null; sleep 2
shot tabs-1-start

# 1. a link opened with the app goes into the empty first tab; a second page in that tab
view "$P/plain.html"
expect "$P/plain.html" "first link"
"$ADB" shell input tap 540 123; "$ADB" shell input keycombination 113 29; "$ADB" shell input keyevent KEYCODE_DEL
"$ADB" shell input text "localhost:8477/spa.html"; "$ADB" shell input keyevent KEYCODE_ENTER; sleep 2
expect "$P/spa.html" "typed address"
# 2. a second link: a new tab
view "$P/feed.html"
expect "$P/feed.html" "second link"
ui | grep -q 'content-desc="Tabs, 2 open"' || fail "the tabs button doesn't say 2 open"
shot tabs-2-two
n=$(saved | grep -o '"id"' | wc -l | tr -d ' ')
[ "$n" = 2 ] || fail "tabs.json holds $n tabs"
saved | grep -q WEBVIEW_CHROMIUM_STATE || fail "no back/forward list saved"

# 3. stopped and opened again: both tabs back, the last one shown, and the first one's back goes to plain.html
"$ADB" shell am force-stop $APP
"$ADB" shell am start -W -n $APP/.MainActivity >/dev/null; sleep 3
expect "$P/feed.html" "after a restart"
tap "Tabs, 2 open"; sleep 1
shot tabs-3-list
ui | grep -q 'text="2 tabs"' || fail "the list's title"
tap "TRIF probe: a page that changes after loading"; sleep 2
expect "$P/spa.html" "first tab after a restart"
tap "Back"; sleep 2
expect "$P/plain.html" "back in the restored tab"
shot tabs-4-back
tap "Forward"; sleep 2
expect "$P/spa.html" "forward"

# 4. closing a tab
tap "Tabs, 2 open"; sleep 1
tap "Close .*"; sleep 1
ui | grep -q 'text="1 tab"' || fail "after closing one: not 1 tab"
# 5. the + : a new, empty tab after the shown one, its start words showing
"$ADB" shell input keyevent KEYCODE_BACK; sleep 1
tap "New Tab"; sleep 1
ui | grep -q 'content-desc="Tabs, 2 open"' || fail "after +: not 2 open"
ui | grep -q 'text="Type an address or a search above."' || fail "the new tab's start words"
"$ADB" shell input keyevent KEYCODE_BACK
echo "PASS tabs"
