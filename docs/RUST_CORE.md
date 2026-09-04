# Rust Native SIP Core — Phase 1 (bounded vertical slice)

Owner: Telephony Protocol + Rust Backend Engineer.
Status: implemented, `cargo check` clean (0 errors), `cargo test --lib` green (143 passed / 0 failed / 1 ignored opt-in keyring test, Sep 2026).

## 1. Goal (recap)

Rust owns credentials, TLS, SIP, SDP, RTP/SRTP, audio, registration and
call state. No SIP.js / WebRTC / WSS as primary. Phase 1 is the bounded
vertical slice: profile → keychain → verified TLS → transport lifecycle →
REGISTER/Digest/refresh → account/call state machines → redacted
diagnostics → minimal Tauri commands. Dialog/INVITE/SDP/RTP/SRTP/audio are
being built in parallel by the call/media peer in the same `sip_core/`
namespace (see §7).

## 2. Files created (this phase)

| File | Responsibility |
|---|---|
| `src-tauri/src/sip_core/mod.rs` | Module index (extended jointly with peer; re-exports call/dialog/sdp APIs) |
| `src-tauri/src/sip_core/account.rs` | `SipProfile` (hostname/port/transport/CA/codecs/media), JBM validation: PCMU→PCMA order, mandatory SDES-SRTP, video off, symmetric RTP, numeric 3–8 digit extensions. **No secret fields** (serialization test guards this) |
| `src-tauri/src/sip_core/keystore.rs` | `CredentialStore` trait, `InMemoryStore` (tests), `KeyringStore` via maintained `keyring` v3 (macOS Keychain / Win CredMgr / Linux Secret Service). Never logs secrets; errors carry only account id |
| `src-tauri/src/sip_core/tls.rs` | Fail-closed `rustls` config: system roots + optional PEM deployment CA (parsed via `rustls-pemfile`), strict SNI/IP-SAN derivation, **no accept-all verifier, no insecure flag** (test-gated) |
| `src-tauri/src/sip_core/transport.rs` | Bounded backoff + deterministic jitter, `Generation` stale-transport replacement, `TransportSupervisor` broadcast shutdown (no task/socket leaks), verified `connect_tcp`/`connect_tls` with 10 s budgets |
| `src-tauri/src/sip_core/register.rs` | REGISTER builder (native `transport=` Contact, never `transport=ws`), RFC 7616 MD5 Digest (`md-5` crate, RFC 2617 vector-tested), challenge parse, single-answer handshake over any `AsyncRead+Write` stream, `Expires:0` unregister, `refresh_delay` (85% / −5 s, ≥10 s floor), `RegistrationSupervisor` (exactly one worker/account), `CSeqGen`, response parser |
| `src-tauri/src/sip_core/state.rs` | `AccountState` (Disabled→Connecting→Registering→Registered⇄Refreshing→Reconnecting/AuthFailed/CertFailed/NetUnavailable) and `CallStateNative` with CANCEL/BYE race resolution (`resolve_cancel_race`: 200-seen ⇒ CANCEL void ⇒ BYE required) |
| `src-tauri/src/sip_core/diagnostics.rs` | `sanitize_sip_message` / `sanitize_log`: redacts SIP user parts, IPv4, Call-ID/branch/nonce/tag, full `Authorization`/`WWW-Authenticate`/password headers, SDP `a=crypto` key material. `SanitizedDiagnostics` carries states+counters only |
| `src-tauri/src/lib.rs` (extended) | `CoreState` (profiles, states, workers, supervisors, keychain, CSeq, redacted `status_message`, webview `AppHandle`) + commands below; `CallCoreState` (call manager, `WireTarget` queue, Rust-owned call timing); verified `open_signalling` (TLS w/ deployment CA, TCP); `multiplex_until_refresh` (inbound INVITE/CANCEL/BYE on the registration stream), `drive_establishing` (100/180/183→200+SDP→ACK, mandatory SDES) + `relay_established`; single-account `sip_*` façade; legacy `sip_bridge` commands fail-closed (deprecated insecure arg ignored) |

Contract notes: host/port/transport are per-profile runtime config —
nothing in `sip_core` hardcodes an address (test-gated for the test-core
IP). SIP/TLS verify is mandatory; a `Some(ca_pem)` bundle that parses to
zero certs is a hard error.

## 3. Tauri commands (no secrets cross to the webview)

- `account_upsert(profile, password?)` — validates profile; password goes straight to the OS keychain, never stored/logged/returned. Returns `AccountSummary` (extension masked to `***d`, state as plain string).
- `account_remove(account_id)` — stops worker, best-effort `Expires:0`, deletes profile + keychain entry.
- `register(account_id)` — rejects duplicates (worker map + supervisor guard), spawns `registration_worker` (connect → challenge handshake → refresh loop; cert errors exit fail-closed, network errors back off ×10 then stop).
- `unregister(account_id)` — aborts worker, best-effort `Expires:0`, state → Disabled.
- `registration_status(account_id)` — sanitized summary.
- `diagnostics_export_sanitized(account_id?)` — states + counters only.

## 4. Cargo dependencies added (all maintained)

`rustls-pemfile 2`, `md-5 0.10`, `hex 0.4`, `keyring 3` (this phase).
Peer added for media path: `rtp 0.17`, `webrtc-srtp 0.17`, `webrtc-util 0.17`,
`cpal 0.17`, `rand 0.8`, `base64 0.22`, `thiserror 1`, `ezk-g711 0.2`,
`bytes 1`.

