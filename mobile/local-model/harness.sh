#!/bin/zsh
# Builds the Mac harness (harness/main.swift with the app's LocalLlama.swift and LocalPrompt.swift) against llama.cpp's
# macOS slice, as fetched by mobile/browser-probe/fetch-llama.sh, and runs it with the arguments given.
#   mobile/local-model/harness.sh <model.gguf> <page> <styleJSON|file> "<what I want>" [runs]
set -e
HERE=${0:A:h}
FW=$HERE/../browser-probe/Vendor/llama.xcframework/macos-arm64_x86_64
[[ -d $FW ]] || { echo "no llama.xcframework: run mobile/browser-probe/fetch-llama.sh"; exit 1; }
OUT=${TMPDIR:-/tmp}/trif-local-harness
xcrun swiftc -O -F $FW -framework llama -Xlinker -rpath -Xlinker $FW \
  $HERE/../browser-probe/TrifProbe/LocalLlama.swift $HERE/../browser-probe/TrifProbe/LocalPrompt.swift $HERE/harness/main.swift -o $OUT
$OUT "$@"
