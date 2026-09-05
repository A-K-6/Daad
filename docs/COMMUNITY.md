# Community launch kit

## Announcement draft

**Daad: a minimal open-source native softphone for macOS (early alpha)**

I'm building Daad because I wanted a small, straightforward native softphone: one SIP account, one active call, and a keypad that stays out of the way.

It uses Tauri and PJSIP, is GPL-3.0-or-later, and supports verified SIP/TLS, SDES-SRTP, G.711 audio, and RFC 4733 keypad tones. Incoming audio and outbound two-way calls have been tested with Asterisk. The current download is for macOS Apple Silicon.

This is an early, unsigned alpha. Fresh-install microphone permissions, hold/resume, network recovery, and longer calls need more testing. I'm especially interested in reports from people using their own Asterisk setups, and small contributions to accessibility, setup guidance, and tests.

Source and setup: https://github.com/A-K-6/Daad
Downloads: https://github.com/A-K-6/Daad/releases/latest

What usually makes a softphone frustrating for you? If you try it, please file a sanitized bug report with your OS, Daad/PBX versions, and reproducible steps—no credentials or raw SIP captures.

This text is a draft for the maintainer to post. Check each community's current self-promotion rules before posting; disclose that you are the author. Do not post the same message repeatedly.

## Visuals and demo

`media/ui-walkthrough.gif` is a short, explicitly labeled UI walkthrough using the real React views with synthetic props. It demonstrates setup, keypad, incoming-call, outgoing-call, and active-call layouts. It does **not** show real registration, media, or a successful test call. An MP4 copy is available as `media/ui-walkthrough.mp4`. The PNG frames are suitable for README screenshots with the same label.

To reproduce: `bun run build && bun scripts/render-community.tsx`. The static pages are written to `build/community-preview`; they contain no SIP client or credentials. Render them with a fresh browser profile at 408×720, then assemble the five frames at three seconds each. Do not capture your configured desktop account.

### Recording a real 30-second calling demo

1. Use a disposable local PBX with synthetic extensions 1001 and 2002 and its test CA. Never show a real password, IP address, contact list, or call history.
2. Record registration and the verified-TLS status (about 5 seconds).
3. Call 1001 from the second test client; show ringing and answer. Speak a brief test phrase (about 10 seconds).
4. Hang up; dial 2002 from Daad and answer on the test client. Speak in both directions (about 10 seconds).
5. Hang up and show Idle. Confirm the PBX has no test channels left (about 5 seconds).

Keep the UI walkthrough labeled until this real recording exists. A successful screenshot is not evidence of registration or audio.

## Contributor backlog

Small, independently reviewable tasks:

1. **[Document a fresh macOS installation (#1)](https://github.com/A-K-6/Daad/issues/1).** Use a clean user account or machine; record OS/architecture, download verification, launch warning, microphone prompt, and account restoration. Use synthetic data. Deliver a repeatable checklist and distinguish results from assumptions.
2. **[Audit keyboard access in the simple call UI (#2)](https://github.com/A-K-6/Daad/issues/2).** Check tab order, visible focus, accessible names, Enter/Escape behavior, and both themes. Fix only demonstrated issues; include focused component tests. Do not change telephony commands.
3. **[Add regression coverage for private-CA provisioning (#3)](https://github.com/A-K-6/Daad/issues/3).** Test file import, malformed PEM guidance, and preservation of existing form values. Use a fixture CA, never a deployment certificate. Keep verification enabled; do not add a bypass.

Broader work such as Linux packaging, transfer, multiple accounts, or a new codec needs a design discussion first.
