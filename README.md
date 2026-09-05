# Daad • داد

A small native desktop softphone built with Tauri, React, and PJSIP.

**0.6.0-alpha.1 is an experimental macOS Apple Silicon prerelease.** The macOS app has registered
with the configured Asterisk Core over verified TLS. Isolated Asterisk tests
verify incoming/outgoing encrypted echo audio and cleanup. Live incoming ringing
and speaker audio were confirmed by the user. After their Core routing fix,
the user also confirmed an outgoing call with clear audio in both directions. See
[the native alpha notes](docs/NATIVE_ALPHA.md) for evidence and limitations.

## Connect

Enter your server (for example `tls://pbx.example.com:5061`), SIP username, and
password. Daad derives the SIP address and saves the account in the operating
system credential store. It reconnects using that account on subsequent launches.

Advanced settings provide a custom SIP address, extension, and CA import. The
existing public CA for the configured Core is selected automatically; see
[certificate provenance](src-tauri/certificates/README.md). The app does not
change PBX configuration or automatically trust arbitrary server certificates.

The desktop audio path uses native devices, PCMU/PCMA, mandatory SDES-SRTP,
and RFC 4733 DTMF. Use the system sound settings to select the microphone and
speaker. The compact call screen has answer/reject, mute, hold, keypad, and hangup.

## Develop

Use Bun for JavaScript dependencies and commands. On macOS, install the Xcode
command-line tools, Rust, Bun, OpenSSL 3, and pkg-config:

```sh
brew install openssl@3 pkg-config
bun install
bun run native:prepare
bun run tauri dev
```

`native:prepare` builds the checksum-pinned PJSIP source locally. Cargo does
not download or build an unpinned telephony engine behind the scenes.

```sh
bun run typecheck
bun run lint
bun run test
cargo test --manifest-path src-tauri/Cargo.toml
bun run tauri build --debug --bundles app
```

The native preparation script supports macOS and Linux. Linux also needs the
Tauri, ALSA, OpenSSL, and D-Bus development packages. Windows and mobile native
packaging are not implemented for this alpha. Older published binaries are not
this native alpha.

## Verify calls locally

With Docker running and native dependencies prepared:

```sh
bun run test:native
```

The test creates a disposable localhost Asterisk with synthetic credentials,
checks returned tone audio over SRTP, rejects invalid passwords and untrusted
certificates, and verifies call/registration cleanup. It writes a result to
`src-tauri/target/native-acceptance.json` and removes the test container. Set
`DAAD_ASTERISK_IMAGE` to use another locally available Asterisk image.

These tests never target the configured live PBX or dial PSTN numbers. A null
audio device and generated tone make the network test repeatable; a separate
physical microphone/speaker test is still necessary.

## Architecture

The desktop path is:

```text
React views → SipContext → NativeSipClient → Tauri IPC
    → Rust command thread → PJSUA/PJSIP → SIP/TLS + native SRTP audio
```

PJSIP owns authentication, transactions, registration refresh, codecs, media
transport, device I/O, and echo cancellation. Rust owns command serialization,
secure account storage, and UI events. The former custom SIP/media stack has
been removed. Legacy browser/SDK code remains in the repository and is separate
from this desktop engine; older WebRTC guides describe that legacy path.

## License

[GPL-3.0-or-later](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md)
for the native dependencies and source distribution requirements.
