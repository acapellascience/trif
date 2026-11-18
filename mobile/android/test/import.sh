#!/bin/sh
# Emulator test of a mod file (.js) opened with TRIF and shared to it (SEND; SEND_MULTIPLE isn't sendable from am) (iPhone's importFiles): imported, off at
# first (as any mod from outside), the iPhone's words said, the Mods tab shown with it. A file that isn't a mod is
# refused with its reason. The file goes through Android's media store (content://media/…), as a file app's would.
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
rm -rf "$TMP"
echo "PASS"
