#!/bin/sh
# Emulator test of "Add this mod?" (ModOffer.kt, iPhone's ModOfferView) for text shared to TRIF (SEND text/plain):
# a style mod for the shown site is offered with its name, tier and code; Add it adds it ("Added {name}. It runs on
# {sites}.") and it applies. One for another site is offered with the warning first ("It runs on another site");
# Cancel adds nothing. A boxed mod with a power: Add it says it waits for your OK and the Mods tab opens on it. Shared
# text with no mod opens as an address. Needs the emulator (./emu.sh start) and `node mobile/serve.js 8477`.
cd "$(dirname "$0")/.."
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
APP=com.timsrobot.trif
P=http://localhost:8477
mkdir -p shots
fail() { echo "FAIL: $*"; "$ADB" logcat -d -s TRIF | tail -8; "$ADB" exec-out screencap -p > shots/offer-fail.png; exit 1; }
b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
logged() {
  i=0; while :; do
    a=$("$ADB" logcat -d -s TRIF | grep "$1" | head -1)
    [ -n "$a" ] && { echo "$a"; return; }
    i=$((i+1)); [ $i -gt 30 ] && return; sleep 0.5
  done
}
is() { [ "$1" = "$2" ] || fail "$3: '$1', not '$2'"; echo "ok: $3"; }
ui() { "$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; "$ADB" shell cat /sdcard/ui.xml | tr '>' '\n'; }
tap() {
  b=$(ui | grep -E "$1" | head -1 | sed 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/')
  [ -n "$b" ] || fail "nothing to tap: $1"
  set -- $b; "$ADB" shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
}
see() { i=0; until ui | grep -qE "$1"; do i=$((i+1)); [ $i -gt 10 ] && fail "$2"; sleep 1; done; echo "ok: $2"; }
# share <text>: SEND text/plain to TRIF, as a share sheet does (no single quotes in it)
share() { "$ADB" logcat -c; "$ADB" shell "am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT '$1' -n $APP/.MainActivity" >/dev/null 2>&1; }
call() { "$ADB" logcat -c; "$ADB" shell am start -n $APP/.MainActivity --es trif.call "$(b64 "$1:$2")" >/dev/null 2>&1; logged " call: $1 " | sed "s/.* call: $1 //"; }

"$ADB" reverse tcp:8477 tcp:8477 >/dev/null
"$ADB" shell am force-stop $APP; "$ADB" shell input keyevent KEYCODE_HOME
"$ADB" install -r app/build/outputs/apk/debug/app-debug.apk >/dev/null || fail "install"
"$ADB" shell pm clear $APP >/dev/null
"$ADB" logcat -c
"$ADB" shell am start -S -W -a android.intent.action.VIEW -d $P/plain.html -n $APP/.MainActivity >/dev/null
logged "mod reader: ready" >/dev/null || fail "the reader didn't start"; sleep 1.5

share '// ==WebMod==
// @name   Shared style
// @description Outlines the page
// @match  http://localhost/*
// @style
// ==/WebMod==
{ "css": "body { outline: 3px solid rgb(0, 128, 0) !important; }" }'
is "$(logged 'offer:' | sed 's/.*offer: //')" "localhost/shared-style style from localhost" "a shared style mod: offered, from the shown site"
see 'text="Add this mod[?]"' "the sheet: Add this mod?"
see 'text="Style mod"' "its tier"
see 'text="Outlines the page"' "its description"
ui | grep -q 'It runs on another site' && fail "a warning for a mod for its own site"
"$ADB" exec-out screencap -p > shots/offer-style.png
"$ADB" logcat -c; tap 'text="Add it"'
is "$(logged 'said:' | sed 's/.*said: //')" "Added Shared style. It runs on localhost." "Add it: added, the iPhone's words"
i=0; until [ "$(call page 'return getComputedStyle(document.body).outlineColor')" = 'ok rgb(0, 128, 0)' ]; do
  i=$((i+1)); [ $i -gt 10 ] && fail "the added mod doesn't apply"; sleep 1; done
echo "ok: it applies"

share '// ==WebMod==
// @name   Elsewhere
// @match  https://example.com/*
// @style
// ==/WebMod==
{ "css": "body { color: red; }" }'
case "$(logged 'offer:')" in *"from localhost, It runs on another site") echo "ok: a mod for another site: the warning";; *) fail "no warning: $(logged 'offer:')";; esac
see 'text="It came from localhost, but it runs on example.com. Add it only if you meant it to change that site."' "the warning's words"
"$ADB" exec-out screencap -p > shots/offer-elsewhere.png
tap 'text="Cancel"'
[ -n "$(logged 'declined')" ] || fail "Cancel not logged"
logged "add mod: example.com" | grep -q . && fail "Cancel added it"
echo "ok: Cancel adds nothing"

share '// ==WebMod==
// @name   Shared boxed
// @match  http://localhost/*
// @boxed
// @powers click
// @click the close button: button.banner-close
// ==/WebMod==
trif.log("boxed");'
[ -n "$(logged 'offer: localhost/shared-boxed boxed')" ] || fail "the boxed mod wasn't offered: $(logged 'offer:')"
see 'text="Boxed mod"' "a boxed mod: offered"
see 'text="It asks for these powers. TRIF holds it to them:"' "its powers, as the approval card says them"
"$ADB" logcat -c; tap 'text="Add it"'
is "$(logged 'said:' | sed 's/.*said: //')" "Shared boxed waits for your OK." "a held mod: waits for your OK"
see 'text="Shared boxed"' "the Mods tab shows it"
"$ADB" exec-out screencap -p > shots/offer-held.png
tap 'text="Done"'

share "$P/plain.html?shared"
i=0; until ui | grep -q 'plain.html?shared'; do i=$((i+1)); [ $i -gt 10 ] && fail "shared text with no mod: not opened"; sleep 1; done
echo "ok: shared text with no mod opens as an address"
echo "PASS"
