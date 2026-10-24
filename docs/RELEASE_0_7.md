# Daad 0.7.0 release acceptance

Scope agreed on 2026-10-24: basic call handling and downloadable macOS Apple
Silicon, Linux x64, Windows x64, and Android arm64 builds. iOS is excluded.
The tag is `v0.7.0`; publish it as a validation prerelease while platform
acceptance is still being collected.

## Required build artifacts

The cross-platform workflow must produce every artifact before a tag is
published: macOS DMG, Linux DEB and AppImage, Windows NSIS installer, signed
Android APK and AAB, corresponding source archive, and SHA256SUMS.txt.
A pull request or manual workflow run validates builds without creating a tag.
Missing platform builds or Android signing material block tagged publication.

## Basic behavior

- [ ] Clean installation and microphone permission on each platform.
- [ ] Verified TLS registration with system roots and an explicit private CA.
- [ ] Invalid password/untrusted CA fails with actionable guidance.
- [ ] Incoming/outgoing ringing, answer/reject, two-way physical audio.
- [ ] Mute/unmute, hold/resume, RFC 4733 keypad, either-party hangup.
- [ ] A longer call and repeated calls without leaked channels or stuck UI.
- [ ] Account restoration and automatic registration after a full restart.
- [ ] Recovery after network/VPN changes and sleep/wake.
- [ ] Headset/default audio-device changes and audio after resume.
- [ ] Incoming call while the desktop window is hidden/minimized.
- [ ] Android permissions, notification, foreground service, background call.
- [ ] Android encrypted account restoration and logout removal.
- [ ] Installation over the previous version and a consistent Android signing key.

Automated frontend and Rust checks cover contracts, not physical audio.
The disposable Asterisk test exercises the same C adapter using null audio,
including encrypted tone echo, controls, IP-change re-registration, DTMF,
negative credentials/CA, and teardown. A passing recovery scenario is an
explicit local IP-change refresh; it does not prove every VPN/suspend condition.
Record each platform/OS/build result separately. Never mark an unchecked item
complete based only on another platform or the historical custom SIP core.

## Distribution boundaries

Android's microphone foreground service keeps an already-running process
available while the app is backgrounded and provides a notification to reopen
an incoming call. It does not implement push calling, Telecom integration, or
relaunch after force-stop/process death. These scenarios need device acceptance;
no background-delivery guarantee is made.
Desktop audio uses the system microphone/speaker selection. macOS and Windows
signing/notarization are separate from Android APK signing. Describe any unsigned
desktop download explicitly. Android APK sideloading is the initial delivery;
an AAB alone does not establish Google Play publication.
