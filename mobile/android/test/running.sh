#!/bin/sh
# Emulator test of mods running, each through the real reader (debug extra trif.addMod) on strict.html (a page
# whose policy refuses TRIF's <style> elements, so style-mirror.js carries them): a boxed mod runs in the box (its
# trif.hide applies, its trif.log is in the box's log); a free mod's ==Style== section applies from TRIF's world
# with its settings' values, its code runs in the page's world with trif.style, and its window.trif.log reaches
# the app ("mod log"); a boxed mod with a power waits (held, not running) until Allow (debug extra trif.allow),
# then runs. Needs the emulator (./emu.sh start) and `node mobile/serve.js 8477`. Screenshot in shots/. Exit 0 = passed.
cd "$(dirname "$0")/.."
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
APP=com.timsrobot.trif
P=http://localhost:8477
mkdir -p shots
fail() { echo "FAIL: $*"; "$ADB" logcat -d -s TRIF | tail -8; exit 1; }
b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
logged() {
  i=0; while :; do
    a=$("$ADB" logcat -d -s TRIF | grep "$1" | head -1)
    [ -n "$a" ] && { echo "$a"; return; }
    i=$((i+1)); [ $i -gt 30 ] && return; sleep 0.5
  done
}
# extra <name> <value> <logged as>: the debug extra sent, then what the app logged for it ("<logged as> …")
extra() { "$ADB" logcat -c; "$ADB" shell am start -n $APP/.MainActivity --es "$1" "$(b64 "$2")" >/dev/null 2>&1; logged " $3 " | sed "s/.* $3 //"; }
call() { extra trif.call "$1:$2" "call: $1" ; }
add() { extra trif.addMod "$1" "add mod:"; }
is() { [ "$1" = "$2" ] || fail "$3: '$1', not '$2'"; echo "ok: $3"; }
open() { "$ADB" logcat -c; "$ADB" shell am start -S -W -a android.intent.action.VIEW -d "$1" -n $APP/.MainActivity >/dev/null; logged "mod reader: ready" >/dev/null; sleep 1.5; }
page() { call page "$1"; }

"$ADB" reverse tcp:8477 tcp:8477 >/dev/null
"$ADB" shell am force-stop $APP; "$ADB" shell input keyevent KEYCODE_HOME
"$ADB" install -r app/build/outputs/apk/debug/app-debug.apk >/dev/null || fail "install"
"$ADB" shell pm clear $APP >/dev/null
open "$P/plain.html"

BOXED='// ==WebMod==
// @name   Box hider
// @match  http://localhost/*
// @boxed
// ==/WebMod==
trif.hide("#promo-banner");
trif.log("boxed ran on " + page.title);'
is "$(add "$BOXED")" "localhost/box-hider boxed box runs" "a boxed mod added"

FREE='// ==WebMod==
// @name   Free styled
// @match  http://localhost/*
// @run-at document-start
// ==/WebMod==
// ==Style==
// { "css": "body { outline: 5px solid var(--accent) !important; }",
//   "settings": { "accent": { "type": "colour", "value": "#0a0b0c" }, "size": { "type": "number", "value": 21, "min": 1, "max": 40 } } }
// ==/Style==
document.documentElement.setAttribute("data-free-ran", String(trif.style.size));
window.trif?.log?.("free ran, size " + trif.style.size);'
a=$(add "$FREE"); echo "$a" | grep -q "^localhost/free-styled free page" || fail "a free mod added: $a"
echo "ok: a free mod added ($a)"
id=localhost/free-styled
[ "${a##* }" = held ] && { is "$(extra trif.allow "$id" allow:)" "$id runs" "the free mod allowed"; }

open "$P/strict.html"
is "$(page 'return getComputedStyle(document.getElementById("promo-banner")).display')" "ok none" "the boxed mod's trif.hide applies on a strict page"
is "$(call box 'return __trifSandbox.logs.map((l) => l.args.join(" ")).join("|")')" "ok boxed ran on TRIF probe: strict policy" "the boxed mod ran in the box (its log)"
is "$(page 'return typeof __trifSandbox')" "ok undefined" "the box isn't the page's"
is "$(page 'return document.documentElement.dataset.freeRan')" "ok 21" "the free mod ran in the page's world with trif.style"
is "$(page 'return getComputedStyle(document.body).outlineColor')" "ok rgb(10, 11, 12)" "its style section applies with its settings"
l=$("$ADB" logcat -d -s TRIF | grep "mod log" | grep "free ran" | head -1)
[ -n "$l" ] || { open "$P/strict.html?log"; l=$(logged "free ran"); }
echo "$l" | grep -q "free-styled.*free ran, size 21" || fail "its trif.log didn't reach the app: $l"
echo "ok: its window.trif.log reached the app"

HELD='// ==WebMod==
// @name   Clicker
// @match  http://localhost/*
// @boxed
// @powers click
// @click the close button: button.banner-close
// ==/WebMod==
trif.log("clicker ran");'
is "$(add "$HELD")" "localhost/clicker boxed box held" "a boxed mod with a power is held"
open "$P/strict.html?held"
is "$(call box 'return __trifSandbox.logs.map((l) => l.args.join(" ")).join("|")')" "ok boxed ran on TRIF probe: strict policy" "while held, it doesn't run"
is "$(extra trif.allow localhost/clicker allow:)" "localhost/clicker runs" "Allow"
open "$P/strict.html?allowed"
is "$(call box 'return __trifSandbox.logs.map((l) => l.args.join(" ")).join("|")')" "ok boxed ran on TRIF probe: strict policy|clicker ran" "once allowed, it runs"
"$ADB" exec-out screencap -p > shots/running.png
echo "PASSED"
