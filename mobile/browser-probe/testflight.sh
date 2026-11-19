#!/bin/sh
# Archive the app and upload it to App Store Connect for TestFlight, signed with Tim's team (RB8R3JGQST) through the
# Apple account signed in to Xcode on this Mac (no API key). Each upload gets a fresh build number (UTC date+time).
#   sh mobile/browser-probe/testflight.sh
# Needs: Vendor/llama.xcframework (fetch-llama.sh, or a symlink to another worktree's Vendor), the generated files
# (node mobile/prepare.js), and the device lock for the build (devlock.sh take <who>).
set -e
here=$(cd "$(dirname "$0")" && pwd)
build=$(date -u +%Y%m%d%H%M)
archive="$HOME/Library/Developer/Xcode/Archives/$(date +%Y-%m-%d)/TRIF-$build.xcarchive"
out=$(mktemp -d)
cat > "$out/export.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>upload</string>
<key>teamID</key><string>RB8R3JGQST</string>
<key>signingStyle</key><string>automatic</string>
<key>uploadSymbols</key><true/>
<key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST
cd "$here"
xcodebuild -project TrifProbe.xcodeproj -scheme TrifProbe -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$archive" -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$build" archive -quiet
xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$out/export.plist" -exportPath "$out/export" \
  -allowProvisioningUpdates 2>&1 | grep -E "Upload succeeded|EXPORT|error" || true
echo "build $build: $archive"
dwarfdump --uuid "$archive/dSYMs/TrifProbe.app.dSYM" | head -1
