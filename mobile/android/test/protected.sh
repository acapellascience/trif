#!/bin/sh
# Emulator test of protected (DRM) video (asks.html's Protected video: Widevine's key system, no licence; the emulator
# booted by ./emu.sh start, the pages served with `node mobile/serve.js 8477`), as Chrome on Android: the WebView's ask
# reaches TRIF and is allowed with no question; the Mods tab's ⋯ "Protected content on {site}" switches it off for
# that site (the page loads again and is refused), kept across launches, other sites still allowed; on again → allowed.
# localhost and 127.0.0.1 are two sites. Exit 0 = passed.
cd "$(dirname "$0")/.."
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
APP=com.timsrobot.trif
mkdir -p shots
fail() { echo "FAIL: $*"; "$ADB" logcat -d -s TRIF | tail -20; shot protected-fail; exit 1; }
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
answer() { i=0; until ui | grep -qE 'text="protected: [^"]+"'; do i=$((i+1)); [ $i -gt 15 ] && fail "$1: the page's answer"; sleep 1; done
  ui | tr '>' '\n' | grep -oE 'protected: [^"]+' | head -1; }
open() { # a fresh launch on $1's asks.html
  "$ADB" shell am force-stop $APP
  "$ADB" logcat -c
  "$ADB" shell am start -W -S -a android.intent.action.VIEW -d "$1/asks.html" -n $APP/.MainActivity >/dev/null
  expect "$1/asks.html" "$1's asks page"; see "ready" "$1's page"
}

"$ADB" reverse tcp:8477 tcp:8477 >/dev/null
"$ADB" shell am force-stop $APP; "$ADB" shell input keyevent KEYCODE_HOME
"$ADB" install -r app/build/outputs/apk/debug/app-debug.apk >/dev/null || fail "install"
"$ADB" shell pm clear $APP >/dev/null

menu() { # the Mods tab's ⋯ → the protected content item
  tap "Mods"; see "Mods on localhost" "the Mods tab" 15; tap "More"
  see "Protected content on $1" "the menu's protected item"
}
L=http://localhost:8477
I=http://127.0.0.1:8477

# 1. localhost: no question, allowed
open $L
tap "Protected video"
logged "page ask: localhost:8477 protected: allowed" "the WebView's ask reaching TRIF"
[ "$(answer "allowed")" = "protected: ok" ] || fail "not allowed by default: $(answer x)"
notlogged "protected: asked" "a question"
echo "localhost, default: protected: ok"

# 2. switched off for localhost in the Mods tab's ⋯ (checked = on): the page loads again, refused
menu localhost
ui | tr '>' '\n' | grep 'class="android.widget.CheckBox"' | grep -q 'checked="true"' || fail "the item isn't checked"
shot protected-2-menu
tap "Protected content on localhost"
logged "page ask: localhost:8477 protected: switched off" "switched off"
tap "Done"
see "ready" "the page loaded again"
"$ADB" logcat -c
tap "Protected video"
logged "page ask: localhost:8477 protected: off for this site" "off"
OFF=$(answer "off"); echo "localhost, off: $OFF"
[ "$OFF" = "protected: ok" ] && fail "played protected media while off"

# 3. a relaunch: still off there; 127.0.0.1 still allowed
open $L
tap "Protected video"
logged "page ask: localhost:8477 protected: off for this site" "off after a relaunch"
[ "$(answer "off again")" = "$OFF" ] || fail "localhost's answer changed after a relaunch"
open $I
tap "Protected video"
logged "page ask: 127.0.0.1:8477 protected: allowed" "the other site"
[ "$(answer "other site")" = "protected: ok" ] || fail "127.0.0.1 not allowed"

# 4. on again for localhost: allowed
open $L
menu localhost
tap "Protected content on localhost"
logged "page ask: localhost:8477 protected: switched on" "switched on"
tap "Done"
see "ready" "the page loaded again"
tap "Protected video"
logged "page ask: localhost:8477 protected: allowed" "on again"
[ "$(answer "on again")" = "protected: ok" ] || fail "not allowed after switching on"
shot protected-4-on
"$ADB" shell am force-stop $APP
echo "PASS protected"
