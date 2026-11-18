#!/bin/sh
# Emulator test of "never reload a page that's playing" (docs/MOBILE-BEHAVIOUR.md, Which tabs load again): a page
# playing sound (an <audio> started by a real tap) isn't loaded again (a quiet one is) when a mod for it is added; Pause all mods
# loads it again even so (the person's own act); a muted one doesn't count as playing (Resume loads it again).
# Needs the emulator (./emu.sh start, no sound) and `node mobile/serve.js 8477`. Exit 0 = passed.
cd "$(dirname "$0")/.."
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
APP=com.timsrobot.trif
P=http://localhost:8477
fail() { echo "FAIL: $*"; "$ADB" logcat -d -s TRIF | tail -8; exit 1; }
b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
logged() {
  i=0; while :; do
    a=$("$ADB" logcat -d -s TRIF | grep "$1" | head -1)
    [ -n "$a" ] && { echo "$a"; return; }
    i=$((i+1)); [ $i -gt 30 ] && return; sleep 0.5
  done
}
extra() { "$ADB" logcat -c; "$ADB" shell am start -n $APP/.MainActivity --es "$1" "$(b64 "$2")" >/dev/null 2>&1; logged " $3 " | sed "s/.* $3 //"; }
page() { extra trif.call "page:$1" "call: page"; }
is() { [ "$1" = "$2" ] || fail "$3: '$1', not '$2'"; echo "ok: $3"; }
open() { "$ADB" logcat -c; "$ADB" shell am start -S -W -a android.intent.action.VIEW -d "$1" -n $APP/.MainActivity >/dev/null; logged "mod reader: ready" >/dev/null; sleep 1.5; }
# a looping tone (a WAV made in the page), started by a real tap on the page; the page marked, to tell a reload
SOUND='const n = 8000, b = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
w(0, "RIFF"); b.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
b.setUint32(24, 8000, true); b.setUint32(28, 16000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, "data"); b.setUint32(40, n * 2, true);
for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.sin(i / 8000 * 440 * 2 * Math.PI) * 3000, true);
const a = document.createElement("audio"); a.loop = true; a.src = URL.createObjectURL(new Blob([b.buffer], { type: "audio/wav" }));
document.body.append(a); window.__a = a; window.__mark = 1;
document.addEventListener("click", (e) => { e.preventDefault(); a.play(); }, true); return "ready";'
start() {
  is "$(page "$SOUND")" "ok ready" "a sound ready on the page"
  "$ADB" shell input tap 540 1500
  i=0; while [ "$(page 'return !window.__a.paused')" != "ok true" ]; do i=$((i+1)); [ $i -gt 10 ] && fail "the tap didn't start the sound"; sleep 0.5; done
  echo "ok: playing after a tap"
}
mod() { printf '// ==WebMod==\n// @name   %s\n// @match  http://localhost/*\n// @boxed\n// ==/WebMod==\ntrif.log("hi");\n' "$1"; }

"$ADB" reverse tcp:8477 tcp:8477 >/dev/null
"$ADB" shell am force-stop $APP; "$ADB" shell input keyevent KEYCODE_HOME
"$ADB" install -r app/build/outputs/apk/debug/app-debug.apk >/dev/null || fail "install"
"$ADB" shell pm clear $APP >/dev/null
open "$P/plain.html"
# (a mod added while it's quiet: loaded again with it)
"$ADB" logcat -c
"$ADB" shell am start -n $APP/.MainActivity --es trif.addMod "$(b64 "$(mod 'Quiet one')")" >/dev/null 2>&1
[ -n "$(logged "its mods changed, loading it again")" ] || fail "a mod added to a quiet page didn't load it again"
echo "ok: quiet: loaded again with the new mod"
sleep 2
start

# (a mod for this page added while it plays: not loaded again, the sound goes on)
"$ADB" logcat -c
"$ADB" shell am start -n $APP/.MainActivity --es trif.addMod "$(b64 "$(mod 'Loud one')")" >/dev/null 2>&1
[ -n "$(logged "it's playing, so not loaded again now")" ] || fail "no 'playing, not loaded again' line"
sleep 1
is "$(page 'return [window.__mark, !window.__a.paused]')" 'ok [1,true]' "added while playing: not reloaded, still playing"

# (Pause all mods while it plays: loaded again)
is "$(extra trif.pause on 'pause:')" "on" "Pause all mods"
[ -n "$(logged "its mods changed, loading it again")" ] || fail "Pause all didn't load it again"
sleep 1.5
is "$(page 'return window.__mark || 0')" "ok 0" "Pause all: loaded again though playing"

# (muted: not playing, so Resume loads it again)
start
page 'window.__a.muted = true; return 1' >/dev/null
sleep 0.5
is "$(extra trif.pause off 'pause:')" "off" "Resume mods"
[ -n "$(logged "its mods changed, loading it again")" ] || fail "Resume didn't load the muted page again"
"$ADB" logcat -d -s TRIF | grep -q "it's playing" && fail "a muted page counted as playing"
echo "PASS"
