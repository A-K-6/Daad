# Platform builds

The native engine is PJSIP 2.17 on every target. A successful installer build
is separate from physical microphone, encrypted call and lifecycle acceptance.
The existing macOS alpha remains the only release with user-confirmed live audio
until the new artifacts are built and tested.

| Platform | Targets | Artifact |
| --- | --- | --- |
| macOS 11+ | Apple Silicon, Intel | DMG |
| Windows | x64, ARM64 | NSIS installer |
| Linux | x64, ARM64 | Debian package, AppImage |
| Android 7+ | ARM64, ARMv7, x64 emulator | Development APK |
| iPhone / iPad, iOS 14+ | ARM64 | Signing required for device distribution |
| iOS Simulator | Apple Silicon (Intel can be built locally) | Simulator app |

`.github/workflows/platforms.yml` builds each target independently. Artifacts
remain CI development builds until a release includes corresponding source and
checksums. Android development APKs use a debug signing key; they are not Play
Store releases and should not be used for production accounts. Simulator apps
cannot be installed on iPhones. No background-call or push-notification support
is claimed for this mobile alpha; keep the app in the foreground.

## Native preparation

Run `bun install --frozen-lockfile`, then `bun run native:prepare <target-triple>`.
Omit the target for the Rust host. See `scripts/native-targets.ts` for the exact
supported triples. Each triple has its own `src-tauri/target/native/<triple>`
directory so device, simulator and host libraries cannot be mixed.

The script downloads checksum-pinned PJSIP 2.17 and OpenSSL 3.6.3 source and
builds static libraries. Public TLS roots are bundled from the locked
webpki-root-certs crate; private PBX CAs must be imported explicitly. OS-added
private roots are not implicitly trusted by the bundled OpenSSL. Cargo never downloads native engine source. Source
archives are cached in `src-tauri/target/native/downloads` and can be supplied
offline from the corresponding-source release. Delete a target directory to
force a clean native rebuild. `DAAD_PJSIP_PREFIX` can select a prepared install.

macOS needs Xcode and pkg-config. Build with
`bun run tauri build --target x86_64-apple-darwin` (or `aarch64-apple-darwin`).

Linux needs a runner matching the CPU, a C/C++ toolchain, Perl, pkg-config,
ALSA, WebKitGTK 4.1, AppIndicator, librsvg, patchelf and D-Bus development
packages. Build with the matching `*-unknown-linux-gnu` target.

Windows needs Visual Studio 2022 C++ tools, Windows SDK, Perl, MSBuild and
Rust's MSVC target. Use the x64 developer shell for x64 or x64-to-ARM64
cross tools for ARM64. Run native preparation, then
`bun run tauri build --target <target> --bundles nsis`.

## Android

Install JDK 17, Android SDK 36 and NDK r28 or newer. Set `ANDROID_HOME`,
`ANDROID_NDK_HOME` and `NDK_HOME`. Install the Rust target, prepare it, then run:

```sh
bun run tauri android init --ci
bun run tauri android build --debug --apk --target aarch64
```

Use `armv7` or `x86_64` for the other Android targets. The plugin manifest supplies
microphone and audio permissions. Permission must be granted before registering;
credentials are encrypted with Android Keystore, never a mock keyring or plaintext
preferences. A lost/unavailable key must produce a sign-in error.

Public Android distribution still needs a stable release signing key and
physical-device acceptance. Do not publish an unsigned APK as installable.

## iPhone and iPad

Install Xcode, CocoaPods, xcodegen and the appropriate Rust target. Prepare
`aarch64-apple-ios` for devices or `aarch64-apple-ios-sim` for Apple Silicon
simulators, then run `bun run tauri ios init --ci`.

For simulator builds use `bun run tauri ios build --debug --target aarch64-sim`.
For device builds set `APPLE_DEVELOPMENT_TEAM` and install the team's signing
certificate/provisioning profile, then use `bun run tauri ios build --target aarch64`.
Use TestFlight or provisioned devices; a simulator ZIP is not an iPhone download.
Never commit signing keys or passwords.

Before calling a platform verified, test fresh-install microphone permission,
account save/restart/delete, TLS rejection for untrusted servers, encrypted
incoming/outgoing audio, mute/hold/resume, teardown, and suspend/network recovery.
