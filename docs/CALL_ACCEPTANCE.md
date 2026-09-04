# Call Acceptance — Native Rust Media + Call Lifecycle (`sip_*` façade)

Scope: the Tauri commands in `src-tauri/src/lib.rs` (`sip_*`) that satisfy
`src/services/nativeSipClient.ts`, backed by `src-tauri/src/sip_core/`
(dialog, SDP, RTP, SRTP, cpal audio, RFC 4733 DTMF, call manager).
Product-level fixture flows (Asterisk, 2-way audio on hardware) stay in
`docs/ACCEPTANCE.md`; this file is the native-contract acceptance record.

## 1. Command contract (`nativeSipClient.ts` ↔ `lib.rs`)

| Frontend call | Tauri command (args) | Backend behavior |
|---|---|---|
| `accountUpsert` | `sip_account_upsert {server_url, sip_uri, username, password, display_name?, register_expires?, custom_ca_pem?}` | Parses URL → `(transport, host, port)`; parses AoR; enforces `sipUri` user == `username`; builds JBM `SipProfile` (PCMU→PCMA, SDES-SRTP, no video, symmetric RTP); password → OS keychain only; optional deployment-CA PEM validated (empty = system roots only, still verified fail-closed) |
| `accountRemove` | `sip_account_remove {}` | Logout-teardown of calls (media released) → best-effort `Expires: 0` → profile + keychain entry dropped |
| `register` | `sip_register {}` | Single-flight registration worker (shared with legacy `register`); duplicate worker rejected |
| `unregister` | `sip_unregister {}` | Aborts worker + best-effort `Expires: 0`, state → `Disabled` |
| `getStatus` | `sip_status {}` → `NativeSipStatus` | Redacted snapshot incl. per-failure `message` (set on terminal failures, cleared on enable/accept); also re-emitted on `sip://connection-state` |
| `invite` | `sip_call_invite {target}` | Numeric-only validation → `CallManager::invite` → real verified-TLS send; driver folds 100/180/183, answers 200+SDP with ACK (mandatory SDES negotiation, cpal audio start), maps 3xx–6xx to teardown; emits `sip://call-state` with Rust-stamped `startTime`/`duration` |
| `answer` / `reject` / `hangup` | `sip_call_answer` / `sip_call_reject` / `sip_call_hangup` | Incoming-answer (200+SDP), decline (`603`; `486` reserved for auto-busy), CANCEL-pre-200 / BYE-post-ACK — texts routed on the dialog's stream (incoming leg: registration stream; outgoing leg: call stream); CANCEL/BYE races serialized (first wins) |
| `setMuted` | `sip_call_mute {muted}` | Capture gate; emits updated `isMuted` in call info |
| `setHeld` | `sip_call_hold {held}` | Hold/resume via re-INVITE `sendonly`/`sendrecv`; `Holding` state |
| `sendDtmf` | `sip_call_dtmf {tone}` | RFC 4733 telephone-event payload (established calls only) |
| `setAudioRoute` | `sip_audio_route {route}` | `earpiece\|speaker\|bluetooth\|system` → native route (`system` → default `Speaker`, documented) |
| `exportDiagnostics` | `sip_diagnostics_export {}` → secret-free snapshot | State names + counters only (no URIs, IPs, SDP, keys) |

Events: `sip://connection-state` (`NativeSipStatus`), `sip://call-state`
(`{state, info}`), `sip://cert-status` (trust string). Background
registration workers push status via the `AppHandle` stored in `setup()`;
call snapshots are emitted by every mutating call command. The legacy
`daad-call-event` stream is still emitted for compat.

## 2. JBM profile enforcement (where)

- **Mandatory SDES-SRTP**: inbound plain-RTP INVITE → `488`; outbound
  answers without crypto rejected (`call.rs`, `srtp.rs::require_sdes`).
- **Codec order PCMU, PCMA** (`account.rs` validate; `sdp.rs` offer).
- **Numeric extensions only** (3–8 ASCII digits; single rule in
  `account.rs`, reused by frontend `validateDialTarget` and `invite`).
- **No URI/PSTN fallback** (`validate_extension` rejects `sip:`, `+`, `;`,
  spaces; `parse_server_url` rejects `wss://`).
