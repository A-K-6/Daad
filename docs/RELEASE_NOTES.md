Native PJSIP alpha for macOS (Apple Silicon and Intel), Windows (x64 and ARM64),
and Linux (x64 and ARM64). This is experimental software for early testers.

- Same PJSIP 2.17 SIP/media engine on all targets; verified TLS and mandatory SDES-SRTP.
- Target-specific static OpenSSL builds and bundled public TLS roots. Import a private PBX CA explicitly.
- One account, one call, secure OS credential storage, ringtone and call history.
- Mobile build integration includes microphone permission and Android Keystore/iOS Keychain.

### Downloads

Choose the DMG matching your Mac, the Windows NSIS installer matching your CPU,
or the Linux Debian package/AppImage matching your CPU. Desktop packages are
unsigned; macOS packages are not notarized.

Android development APKs and iOS simulator builds are CI test artifacts, not
public mobile releases. Android release signing and Apple Developer signing,
plus physical-device acceptance, are still required before mobile distribution.
A simulator app cannot be installed on an iPhone.

### Verification limits

The original Apple Silicon development build has user-confirmed incoming ringing
and outgoing two-way audio. Builds/tests on other platforms do not establish
microphone, permission, mute/hold, network recovery or background-call behavior.
Keep mobile experiments in the foreground. See docs/PLATFORMS.md for the exact
build and acceptance requirements.

### Source and license

GPL-3.0-or-later. The source asset contains exact Daad source, vendored Rust
sources, frontend package distributions, PJSIP and OpenSSL source, notices and
build instructions. SHA256SUMS.txt covers every release asset.
