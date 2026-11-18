#!/bin/sh
# Emulator test of the script worlds (headless; the emulator booted by ./emu.sh start, the pages served by
# `node mobile/serve.js 8477`): on strict.html (a strict security policy, a same-site frame), TRIF's own scripts
# run at the page's start in TRIF's world and talk to the app (start-own.js's "load" through webkit-bridge.js);
# each world sees only its own; then test mods (as the mod store will put them in): a style mod's <style> applies
# in TRIF's world despite the policy (style-mirror.js), a boxed mod runs in the box (SES locked down, confined),
# a free mod runs in the page's world at the page's end with its style section from TRIF's world; nothing in the
# frame. Screenshot in shots/. Exit 0 = passed.
cd "$(dirname "$0")/.."
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
APP=com.timsrobot.trif
P=http://localhost:8477
mkdir -p shots
fail() { echo "FAIL: $*"; "$ADB" logcat -d -s TRIF | tail -5; exit 1; }
b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
# call <world> <code>: its logged answer ("ok …" / "error …"), after up to 10 s
call() {
  "$ADB" logcat -c
  "$ADB" shell am start -n $APP/.MainActivity --es trif.call "$(b64 "$1:$2")" >/dev/null 2>&1
  i=0; while :; do
    a=$("$ADB" logcat -d -s TRIF | grep " call: $1 " | head -1 | sed "s/.* call: $1 //")
    [ -n "$a" ] && { echo "$a"; return; }
    i=$((i+1)); [ $i -gt 20 ] && { echo "no answer"; return; }; sleep 0.5
  done
}
is() { [ "$1" = "$2" ] || fail "$3: '$1', not '$2'"; echo "ok: $3"; }
open() { "$ADB" logcat -c; "$ADB" shell am start -S -W -a android.intent.action.VIEW -d "$1" -n $APP/.MainActivity $2 >/dev/null; }

"$ADB" reverse tcp:8477 tcp:8477 >/dev/null
"$ADB" shell am force-stop $APP; "$ADB" shell input keyevent KEYCODE_HOME
"$ADB" install -r app/build/outputs/apk/debug/app-debug.apk >/dev/null || fail "install"
"$ADB" shell pm clear $APP >/dev/null

# 1. no mods: TRIF's own, at the start, in TRIF's world; its message reaches the app and is answered
open "$P/strict.html"
i=0; until "$ADB" logcat -d -s TRIF | grep -q "load: "; do i=$((i+1)); [ $i -gt 20 ] && fail "no load message from start-own.js"; sleep 0.5; done
rec=$("$ADB" logcat -d -s TRIF | grep "load: " | head -1)
echo "$rec" | grep -q '"host":"localhost"' || fail "load message: $rec"
echo "$rec" | grep -q '"start":{[^}]*"readyState":"loading","pageRan":false' || fail "start-own didn't run at the page's start: $rec"
echo "ok: TRIF's world at the page's start, its message answered"
is "$(call trif 'return [typeof __trifKit, typeof webkit, typeof __probePage, typeof __trifProbePageStart, typeof __trifProbeStart].join()')" \
  "ok object,object,undefined,undefined,object" "TRIF's world sees its own, not the page's"
is "$(call page 'return [typeof __trifKit, typeof webkit, typeof trifApp, typeof __probePage, typeof __trifProbePageStart, typeof __trifProbeStart].join()')" \
  "ok undefined,undefined,undefined,string,object,undefined" "the page's world sees none of TRIF's"
is "$(call trif 'return await webkit.messageHandlers.trif.postMessage({ type: "ping", pad: "abc" }).then((r) => r.received)')" "ok 3" "a post's answer"
is "$(call trif 'return await webkit.messageHandlers.trif.postMessage({ type: "nope" }).then(() => "answered", (e) => e.message)')" "ok unknown message" "an unknown post refused"
is "$(call box 'return 1')" "error nothing of TRIF's in that world on this page" "no box without a boxed mod"
is "$(call page 'return document.getElementById("inner-frame").contentWindow.__trifProbePageStart === undefined')" "ok true" "nothing in the frame"

# 2. test mods: style (TRIF's world), boxed (the box, at the end), free (the page's world, at the end, a style section)
STYLE='(function () { const s = document.createElement("style"); s.textContent = "html { outline: 7px solid rgb(1, 2, 3) }"; (document.head || document.documentElement).appendChild(s); globalThis.__styleAt = document.readyState; })();'
BOXED='(function () { if (!globalThis.__trifSandbox) globalThis.__trifStartSandbox(); globalThis.__trifSandbox.run("test/boxed", "trif.log([typeof window, typeof document, typeof fetch, typeof trifApp, typeof webkit].join()); const o = page.find(\"#out\"); if (o) o.setText(\"boxed mod wrote this\");", { powers: [], args: {} }); })();'
FREE='window.__freeAt = document.readyState;'
FSTYLE='(function () { const s = document.createElement("style"); s.textContent = "body { border-top: 5px solid rgb(4, 5, 6) }"; (document.head || document.documentElement).appendChild(s); })();'
MODS=$(node -e 'const [s, b, f, fs] = process.argv.slice(1); console.log(JSON.stringify([
  { id: "test/style", script: s, world: "trif", at: "start" }, { id: "test/boxed", script: b, world: "box", at: "end" },
  { id: "test/free", script: f, world: "page", at: "end", style: fs }]))' "$STYLE" "$BOXED" "$FREE" "$FSTYLE")
open "$P/strict.html" "--es trif.testMods $(b64 "$MODS")"
sleep 3
is "$(call page 'return getComputedStyle(document.documentElement).outlineColor')" "ok rgb(1, 2, 3)" "a style mod's <style> applies despite the policy"
is "$(call trif 'return __styleAt')" "ok loading" "the style mod ran at the start"
is "$(call page 'return [window.__freeAt === "interactive" || window.__freeAt === "complete", getComputedStyle(document.body).borderTopColor].join()')" \
  "ok true,rgb(4, 5, 6)" "a free mod at the end, its style section applied"
is "$(call box 'return JSON.stringify([Object.isFrozen(Array.prototype), typeof Compartment, __trifSandbox.errors.length, __trifSandbox.logs.filter((l) => l.mod === "test/boxed").map((l) => l.args.join(" "))])')" \
  'ok [true,"function",0,["undefined,undefined,undefined,undefined,undefined"]]' "a boxed mod runs in the box, locked down and confined"
is "$(call page 'return document.getElementById("out").textContent')" "ok boxed mod wrote this" "the boxed mod changed the page"
is "$(call page 'const w = document.getElementById("inner-frame").contentWindow; return [w.__freeAt === undefined, w.getComputedStyle(w.document.documentElement).outlineStyle].join()')" \
  "ok true,none" "no mod in the frame"
is "$(call page 'return [typeof __trifSandbox, typeof lockdown, typeof __styleAt].join()')" "ok undefined,undefined,undefined" "the page sees neither the box nor TRIF's world"
"$ADB" exec-out screencap -p > shots/worlds-mods.png
echo "PASS worlds"