- **Video disabled, symmetric RTP** (`MediaPolicy` validation).
- **Lifecycle**: INVITE/100/180/183/200/ACK/CANCEL/BYE, busy(486) /
  decline(603) / missed mapping, duplicate-INVITE dedup per
  (Call-ID, CSeq, branch), CANCEL/BYE race serialization (first wins),
  teardown on BYE/CANCEL/failure/logout/suspend releases cpal devices.
- **No secrets to webview/logs**: keychain-only passwords, `Debug`
  redaction + zeroize on `SrtpKeys`, `sanitize_log` on every error path
  crossing to the frontend, `SanitizedDiagnostics` shape only.

## 3. Acceptance checklist

- [x] `cargo test --lib` green — **143 passed / 0 failed / 1 ignored** (Sep 2026): duplex fake-registrar 401→200 handshake (`register.rs`), outbound 100/180/200→ACK→BYE + inbound INVITE→180→200→ACK over `duplex` (`wire.rs`), CANCEL-before-answer (missed) + late-BYE-481 + double-BYE-481, plain-RTP INVITE/answer ⇒ 488 (never downgraded), retransmit dedup, CANCEL/BYE race resolution (`state.rs`), SRTP/SDP/RTP/audio/DTMF/dialog suites, duplicate-worker rejection (`RegistrationSupervisor`, `SingleFlight`), plus 5 `native_facade_tests` (URL shapes, AoR shapes, full call-state mapping, socket-vs-registered separation, auth failureKind).
- [x] `cargo check` clean — **0 errors** (remaining warnings pre-date this slice: not-yet-wired public surface + legacy bridge).
- [x] `sip_status.registered` is true only after registrar `200 OK`
  (socket-open `Registering` never reads as `Registered` — test-pinned).
- [x] No `MutexGuard` held across any await in new commands (guards are
  statement-scoped; profiles cloned out before network I/O; single-flight
  worker map + supervisor guard).
- [x] Wire transport binding landed: outbound INVITE/ACK/CANCEL/BYE driven on the verified TLS/TCP call stream (`drive_establishing` + `relay_established` in `lib.rs`, sans-io core in `wire.rs`); inbound INVITE/CANCEL/BYE/ACK multiplexed on the registration stream (`multiplex_until_refresh` → `sip://call-state` `incoming_ringing`); re-INVITE hold/resume + BYE routed per-dialog via the `WireTarget` queue.
- [x] Custom CA through `sip_account_upsert` (`custom_ca_pem` validated as a PEM bundle, wired into `connect_tls`; `None`/empty = system roots only, always verified fail-closed).
- [x] `NativeSipStatus.message` carries redacted failure text (terminal failures set it, enable/accept clears it); `mic`/`generic` kinds remain frontend-detected and are never set natively.
- [x] Call timing Rust-owned: `startTime` stamped on `Active` (kept across hold), `duration` derived, cleared on end.
- [x] Legacy bridge fail-closed: `NoCertVerifier` deleted, insecure-skip flag removed (deprecated arg ignored), `traceSip: false` pinned, legacy sip.js path default-off behind `DEV_LEGACY_WS` with CI lint failing prod enablement; native `sip_*` path never touches the bridge.
- [x] Frontend untouched: `bun run test` **22 files / 129 passed**, `bun run lint` ok, `tsc --noEmit` clean (Sep 2026).
- [ ] **Live [L]**: provision → `sip_register` → `Registered`; invite →
  `Calling`; answer → `Active`; hold/resume → `Holding`/`Active`; mute
  gates capture; DTMF `0-9*#`; hangup → `Idle`; devices released
  (see `docs/ACCEPTANCE.md` items 6–13 against the Asterisk fixture).

## 4. Known gaps (live-gate only)

1. **Live fixture verification [L]** — the only item left: two-client live
   calls against the Asterisk fixture (`docs/ACCEPTANCE.md` items 6–13).
   All signalling paths are duplex-tested in-tree; only on-hardware proof
   remains.
2. **Bare IPv6 must be bracketed** (`tls://[fd00::1]`); bare `::1` is
   rejected rather than misparsed as host+port.
