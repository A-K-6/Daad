Daad 0.7.0 is a cross-platform validation release for macOS Apple Silicon,
Linux x64, Windows x64, and Android arm64. iOS is outside this release.

- One SIP account and one active call, using PJSIP 2.17 for signaling and media.
- Verified SIP/TLS, mandatory SDES-SRTP, G.711, and RFC 4733 keypad tones.
- Immediate dialing, answer/reject, hangup, and keypad errors appear in the UI.
- Sanitized diagnostics preserve bounded native engine, SRTP, and call-state evidence.
- PJSIP handles re-registration/media refresh on network-online events and after
  the native polling thread resumes from a prolonged pause.
- Android uses encrypted account storage backed by Android Keystore, runtime
  microphone permissions, and a microphone foreground service with call notifications.

Download the package matching your platform and compare it with SHA256SUMS.txt.
Android APKs use the configured release signing key. Desktop packages may be
unsigned; macOS notarization and Windows code signing are not included yet.

This is a validation prerelease. Build checks and synthetic Asterisk audio do
not establish physical-device audio, all network recovery cases, or Android
background call delivery. See docs/RELEASE_0_7.md for the acceptance checklist.
Android requires reopening after force-stop/process death; push calling and
Telecom integration are not included.
Use your own compatible PBX and obtain its CA certificate from its administrator.

GPL-3.0-or-later. Corresponding source and dependency notices accompany the
binaries. The browser preview does not provide native calling.
