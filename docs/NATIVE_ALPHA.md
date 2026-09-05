# Native alpha 0.6.0-alpha.1

The desktop app uses PJSIP 2.17 for SIP transactions, native audio devices,
G.711 audio, and mandatory SDES-SRTP. The former custom Rust SIP/media stack
has been removed. The React interface calls a single native command adapter.
Legacy browser/SDK code remains separate and is not evidence of native calling.

## Build and run

On macOS, install OpenSSL 3 and pkg-config with Homebrew, then run:

```sh
bun install
bun run native:prepare
bun run typecheck
bun run test
cargo test --manifest-path src-tauri/Cargo.toml
bun run tauri build --debug --bundles app
```

`native:prepare` downloads the pinned PJSIP source archive, verifies its hash,
and builds the native dependencies. See `THIRD_PARTY_NOTICES.md` for licensing
and source requirements. This preparation script currently supports macOS and
Linux; Windows and mobile packaging have not been completed for this alpha.

## Connect

Enter the TLS server address, SIP username, and password. The SIP address is
derived automatically. Advanced settings allow an extension, explicit SIP
address, and custom CA. Credentials are kept in the native OS credential store.
On subsequent launches the app restores the account and registers automatically.

For Core at `10.41.113.71:5061`, the existing public master CA is bundled and
selected automatically. Leave Custom CA empty. VPN access is still required.
See `src-tauri/certificates/README.md` for provenance and fingerprint. This
client change does not modify Core's configuration or certificates.

## Evidence and remaining verification

On 2026-09-05, the rebuilt macOS app restored the supplied account and displayed
TLS verified. A read-only Core query confirmed a `guest-2001` TLS contact.
The subsequent live test exposed a macOS VoiceProcessingIO stall during
ringtone startup. The adapter now uses PJSIP software echo cancellation.
After rebuilding, Daad showed the incoming call; it was answered and ARI
reported completed voice playback. The user confirmed both ringtone and voice
were clear. Core then had no active channels. The exact temporary media-cache
entry, local audio server, and SSH forwarding sessions were cleaned up.
No Core configuration or certificate changes were made, and no PSTN call was placed.

`bun run test:native` runs isolated Asterisk tests with synthetic credentials:
outgoing/incoming calls, returned 997 Hz audio, active SRTP, rejected invalid
credentials/untrusted CA, and server-side cleanup. It does not call a live PBX.
Set `DAAD_ASTERISK_IMAGE` to select a locally available Asterisk image.

The isolated acceptance run passed on 2026-09-05 with
`DAAD_ASTERISK_IMAGE=secure-ari-asterisk:local`: outgoing and incoming encrypted
echo audio, RFC 4733 keypad delivery (Asterisk exits Echo on `#`), bad-password rejection, an explicit untrusted-certificate event,
and zero test contacts/channels after teardown. The machine-readable result is
`src-tauri/target/native-acceptance.json`. These results use a generated tone and
null audio device; they do not prove physical microphone/speaker behavior.

The user subsequently fixed Core routing independently and confirmed a live
outgoing call with clear audio in both directions, including the Mac microphone.
Incoming ringing, speaker audio, and that outgoing call are now verified.
Final packaged-app mute/hold/resume and restart checks remain separate.
PSTN testing additionally requires an approved destination and charge approval.
An alpha binary has been built locally; no release has been published.
