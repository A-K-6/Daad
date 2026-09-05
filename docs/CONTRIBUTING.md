# Contributing to Daad

Daad is a small native softphone. The current scope is one SIP account and one active call. Small, focused fixes are welcome; discuss new calling features in an issue before implementing them.

## Start locally

On macOS Apple Silicon, install Xcode command-line tools, Rust, and Bun, then:

```sh
brew install openssl@3 pkg-config
git clone https://github.com/A-K-6/Daad.git
cd Daad
bun install --frozen-lockfile
bun run native:prepare
bun run tauri dev
```

PJSIP owns SIP transactions, codecs, RTP/SRTP, and native audio devices. Rust handles account storage, commands, and events. React subscribes through SipContext. Do not implement another SIP/media engine in Rust or TypeScript. Use `@/` imports and Bun for frontend commands.

## Before opening a pull request

```sh
bun run typecheck
bun run lint
bun run test
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Include a regression test for behavioral fixes and screenshots for visible UI changes. For telephony changes, run `bun run test:native` against a disposable local Asterisk. That test uses generated audio and does not replace physical microphone/speaker testing. Never point fixtures at a live PBX or dial a real number without its owner's permission.

Describe what changed, why, and exactly what you tested. Keep unrelated formatting and dependency updates out of the patch. Preserve both light and dark themes. Contributions are distributed under GPL-3.0-or-later; retain third-party notices.

## Useful first contributions

See [the contributor backlog](COMMUNITY.md#contributor-backlog) and the repository's `good first issue` label. Start with a small documentation or test improvement. Use synthetic extensions and `pbx.example.com`; never submit passwords, private deployment defaults, phone numbers, or raw SIP captures.