Evaluation (no from-scratch crypto/SIP/media):
- SIP parsing/dialog → peer is building on `rsip`-style minimal handling now, migration target `rsipstack` in Phase 2 (Phase-1 REGISTER builder is intentionally dialog-free and will move onto it).
- Digest MD5 → RustCrypto `md-5`; TLS → `rustls`/`tokio-rustls`; keychain → `keyring`.
- RTP/SRTP → `rtp` + `webrtc-srtp` (peer, implemented); G.711 → `ezk-g711`; audio → `cpal` (peer).
- No custom crypto, no hand-rolled SRTP/codecs anywhere.

## 5. Tests & commands run (evidence)

- `cd src-tauri && cargo check` — clean, 0 errors (warnings: benign `dead_code` on Phase-2 public surface + peer `unused` imports).
- `cd src-tauri && cargo test --lib` — **green, 143 passed / 0 failed / 1 ignored** (`keystore::keyring_roundtrip_opt_in` needs a real keychain; run with `-- --ignored` on a dev machine). Covers: account, keystore, tls, transport (single-flight, generations), register (duplex fake-registrar 401→200 handshake, duplicate-worker rejection), state (CANCEL/BYE races), diagnostics, wire (outbound 100/180/200→ACK→BYE, inbound INVITE→180→200→ACK, CANCEL-missed + late-BYE-481, SRTP-downgrade-488, retransmit dedup, pipelined/split framing), call/sdp/srtp/rtp/audio/dtmf/dialog, native façade (URL/AoR shapes, call-state mapping, socket-vs-registered, failure kinds).
- `bun run test` (repo invariant) — **22 files / 129 tests passed**; `bun run lint` ok; `tsc --noEmit` clean.

## 6. Security implications

- Credentials move from plaintext `localStorage` (`SipContext.tsx STORAGE_KEY`) to the OS keychain; the webview only sends the password once at `account_upsert` and never reads it back. (Follow-up: remove password from `localStorage` entirely once the native login form lands.)
- Legacy bridge hardened (fail-closed): `NoCertVerifier` deleted, `allow_insecure` flag removed from `sip_bridge.rs` — the `start_sip_bridge` command still accepts a deprecated arg for compat but always ignores it (warns when `true` is passed). TLS verifies against system roots on every connection; strict SNI (IP SAN / DNS, no placeholder fallback). A `no_accept_all_verifier` unit test plus the `sip_core` verifier guard pin this. The native `sip_*` path never touches the bridge (owns verified TLS directly in `sip_core`, incl. deployment-CA passthrough via `custom_ca_pem`); the bridge exists only for the legacy WebSocket-compat path, which is default-off behind `DEV_LEGACY_WS` (CI lint fails if enabled in prod builds, if `traceSip: true`, or if the default UI path imports `sipService`).
- Fail-closed everywhere: bad CA ⇒ no connect; unparsable challenge ⇒ no blind retry; second 401 ⇒ `AuthFailed`, not a loop; cert errors never auto-retry; INVITE Digest (401/407) surfaced as failure, never retried blind (Phase-2 item); plain-RTP answers/INVITEs ⇒ 488, never silent downgrade.
- `NativeSipStatus.message` carries redacted per-failure text (set on terminal failures, cleared on enable/accept); call `startTime`/`duration` are Rust-stamped on `Active` (kept across hold, cleared on end).
- Diagnostics and `AccountSummary` are secret-free by construction (tests assert absence of user/IP/branch/call-id/password material).

## 7. Concurrent-work merges (review requested)

A call/media peer built `call/audio/dialog/dtmf/sdp/srtp/rtp` in parallel.
To reach green I applied six minimal, semantics-preserving fixes outside
my files — please review:
1. `lib.rs`: added missing `AppHandle` import (their commands).
2. `rtp.rs`: `util::marshal` → `webrtc_util::marshal`; `pkt.marshal(&mut buf)` → `pkt.marshal()` (webrtc-util 0.17 API).
3. `srtp.rs` test: `crate::rtp` → `crate::sip_core::rtp`.
4. `call.rs` test: `Self::parse_dtmf_helper` → `CallManager::parse_dtmf_helper`.
5. `call.rs` `finish_active`: incoming CANCEL-before-answer now yields `reason="missed"` (their test + docstring already demanded it; dialog's `RemoteCancel` overrode the label).
6. `rtp.rs` `JitterBuffer`: pre-playout reorder window (`started` flag + min-tracking) so out-of-order pre-roll frames aren't dropped as late, while post-start behind-window frames still are.

## 8. Gaps / not done (live-gate only)

- **Live fixture gate [L]**: provision → `sip_register` → `Registered`; invite → `Calling`; answer → `Active`; hold/resume → `Holding`/`Active`; mute gates capture; DTMF `0-9*#`; hangup → `Idle`; devices released (see `docs/ACCEPTANCE.md` items 6–13 against the Asterisk fixture). All sans-io + wire paths are duplex-tested; only on-hardware verification remains.
- UDP signalling: configurable but `open_signalling` returns an honest error (no connected-stream REGISTER path yet).
- Refresh cycle reconnects instead of reusing the TLS connection (correct, slightly wasteful; reuse in a later slice).
- `SipContext.tsx` still stores plaintext password in `localStorage` for the legacy path — migrate to `account_upsert` + native status polling.
- Platforms: verified on macOS (dev). Windows CredMgr / Linux Secret Service paths compile via `keyring` but are **unverified on-device**; keyring round-trip test is `#[ignore]`d for CI.
- `cargo check` dead-code warnings on not-yet-wired public APIs are intentional (remaining public surface, e.g. `wire::run_outbound_invite` kept as the tested sans-io driver alongside the `lib.rs` connection-task binding).
