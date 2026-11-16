# The model on this iPhone (LocalLlama.swift): llama.cpp's framework, from Vendor/ (fetch-llama.sh), in the app
# for a device build. It has no Simulator slice: a Simulator build leaves it out (and the code that uses it).
[ "$PLATFORM_NAME" = "iphoneos" ] || exit 0
FW="$PROJECT_DIR/Vendor/llama.xcframework/ios-arm64/llama.framework"
[ -d "$FW" ] || { echo "error: no llama.xcframework: run mobile/browser-probe/fetch-llama.sh"; exit 1; }
mkdir -p "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH"
rm -rf "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/llama.framework"
cp -R "$FW" "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/"
rm -rf "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/llama.framework/Headers" "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/llama.framework/Modules"
if [ -n "$EXPANDED_CODE_SIGN_IDENTITY" ] && [ "$CODE_SIGNING_ALLOWED" = "YES" ]; then codesign --force --sign "$EXPANDED_CODE_SIGN_IDENTITY" "$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH/llama.framework"; fi
