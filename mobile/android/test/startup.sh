#!/bin/sh
# Emulator test of how TRIF starts (headless; the emulator booted by ./emu.sh start, the pages served by
# `node mobile/serve.js 8477`): the WebView check (a debug build pretends: too old, unreadable, none; the real one
# passes), the start page, and TRIF as a browser: Android lists it for https links, it can hold the browser role,
# a link then opens in it with no -n, and an exported-activity trick (javascript:, file:) is ignored.
# The browser role is put back as it was. Exit 0 = passed.
cd "$(dirname "$0")/.."
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
APP=com.timsrobot.trif
P=http://localhost:8477
ROLE=android.app.role.BROWSER
mkdir -p shots
old=""
restore() {
  [ -n "$old" ] && "$ADB" shell cmd role add-role-holder $ROLE "$old" >/dev/null 2>&1
  [ -z "$old" ] && "$ADB" shell cmd role remove-role-holder $ROLE $APP >/dev/null 2>&1
}
fail() { echo "FAIL: $*"; restore; "$ADB" logcat -d -s TRIF | tail -10; exit 1; }
shot() { "$ADB" exec-out screencap -p > "shots/$1.png"; }
ui() { "$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; "$ADB" shell cat /sdcard/ui.xml; }
address() { ui | tr '>' '\n' | grep 'class="android.widget.EditText"' | sed 's/.* text="\([^"]*\)".*/\1/' | head -1; }
expect() { i=0; while [ "$(address)" != "$1" ]; do i=$((i+1)); [ $i -gt 10 ] && fail "$2: address is '$(address)'"; sleep 1; done; }
# waits up to 8 s for the screen to show $1 (a regex), else fails with $2
see() { i=0; until ui | grep -qE "$1"; do i=$((i+1)); [ $i -gt 4 ] && fail "$2"; sleep 1; done; }
pretend() {
  # (-S stops the app first and waits: a plain force-stop then start can land in the old instance)
  "$ADB" shell am start -S -W -n $APP/.MainActivity --es trif.pretendWebView "$1" >/dev/null; sleep 2
}

"$ADB" reverse tcp:8477 tcp:8477 >/dev/null
# (not in front while updating: Android 17 relaunches an app updated in front with its last link, racing the test)
"$ADB" shell am force-stop $APP; "$ADB" shell input keyevent KEYCODE_HOME
"$ADB" install -r app/build/outputs/apk/debug/app-debug.apk >/dev/null || fail "install"
"$ADB" shell pm clear $APP >/dev/null

# 1. the WebView check
pretend 145.0.7000.1
see 'text="TRIF needs a newer Android System WebView"' "too old: no title"
see 'version 145\. TRIF needs version 149 or newer' "too old: no versions"
see 'text="(Open the Play Store|OPEN THE PLAY STORE)"' "too old: no Play Store button"
ui | grep -q 'class="android.widget.EditText"' && fail "too old: the browser showed anyway"
shot startup-1-too-old
pretend beta
see 'TRIF needs WebView version 149 or newer' "unreadable version"
pretend none
see 'text="TRIF needs Android System WebView"' "none: no title"
shot startup-2-none
"$ADB" shell cmd package resolve-activity -a android.intent.action.VIEW -d 'market://details?id=com.google.android.webview' \
  | grep -q com.android.vending || echo "note: no Play Store on this image for the button"
pretend 149.0.1
see 'text="Type an address or a search above."' "pretend 149: no start page"

# 2. the real check, the start page
"$ADB" shell am force-stop $APP
"$ADB" shell am start -W -n $APP/.MainActivity >/dev/null; sleep 2
see 'class="android.widget.EditText"' "no address bar"
see 'text="Type an address or a search above."' "no start page"
shot startup-3-start

# 3. a browser: can hold the browser role, is then Android's answer for https links, links open in it
old=$("$ADB" shell cmd role get-role-holders $ROLE | tr -d '\r' | tr ';' '\n' | head -1)
"$ADB" shell cmd role add-role-holder $ROLE $APP >/dev/null 2>&1
holders=$("$ADB" shell cmd role get-role-holders $ROLE | tr -d '\r')
[ "$holders" = "$APP" ] || fail "can't be the default browser (holders: '$holders')"
# (Android answers an https query with the default browser alone, so this is asked once TRIF is it)
"$ADB" shell cmd package query-activities --brief -a android.intent.action.VIEW -c android.intent.category.BROWSABLE \
  -d https://example.com | grep -q "$APP/" || fail "not listed for https links"
"$ADB" shell am force-stop $APP
"$ADB" shell am start -W -a android.intent.action.VIEW -d "$P/plain.html" >/dev/null; sleep 2
expect "$P/plain.html" "a link with TRIF as the default browser"
"$ADB" shell am start -W -a android.intent.action.VIEW -d "$P/feed.html" >/dev/null; sleep 2
expect "$P/feed.html" "a second link"
see 'content-desc="Tabs, 2 open"' "the second link isn't in a new tab"
shot startup-4-default
# (exported activity: only http/https taken; a javascript: or file: sent straight to it is ignored)
"$ADB" shell am start -W -n $APP/.MainActivity -a android.intent.action.VIEW -d 'javascript:document.title=1' >/dev/null; sleep 1
"$ADB" shell am start -W -n $APP/.MainActivity -a android.intent.action.VIEW -d 'file:///sdcard/ui.xml' >/dev/null; sleep 1
expect "$P/feed.html" "another scheme was opened"
see 'content-desc="Tabs, 2 open"' "another scheme made a tab"
restore
echo "PASS startup (browser role back to '${old:-none}')"
