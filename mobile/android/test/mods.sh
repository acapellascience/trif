#!/bin/sh
# Emulator test of the mod reader (headless; the emulator booted by ./emu.sh start, the pages served by
# `node mobile/serve.js 8477`): mobile/shared/gen/mods.js in the JavaScriptSandbox reads a pasted style mod (the
# debug extra trif.addMod), the store adds it and it applies on the page; something that isn't a mod gets the
# reader's own reason; after a force-stop the mod is read again at the start (scripts aren't kept) and applies on
# the first page. Screenshot in shots/. Exit 0 = passed.
cd "$(dirname "$0")/.."
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
APP=com.timsrobot.trif
P=http://localhost:8477
mkdir -p shots
fail() { echo "FAIL: $*"; "$ADB" logcat -d -s TRIF | tail -5; exit 1; }
b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
# logged <pattern>: the first TRIF log line matching it, after up to 15 s
logged() {
  i=0; while :; do
    a=$("$ADB" logcat -d -s TRIF | grep "$1" | head -1)
    [ -n "$a" ] && { echo "$a"; return; }
    i=$((i+1)); [ $i -gt 30 ] && return; sleep 0.5
  done
}
call() {
  "$ADB" logcat -c
  "$ADB" shell am start -n $APP/.MainActivity --es trif.call "$(b64 "$1:$2")" >/dev/null 2>&1
  logged " call: $1 " | sed "s/.* call: $1 //"
}
is() { [ "$1" = "$2" ] || fail "$3: '$1', not '$2'"; echo "ok: $3"; }
open() { "$ADB" logcat -c; "$ADB" shell am start -S -W -a android.intent.action.VIEW -d "$1" -n $APP/.MainActivity >/dev/null; }
add() { "$ADB" logcat -c; "$ADB" shell am start -n $APP/.MainActivity --es trif.addMod "$(b64 "$1")" >/dev/null 2>&1; logged " add mod: " | sed 's/.* add mod: //'; }
outline() { call page 'return getComputedStyle(document.body).outlineColor'; }

"$ADB" reverse tcp:8477 tcp:8477 >/dev/null
"$ADB" shell am force-stop $APP; "$ADB" shell input keyevent KEYCODE_HOME
"$ADB" install -r app/build/outputs/apk/debug/app-debug.apk >/dev/null || fail "install"
"$ADB" shell pm clear $APP >/dev/null

open "$P/plain.html"
r=$(logged "mod reader: ready")
echo "$r" | grep -q "mod reader: ready, 0 mods" || fail "the reader didn't start: $r"
echo "ok: the reader started (${r##*, })"

STYLE='// ==WebMod==
// @name   Outlined
// @match  http://localhost/*
// @style
// ==/WebMod==
{ "css": "body { outline: 6px solid rgb(7, 8, 9) !important; }" }'
a=$(add "$STYLE")
is "$a" "localhost/outlined style trif runs" "a pasted style mod read and added"
is "$(add 'just some words')" "error there is no mod file (a ==WebMod== header) in it" "not a mod: the reader's reason"
open "$P/plain.html"
logged "mod reader: ready" | grep -q "ready, 1 mods" || fail "not read again at the start"
sleep 1
is "$(outline)" "ok rgb(7, 8, 9)" "the style mod applies"

# again after a force-stop: read again at the start, on the first page
"$ADB" shell am force-stop $APP
open "$P/plain.html?again"
r=$(logged "mod reader: ready")
echo "$r" | grep -q "ready, 1 mods" || fail "after a force-stop: $r"
sleep 1
is "$(outline)" "ok rgb(7, 8, 9)" "after a force-stop, it applies on the first page (${r##*, })"
"$ADB" exec-out screencap -p > shots/mods.png
echo "PASSED"
