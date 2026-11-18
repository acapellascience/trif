#!/bin/sh
# Emulator test of a mod file (.js) opened with TRIF and shared to it (SEND; SEND_MULTIPLE isn't sendable from am) (iPhone's importFiles): imported, off at
# first (as any mod from outside), the iPhone's words said, the Mods tab shown with it. A file that isn't a mod is
# refused with its reason. The file goes through Android's media store (content://media/…), as a file app's would.
# A zip of a site's mods (desktop's export folder, zipped; a zip inside, __MACOSX left out) opened with TRIF: both
# imported. The Mods tab's Import mod… opens the system's file picker; Export (a mod's) and the ⋯ menu's Export all
# mods for localhost hand the files to the share sheet.
# Needs the emulator (./emu.sh start) and `node mobile/serve.js 8477`. Exit 0 = passed.
cd "$(dirname "$0")/.."
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
APP=com.timsrobot.trif
fail() { echo "FAIL: $*"; "$ADB" logcat -d -s TRIF | tail -8; exit 1; }
logged() {
  i=0; while :; do
    a=$("$ADB" logcat -d -s TRIF | grep "$1" | head -1)
    [ -n "$a" ] && { echo "$a"; return; }
    i=$((i+1)); [ $i -gt 30 ] && return; sleep 0.5
  done
}
is() { [ "$1" = "$2" ] || fail "$3: '$1', not '$2'"; echo "ok: $3"; }
TMP=$(mktemp -d)
# put <name> <text>: the file in Downloads, its media store address printed
put() {
  printf '%s' "$2" > "$TMP/$1"; "$ADB" push "$TMP/$1" "/sdcard/Download/$1" >/dev/null 2>&1
  "$ADB" shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/Download/$1" >/dev/null
  i=0; while :; do
    id=$("$ADB" shell content query --uri content://media/external/file --projection _id --where "_display_name=\'$1\'" | sed -n 's/.*_id=\([0-9]*\).*/\1/p' | tail -1)
    [ -n "$id" ] && break; i=$((i+1)); [ $i -gt 10 ] && fail "the media store didn't take $1"; sleep 0.5
  done
  echo "content://media/external/file/$id"
}
said() { logged "import said:" | sed 's/.*import said: //'; }

"$ADB" shell am force-stop $APP; "$ADB" shell input keyevent KEYCODE_HOME
"$ADB" install -r app/build/outputs/apk/debug/app-debug.apk >/dev/null || fail "install"
"$ADB" shell pm clear $APP >/dev/null
"$ADB" shell rm -f /sdcard/Download/file-one.js /sdcard/Download/file-two.js /sdcard/Download/not-a-mod.js

ONE=$(put file-one.js '// ==WebMod==
// @name   File one
// @match  http://localhost/*
// @boxed
// ==/WebMod==
trif.log("from a file");')
# (TRIF on a localhost page first, so its Mods tab is for the mods' site)
"$ADB" reverse tcp:8477 tcp:8477 >/dev/null
"$ADB" logcat -c
"$ADB" shell am start -S -W -a android.intent.action.VIEW -d http://localhost:8477/plain.html -n $APP/.MainActivity >/dev/null
logged "mod reader: ready" >/dev/null; sleep 1.5
"$ADB" logcat -c
"$ADB" shell am start -a android.intent.action.VIEW -t text/javascript -d "$ONE" --grant-read-uri-permission -n $APP/.MainActivity >/dev/null 2>&1
is "$(said)" "Imported 1 mod: File one. Like any mod from outside, it starts off, and waits for your OK if its code can do more than change the page." "opened with TRIF: imported, the iPhone's words"
logged "import: file-one.js as localhost/file-one" >/dev/null || fail "not logged as imported"
i=0; until "$ADB" shell "uiautomator dump /sdcard/u.xml >/dev/null; cat /sdcard/u.xml" | grep -q 'text="File one"'; do
  i=$((i+1)); [ $i -gt 10 ] && fail "the Mods tab doesn't show File one"; sleep 1; done
echo "ok: the Mods tab shows it"

TWO=$(put file-two.js '// ==WebMod==
// @name   File two
// @match  http://localhost/*
// ==/WebMod==
// ==Style==
// { "css": "body { outline: 2px solid red; }" }
// ==/Style==')
BAD=$(put not-a-mod.js 'console.log("no header");')
"$ADB" logcat -c
# (-d too: am grants the data address only; a share sheet grants the stream through its ClipData)
"$ADB" shell am start -a android.intent.action.SEND -t text/javascript -d "$TWO" --eu android.intent.extra.STREAM "$TWO" --grant-read-uri-permission -n $APP/.MainActivity >/dev/null 2>&1
is "$(said)" "Imported 1 mod: File two. Like any mod from outside, it starts off, and waits for your OK if its code can do more than change the page." "shared to TRIF: imported"
"$ADB" logcat -c
"$ADB" shell am start -a android.intent.action.VIEW -t text/javascript -d "$BAD" --grant-read-uri-permission -n $APP/.MainActivity >/dev/null 2>&1
case "$(said)" in "Couldn't import not-a-mod.js: "*) echo "ok: a file that isn't a mod: refused, with why";; *) fail "not a mod: '$(said)'";; esac
"$ADB" shell rm -f /sdcard/Download/file-one.js /sdcard/Download/file-two.js /sdcard/Download/not-a-mod.js

# (a zip: what desktop's "localhost mods" folder becomes when zipped; one mod in a zip inside it)
python3 - "$TMP/localhost mods.zip" <<'PY'
import io, sys, zipfile
inner = io.BytesIO()
with zipfile.ZipFile(inner, 'w') as z: z.writestr('zip-two.js', '// ==WebMod==\n// @name   Zip two\n// @match  http://localhost/*\n// ==/WebMod==\n// ==Style==\n// { "css": "body { color: red; }" }\n// ==/Style==')
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('localhost mods/zip-one.js', '// ==WebMod==\n// @name   Zip one\n// @match  http://localhost/*\n// ==/WebMod==\n// ==Style==\n// { "css": "body { color: blue; }" }\n// ==/Style==')
    z.writestr('__MACOSX/localhost mods/._zip-one.js', 'junk')
    z.writestr('localhost mods/inner.zip', inner.getvalue())
PY
"$ADB" push "$TMP/localhost mods.zip" "/sdcard/Download/localhost-mods.zip" >/dev/null 2>&1
"$ADB" shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/Download/localhost-mods.zip" >/dev/null
i=0; while :; do
  id=$("$ADB" shell content query --uri content://media/external/file --projection _id --where "_display_name=\'localhost-mods.zip\'" | sed -n 's/.*_id=\([0-9]*\).*/\1/p' | tail -1)
  [ -n "$id" ] && break; i=$((i+1)); [ $i -gt 10 ] && fail "the media store didn't take the zip"; sleep 0.5
done
"$ADB" logcat -c
"$ADB" shell am start -a android.intent.action.VIEW -t application/zip -d "content://media/external/file/$id" --grant-read-uri-permission -n $APP/.MainActivity >/dev/null 2>&1
is "$(said)" "Imported 2 mods: Zip one, Zip two. Like any mod from outside, they start off, and each waits for your OK if its own code can do more than change the page." "a zip opened with TRIF: its mods (and the zip's zip's) imported"

b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
panel() { "$ADB" logcat -c; "$ADB" shell am start -n $APP/.MainActivity --es trif.panel "$(b64 "$1")" >/dev/null 2>&1; logged " panel: " | sed "s/.* panel: //"; }
# a message from the Mods tab's page, as its own buttons send it; then its answer (JSON) or "error …"
send() { panel "window.__r = null; window.webkit.messageHandlers.app.postMessage($1).then((v) => { window.__r = JSON.stringify(v); }, (e) => { window.__r = 'error ' + e; }); return 'sent'" >/dev/null; }
answer() {
  i=0; while :; do
    r=$(panel 'return window.__r' | sed -n 's/^{"ok":true,"value":"\(.*\)"}$/\1/p' | sed 's/\\"/"/g')
    [ -n "$r" ] && { echo "$r"; return; }; i=$((i+1)); [ $i -gt 10 ] && return; sleep 0.5
  done
}
ui() { "$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; "$ADB" shell cat /sdcard/ui.xml | tr '>' '\n'; }
tap() {
  b=$(ui | grep -E "$1" | head -1 | sed 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/')
  [ -n "$b" ] || fail "nothing to tap: $1"
  set -- $b; "$ADB" shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
}
top() { "$ADB" shell dumpsys activity activities | grep -m1 -E "topResumedActivity|mResumedActivity" ; }
infront() { i=0; until top | grep -qiE "$1"; do i=$((i+1)); [ $i -gt 10 ] && fail "$2 ($(top))"; sleep 1; done; echo "ok: $2"; }
is "$(panel 'document.getElementById("import-mod").click(); return "clicked"')" '{"ok":true,"value":"clicked"}' "Import mod…"
infront documentsui "Import mod… opens the system's file picker"
"$ADB" shell input keyevent KEYCODE_BACK; sleep 1
# (sent, then the share sheet looked at, then the answer read: reading it brings TRIF to the front again)
send '{ type: "export", id: "localhost/zip-one" }'
logged "share: localhost-zip-one.js" >/dev/null || fail "not shared"
infront "chooser|resolver" "Export opens the share sheet"
"$ADB" shell input keyevent KEYCODE_BACK; sleep 1
is "$(answer)" '{"ok":true,"file":"localhost-zip-one.js"}' "Export: the mod's file, desktop's name"
send '{ type: "exportSite" }'
logged "share: file-one.js, file-two.js, zip-one.js, zip-two.js" >/dev/null || fail "not all shared: $("$ADB" logcat -d -s TRIF | grep share:)"
infront "chooser|resolver" "Export all opens the share sheet with the site's mods"
"$ADB" shell input keyevent KEYCODE_BACK; sleep 1
is "$(answer)" '{"ok":true,"count":4}' "Export all mods for localhost: the page's message"
# (the ⋯ menu's Export all: the same files)
"$ADB" logcat -c
tap 'content-desc="More"'; sleep 1
tap 'text="Export all mods for localhost"'
logged "share: file-one.js, file-two.js, zip-one.js, zip-two.js" >/dev/null || fail "⋯ Export all didn't share"
infront "chooser|resolver" "the ⋯ menu's Export all mods for localhost"
"$ADB" shell input keyevent KEYCODE_BACK; sleep 1
"$ADB" shell rm -f /sdcard/Download/localhost-mods.zip
rm -rf "$TMP"
echo "PASS"
