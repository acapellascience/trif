#!/bin/sh
# Installs TRIF @@VERSION@@ on macOS or Linux, with no Node.js needed (docs/NO-NODE.md):
#
#   curl -fsSL <this file's URL> | sh
#   curl -fsSL <this file's URL> | sh -s -- --browser brave      (setup's options after --)
#
# It downloads TRIF's own copy of Node and TRIF's package, checks both against the SHA-256 written below,
# then runs TRIF's setup with that Node, which takes over from there (it keeps the Node in the workspace,
# <home>/runtime, and writes the browser connections and the trif command).
#
# The template is scripts/install.sh in TRIF's repo; scripts/release.js fills in the placeholders for
# each release (installScript) and attaches the result to it. Needs only sh, curl, tar, uname and
# shasum or sha256sum. Everything runs from main, at the end, so a `curl | sh` that's cut off runs nothing.

set -eu

TRIF_VERSION='@@VERSION@@'
PACKAGE_URL='@@PACKAGE_URL@@'
PACKAGE_SHA256='@@PACKAGE_SHA256@@'
NODE_VERSION='@@NODE_VERSION@@'
NODE_BASE='@@NODE_BASE@@'
# <platform> <archive> <sha256>, from helper/runtime.json; .tar.xz before .tar.gz.
NODE_ARCHIVES='
@@NODE_ARCHIVES@@
'

say() { printf '%s\n' "$*" >&2; }
die() { say "TRIF install: $*"; exit 1; }

platform() {
  os=$(uname -s)
  case "$os" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT) die "this installer is for macOS and Linux" ;;
    *) die "there's no TRIF for $os" ;;
  esac
  arch=$(uname -m)
  case "$arch" in
    arm64|aarch64) arch=arm64 ;;
    x86_64|amd64) arch=x64 ;;
    *) die "there's no TRIF for $os on $arch" ;;
  esac
  # (A shell running under Rosetta says x86_64 on an Apple silicon Mac: TRIF's Node is the arm64 one.)
  if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then arch=arm64; fi
  echo "$os-$arch"
}

sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else die "needs shasum or sha256sum to check the downloads"
  fi
}

# Download $1 to $2 and check it's $3.
# (https only, as the helper's updates; plain http only to this computer, for tests)
fetch() {
  case "$1" in
    https://*) proto='=https' ;;
    http://127.0.0.1:*|http://localhost:*) proto='=http' ;;
    *) die "refusing to download $1 (https only)" ;;
  esac
  curl -fsSL --proto "$proto" --proto-redir "$proto" --retry 2 -o "$2" "$1" || die "couldn't download $1"
  got=$(sha256 "$2")
  [ "$got" = "$3" ] || die "the download of $(basename "$1") doesn't match its pinned checksum (got $got); not using it"
}

# The archive for platform $1: .tar.xz where tar can unpack it (macOS always; Linux with xz), else .tar.gz.
pick() {
  xz=no
  case "$1" in darwin-*) xz=yes ;; *) command -v xz >/dev/null 2>&1 && xz=yes ;; esac
  printf '%s\n' "$NODE_ARCHIVES" | while read -r key file sum; do
    [ "$key" = "$1" ] || continue
    case "$file" in *.tar.xz) [ "$xz" = yes ] || continue ;; esac
    echo "$file $sum"
    break
  done
}

main() {
  command -v curl >/dev/null 2>&1 || die "needs curl"
  command -v tar >/dev/null 2>&1 || die "needs tar"
  key=$(platform)
  choice=$(pick "$key")
  [ -n "$choice" ] || die "there's no TRIF for $key"
  file=${choice% *}
  sum=${choice#* }

  tmp=$(mktemp -d "${TMPDIR:-/tmp}/trif-install.XXXXXX") || die "couldn't make a temporary folder"
  trap 'rm -rf "$tmp"' EXIT
  trap 'exit 130' INT TERM

  say "Downloading Node $NODE_VERSION for TRIF…"
  fetch "$NODE_BASE$file" "$tmp/$file" "$sum"
  mkdir "$tmp/node"
  tar -xf "$tmp/$file" -C "$tmp/node" || die "couldn't unpack $file"
  node="$tmp/node/${file%.tar.*}/bin/node"
  [ "$("$node" --version 2>/dev/null || true)" = "v$NODE_VERSION" ] || die "the downloaded Node doesn't run on this computer"

  say "Downloading TRIF $TRIF_VERSION…"
  fetch "$PACKAGE_URL" "$tmp/trif.tgz" "$PACKAGE_SHA256"
  mkdir "$tmp/pkg"
  tar -xzf "$tmp/trif.tgz" -C "$tmp/pkg" || die "couldn't unpack TRIF's package"
  [ -f "$tmp/pkg/package/helper/cli.js" ] || die "TRIF's package has no helper in it"

  # Setup keeps TRIF's Node from the archive just checked (TRIF_RUNTIME_ARCHIVE: no second download).
  # Its input is not this script: under `curl | sh` that's the rest of the download.
  TRIF_RUNTIME_ARCHIVE="$tmp/$file" "$node" "$tmp/pkg/package/helper/cli.js" setup --copy "$@" </dev/null
}

main "$@"
