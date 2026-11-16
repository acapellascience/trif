#!/bin/zsh
# llama.cpp's own XCFramework, for the model on this iPhone (LocalLlama.swift): the release the research measured,
# from llama.cpp's GitHub releases, checked against its SHA-256, into Vendor/ (not in git: 67 MB zipped). It has
# slices for iOS devices and macOS, none for the Simulator, so a Simulator build leaves the model out.
#   mobile/browser-probe/fetch-llama.sh          (LLAMA_ZIP=<the zip>: one already downloaded, still checked)
set -e
TAG=b12428
SHA=43d69839495547c9f449698b4ae29070a11b6b21ce71aa392e15bfa0b0128e1d
HERE=${0:A:h}
DEST=$HERE/Vendor
[[ -f $DEST/llama.xcframework/.tag && $(cat $DEST/llama.xcframework/.tag) == $TAG ]] && { echo "llama.xcframework $TAG already in Vendor/"; exit 0; }
TMP=$(mktemp -d)
[[ -n "$LLAMA_ZIP" ]] && cp "$LLAMA_ZIP" $TMP/llama.zip || curl -fsSL -o $TMP/llama.zip "https://github.com/ggml-org/llama.cpp/releases/download/$TAG/llama-$TAG-xcframework.zip"
GOT=$(shasum -a 256 $TMP/llama.zip | cut -d' ' -f1)
[[ $GOT == $SHA ]] || { echo "the download's SHA-256 is $GOT, not $SHA: not used"; rm -rf $TMP; exit 1; }
unzip -q $TMP/llama.zip -d $TMP/x
rm -rf $DEST/llama.xcframework
mkdir -p $DEST
mv $TMP/x/build-apple/llama.xcframework $DEST/
echo $TAG > $DEST/llama.xcframework/.tag
rm -rf $TMP
echo "llama.xcframework $TAG in Vendor/"
