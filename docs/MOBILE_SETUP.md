# Android setup for Daad 0.7

The Android app uses the same PJSIP 2.17 C adapter as desktop. The website and
browser preview are not an Android SIP engine. iOS is excluded from v0.7.0.

Install Java 17, Android SDK command-line tools/platforms/build tools, and NDK
r27 or newer. Set JAVA_HOME, ANDROID_HOME, and NDK_HOME. Install the Rust target
with `rustup target add aarch64-linux-android`.

```sh
bun install --frozen-lockfile
bun run native:prepare --target aarch64-linux-android
bun run android:prepare
bun run android:build
```

The native script builds pinned, hash-verified PJSIP and matching OpenSSL for
Android. Host libraries are never linked into the APK. Native outputs and Rust
linking use 16 KB page alignment. `android:prepare` generates the Tauri shell,
disables backup of device-bound encrypted accounts, and adds environment-based
release signing. The local Android platform plugin supplies permissions,
Android Keystore account encryption, system trust roots, and a foreground service.

For signed builds set DAAD_ANDROID_KEYSTORE to an absolute keystore path and
provide ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS and ANDROID_KEY_PASSWORD
through the environment. Never commit the keystore or secrets. GitHub release
builds use the repository's existing Android signing secrets; a tagged release
fails if signing is unavailable.

Allow microphone and notification permission. Connect while Daad is open so
Android can start its microphone foreground service. Background incoming-call
notifications reopen the call UI. Force-stop or process death requires reopening
Daad; push delivery and Android Telecom/lock-screen integration are not provided.
Test background/locked-screen audio on actual devices before relying on it.

Artifacts: APK for sideload installation and AAB for a future Play submission.
Building an AAB does not publish an app to Google Play. Acceptance requirements
are listed in [RELEASE_0_7.md](RELEASE_0_7.md).
