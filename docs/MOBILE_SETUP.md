# Mobile Setup Guide • iOS & Android • Daad

Daad is engineered on **Tauri v2**, providing first-class native compilation and packaging for both **iOS** and **Android** alongside desktop operating systems.

---

## ⚡ Option 1: Instant Mobile Testing (Zero Install)

You can run and test Daad on any physical iPhone or Android device immediately over your local Wi-Fi without compiling native mobile projects:

```bash
# Start local HTTPS dev server
bun run dev:phone
```

1. Look at the terminal output for the local network URL:
   ```
   ➜  Network: https://192.168.1.X:1420/
   ```
2. Connect your iPhone or Android phone to the same Wi-Fi.
3. Open the URL in Safari (iOS) or Chrome (Android).
4. Tap "Allow" for microphone permissions when placing a call.

---

## 🍏 Option 2: Native iOS App (Xcode / iPhone / iPad)

### Prerequisites
- macOS host with **Xcode** (15+) installed (`xcode-select --install`)
- iOS Simulator or physical iPhone/iPad with Developer Mode enabled
- Rust iOS targets:
  ```bash
  rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim
  ```

### Initialize & Run iOS:
```bash
# 1. Initialize Xcode project structure
bun run ios:init

# 2. Run on iOS Simulator or connected iPhone
bun run ios:dev

# 3. Build release iOS bundle / IPA
bun run ios:build
```

---

## 🤖 Option 3: Native Android App (Android Studio / APK / AAB)

### Prerequisites
- **Android Studio** with Android SDK, NDK, and CMake installed
- Set environment variables (`~/.zshrc` or `~/.bashrc`):
  ```bash
  export ANDROID_HOME="$HOME/Library/Android/sdk"
  export NDK_HOME="$ANDROID_HOME/ndk/<version>"
  ```
- Rust Android targets:
  ```bash
  rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
  ```

### Initialize & Run Android:
```bash
# 1. Initialize Android project structure
bun run android:init

# 2. Run on connected Android device or Emulator
bun run android:dev

# 3. Build production APK or Google Play App Bundle (AAB)
bun run android:build
```

---

## 🔒 Mobile Permissions

Daad pre-configures hardware permissions required for telephony:
- **iOS (`Info.plist`):** `NSMicrophoneUsageDescription`
- **Android (`AndroidManifest.xml`):**
  - `android.permission.INTERNET`
  - `android.permission.RECORD_AUDIO`
  - `android.permission.MODIFY_AUDIO_SETTINGS`
