#!/bin/sh
# Emulator test of the Mods tab (ModsPanel.kt: the iPhone's mods.html / mods-page.js in a WebView of its own, its
# messages through js/webkit-bridge.js): two style mods for localhost added through the real reader; the toolbar's
# Mods opens the tab, titled "Mods on localhost", listing both with their switches on; a tap on one's switch
# switches it off in the store, the page loads again by itself and that mod no longer applies (the other still
# does); on again, it applies again; the bin deletes one, Recently deleted lists it, and restoring it brings it
# back; Done closes the tab. Needs the emulator (./emu.sh start) and `node mobile/serve.js 8477`. Exit 0 = passed.
cd "$(dirname "$0")/.."
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
APP=com.timsrobot.trif
P=http://localhost:8477
mkdir -p shots
fail() { echo "FAIL: $*"; "$ADB" logcat -d -s TRIF | tail -8; "$ADB" exec-out screencap -p > shots/modstab-fail.png; exit 1; }
b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
logged() {
  i=0; while :; do
    a=$("$ADB" logcat -d -s TRIF | grep "$1" | head -1)
    [ -n "$a" ] && { echo "$a"; return; }
    i=$((i+1)); [ $i -gt 30 ] && return; sleep 0.5
  done
}
extra() { "$ADB" logcat -c; "$ADB" shell am start -n $APP/.MainActivity --es "$1" "$(b64 "$2")" >/dev/null 2>&1; logged " $3 " | sed "s/.* $3 //"; }
call() { extra trif.call "$1:$2" "call: $1"; }
add() { extra trif.addMod "$1" "add mod:"; }
# code run in the Mods tab's page (it's shown first): its JSON answer
panel() { extra trif.panel "$1" "panel:"; }
is() { [ "$1" = "$2" ] || fail "$3: '$1', not '$2'"; echo "ok: $3"; }
open() { "$ADB" logcat -c; "$ADB" shell am start -S -W -a android.intent.action.VIEW -d "$1" -n $APP/.MainActivity >/dev/null; logged "mod reader: ready" >/dev/null; sleep 1.5; }
ui() { "$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; "$ADB" shell cat /sdcard/ui.xml | tr '>' '\n'; }
# taps the middle of the first node whose line matches $1 (a regex over uiautomator's attributes)
tap() {
  b=$(ui | grep -E "$1" | head -1 | sed 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/')
  [ -n "$b" ] || fail "nothing to tap: $1"
  set -- $b; "$ADB" shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
}
# waits up to 10 s for a node matching $1 on screen, else fails with $2
see() { i=0; until ui | grep -qE "$1"; do i=$((i+1)); [ $i -gt 10 ] && fail "$2"; sleep 1; done; echo "ok: $2"; }
outline() { call page 'return getComputedStyle(document.body).outlineColor'; }
outlined() { call page 'return getComputedStyle(document.body).outlineStyle'; }
shadow() { call page 'return getComputedStyle(document.body).boxShadow'; }
# the rows as the tab shows them: id:switch, …
rows() { panel 'return [...document.querySelectorAll("#mod-list li[data-mod]")].map((li) => li.dataset.mod + ":" + li.querySelector("[role=switch]").getAttribute("aria-checked")).join(",")'; }
# waits up to 10 s for the page's answer $1 to `$2` (outline/shadow), else fails with $3
until_is() { i=0; while a=$($2); [ "$a" != "$1" ]; do i=$((i+1)); [ $i -gt 10 ] && fail "$3: '$a', not '$1'"; sleep 1; done; echo "ok: $3"; }

"$ADB" reverse tcp:8477 tcp:8477 >/dev/null
"$ADB" shell am force-stop $APP; "$ADB" shell input keyevent KEYCODE_HOME
"$ADB" install -r app/build/outputs/apk/debug/app-debug.apk >/dev/null || fail "install"
"$ADB" shell pm clear $APP >/dev/null
open "$P/plain.html"

is "$(add '// ==WebMod==
// @name   Outlined
// @match  http://localhost/*
// @style
// ==/WebMod==
{ "css": "body { outline: 6px solid rgb(7, 8, 9) !important; }" }')" "localhost/outlined style trif runs" "a style mod added"
is "$(add '// ==WebMod==
// @name   Shadowed
// @match  http://localhost/*
// @style
// ==/WebMod==
{ "css": "body { box-shadow: rgb(1, 2, 3) 0px 0px 0px 4px !important; }" }')" "localhost/shadowed style trif runs" "a second style mod added"
open "$P/plain.html"
until_is "ok rgb(7, 8, 9)" outline "the first applies"
until_is "ok rgb(1, 2, 3) 0px 0px 0px 4px" shadow "the second applies"

# the tab, from the toolbar
tap 'content-desc="Mods"'
see 'text="Mods on localhost"' "the Mods tab opens, titled for the site"
see 'text="Outlined"' "it lists the first mod"
see 'text="Shadowed"' "and the second"
is "$(rows)" '{"ok":true,"value":"localhost/outlined:true,localhost/shadowed:true"}' "both switches on"
lights() { panel 'return [...document.querySelectorAll("#mod-list li[data-mod] .light")].map((l) => l.title).join(",")'; }
i=0; until [ "$(lights)" = '{"ok":true,"value":"Running on this page,Running on this page"}' ]; do i=$((i+1)); [ $i -gt 10 ] && fail "the page's answer: $(lights)"; sleep 1; done
echo "ok: the page's answer: both running on this page"
"$ADB" exec-out screencap -p > shots/modstab-1-list.png

# a tap on the first's switch: off in the store, the page loads again without it
"$ADB" logcat -c
tap 'class="android.widget.Switch".*' # (the rows' order: Outlined first)
l=$(logged "mods: localhost/outlined switched")
echo "$l" | grep -q "switched off" || fail "the switch didn't reach the store: $l"
echo "ok: a tap on its switch switched it off"
logged "its mods changed, loading it again" | grep -q . || fail "the page didn't load again"
echo "ok: the page loaded again by itself"
until_is "ok none" outlined "the switched-off mod no longer applies"
until_is "ok rgb(1, 2, 3) 0px 0px 0px 4px" shadow "the other still does"
i=0; until [ "$(rows)" = '{"ok":true,"value":"localhost/outlined:false,localhost/shadowed:true"}' ]; do i=$((i+1)); [ $i -gt 10 ] && fail "the tab's switch: $(rows)"; sleep 1; done
echo "ok: the tab shows it off"
"$ADB" exec-out screencap -p > shots/modstab-2-off.png

# on again
"$ADB" logcat -c
tap 'class="android.widget.Switch".*'
logged "mods: localhost/outlined switched on" | grep -q . || fail "not switched on again"
until_is "ok rgb(7, 8, 9)" outline "switched on again, it applies again"

# the bin, Recently deleted, restore (through the page's own buttons, as a tap would)
is "$(panel 'document.querySelector("#mod-list li[data-mod=\"localhost/shadowed\"] [aria-label=Delete]").click(); return "clicked"')" '{"ok":true,"value":"clicked"}' "the second's bin"
l=$(logged "mods: deleted localhost/shadowed"); [ -n "$l" ] || fail "not deleted"
echo "ok: deleted"
until_is "ok none" shadow "the deleted mod no longer applies"
i=0; until panel 'return document.getElementById("deleted-box").hidden ? "" : document.getElementById("deleted-list").textContent' | grep -q Shadowed; do
  i=$((i+1)); [ $i -gt 10 ] && fail "Recently deleted: $(panel 'return document.getElementById("deleted-box").outerHTML.slice(0, 300)')"; sleep 1; done
echo "ok: Recently deleted lists it"
"$ADB" exec-out screencap -p > shots/modstab-3-deleted.png
is "$(panel '[...document.querySelectorAll("#deleted-list button")].find((b) => b.textContent === "Restore").click(); return "clicked"')" '{"ok":true,"value":"clicked"}' "its Restore"
logged "mods: restored localhost/shadowed" | grep -q . || fail "not restored"
until_is "ok rgb(1, 2, 3) 0px 0px 0px 4px" shadow "restored, it applies again"
tap 'text="Done"'
i=0; while ui | grep -q 'text="Mods on localhost"'; do i=$((i+1)); [ $i -gt 5 ] && fail "Done didn't close it"; sleep 1; done
echo "ok: Done closes it"
echo "PASSED"
