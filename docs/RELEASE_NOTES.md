First native PJSIP alpha for **macOS Apple Silicon**. This is an experimental prerelease for early testers, not a stable release.

- Native PJSIP 2.17 replaces the custom desktop SIP/media stack.
- SIP over verified TLS, mandatory SDES-SRTP, PCMU/PCMA and RFC 4733 keypad tones.
- One account and one active call, OS credential storage, incoming ringtone, call history, and persistent light/dark themes.
- Existing configured Core public CA included; other private PBXs can import their CA. No PBX changes are performed by the app.

### Installation
Download the aarch64 DMG, open it, and drag Daad to Applications. Fully quit any older Daad process before opening the new app; closing its window may leave it running.

**Unsigned and not notarized:** macOS may block the first launch. After verifying the download, use System Settings → Privacy & Security → Open Anyway if offered. There is no Developer ID signature in this alpha.

### Verification and limitations
Development builds were tested with real Asterisk incoming ringing/audio and outbound two-way audio. Isolated Asterisk tests also verified encrypted echo audio, keypad delivery, invalid credentials/certificate rejection, and teardown. Theme switching was confirmed in the desktop app.

Release CI runs frontend and Rust tests. Those checks do not establish fresh-install microphone permission behavior or packaged mute/hold/resume/audio-after-resume; these remain unverified. Network/VPN recovery and extended call stability need further testing. Use system sound settings to choose audio devices.

No Intel Mac, Windows, Linux, or mobile binaries are offered in this release. The browser UI is not the native calling engine. No new live calls were made as part of publishing.

### Source and license
GPL-3.0-or-later. The source asset includes the exact Daad source, vendored Rust dependencies, frontend package distributions, pinned PJSIP and matching OpenSSL source, notices, and build instructions. SHA256SUMS.txt covers the downloadable assets.
