# Call Power Features — native SIP core slice

Owner: Rust Telephony Engineer. Branch: `feat/native-rewrite-wip`.
Scope: protocol truth in `src-tauri/src/sip_core/` + `sip_*` facade in
`src-tauri/src/lib.rs`. **No frontend changes** — UI subscribes separately
to the events below.

Protocol truth first: every behaviour here is covered by sans-io
(`call.rs`), wire-duplex (`wire.rs`), dialog/SDP unit tests, and
`cargo test --lib` + `cargo check` are green (see §7).

## 1. Semantics

### Two-dialog ceiling, one RTP stream

- The manager owns at most **two dialogs**: `Primary` + `Second`.
  A third concurrent INVITE gets **486 Busy Here** — never a third dialog,
  never 3+ concurrent media.
- Exactly one leg owns the single `MediaPipeline`/RTP stream at a time
  (`foreground`). The parked leg is always `Held` (`sendonly`) or not yet
  established. `rtp_active_legs() <= 1` is asserted in tests.
- Media (and any in-flight transfer) is released only when the **last** leg
  goes: ending one leg promotes the survivor (held → resumed as foreground)
  instead of orphaning it. Logout/suspend/failure teardown still clears both.

### Blind transfer (RFC 3515)

1. `blind_transfer_request(target)` validates the numeric target, then
   builds in-dialog REFER on the foreground leg: `Refer-To:
   <sip:<target>@<domain>>`, `Referred-By: <local AoR>`, CSeq bumped.
2. `202 Accepted` arms the transfer; any other final code fails it fast
   (leg stays up, media untouched, `TransferFailed` emitted).
3. Transfer-progress NOTIFYs carry `message/sipfrag` bodies, parsed by
   `parse_transfer_notify`: provisional (`100`/`180`) keeps waiting; final
   `2xx` retires our leg as `Ended { reason: "transferred" }` (media
   released — zero orphans); final `3xx–6xx` fails the transfer and our leg
   stays up.

### Attended transfer (RFC 3515 + RFC 3891 Replaces)

1. `consult(target)` holds the established foreground leg (`sendonly`
   re-INVITE) and dials the numeric consult target as the **second dialog**
   (own signalling stream + CSeq space via the `Consult` wire queue and a
   dedicated driver task).
2. Consult answer moves media focus to the consult leg (primary stays held
   — still exactly one active stream); consult failure retires alone and the
   primary resumes as foreground.
3. `attended_transfer_request()` REFERs the held primary leg with a
   `Replaces` header pointing at the answered consult dialog
   (`call-id;from-tag=..;to-tag=..`, parse round-tripped). Final 2xx NOTIFY
   retires **both** legs as `transferred`.

### Call waiting + swap

- Second INVITE while a leg is up parks as the waiting leg: `180 Ringing`
  + `CallWaiting { from, call_id }`, **never auto-answered** (media stays
  with the foreground leg). Plain-RTP/second-offers without SDES still get
  488 — waiting never weakens the SRTP gate.
- `answer_waiting()` = hold active (`sendonly` re-INVITE on its stream) +
  answer waiting (`200 OK` on the registration stream), then media focus
  moves (`Swapped` emitted).
- `swap()` = explicit hold-foreground + resume-parked (each re-INVITE on its
  own leg's stream; empty texts for already-held/active legs are skipped).
- `hangup()` ends the foreground leg; a parked survivor is promoted
  (resumed when held). Reject targets the ringing leg, so rejecting waiting
  never drops the active call. Peer BYE/CANCEL/REFER/NOTIFY are correlated
  by Call-ID across both dialogs; unknown Call-IDs fail closed (481/400),
  never applied to the wrong leg. Inbound REFER is accepted with 202 +
  `TransferRequested` (completing the transfer-out is the peer/PBX's job);
  REFER without `Refer-To` gets 400; REFER on a non-established dialog gets
  488.

## 2. Facade (`sip_*`, no secrets to webview)

| Command | Args | Wire effect |
|---|---|---|
| `sip_call_transfer_blind` | `target` (numeric) | REFER on foreground leg's stream |
| `sip_call_consult` | `target` (numeric) | hold re-INVITE on primary stream + INVITE on fresh consult stream |
| `sip_call_transfer_attended` | — | REFER + Replaces on primary stream |
| `sip_call_swap` | — | hold + resume re-INVITEs, one per leg stream |
| `sip_call_answer_waiting` | — | hold re-INVITE on old stream + 200 OK on registration stream |

All commands are `Send`-safe: short manager locks, no `MutexGuard` across
any await (streams open before locking; texts queued via `CallCoreState`).
Events reaching the webview: `CallWaiting`, `Swapped`,
`TransferRequested`, `TransferFailed` (all secret-free: extensions + state
only), plus `Ended { reason: "transferred" }` on completion.

`sip_diagnostics_export` carries capability flags: `opus_enabled`
(profile `interop_opus` gate), `srtp_required` (always true), `max_dialogs`
(2). No URIs, IPs, SDP, or key material.

## 3. Codec profile (JBM closed, Opus interop-only)

- JBM offer stays exactly `[PCMU, PCMA]` over `RTP/SAVP` with SDES
  (`SdpOffer::offer` / `answer_for` never emit or accept Opus; Opus-only
  offers answer `IncompatibleCodecs` → SIP 488).
- Opus (`opus/48000/2`, dynamic PT 111, `a=ptime:20`) exists only behind the
  `interop_opus` profile gate: offer order must be exactly
  `[PCMU, PCMA, Opus]` (Opus trailing — G.711 stays preferred), and the gate
  never weakens SRTP. Encode/decode via the maintained `audiopus` crate
  (bindings over system libopus); 8 kHz ↔ 48 kHz staging through the tested
  linear resampler.
- Fixture: `1003`/`1004` on the `daad-endpoint-opus` template
  (`allow=ulaw,alaw,opus`, `media_encryption=sdes`); `1001`/`1002` stay
  `ulaw,alaw` only. Dial `1003 ↔ 1004` in `extensions.conf`; passwords via
  `DAAD_TEST_PASSWORD_1003/1004` (placeholders in `.env.example` only).

## 4. Asterisk REFER notes (interop)

- `res_pjsip_refer` handles inbound REFER when the endpoint allows transfer
  (`allow_transfer` defaults to **yes**; the fixture leaves the default —
  no per-endpoint override needed). Blind transfer to a dialplan extension
  completes server-side; the transferee's new INVITE arrives as a normal
  dialplan call.
- Attended transfer with `Replaces`: Asterisk matches the consult dialog by
  Call-ID/tags — both dialogs must be visible to the same Asterisk instance
  (single-fixture topology satisfies this; multi-PBX joins are out of scope).
- Progress arrives as NOTIFYs with `Content-Type: message/sipfrag` and
  `Subscription-State: active` until the final `200 OK` sipfrag, which
  carries `Subscription-State: terminated`. Our parser reads the first
  `SIP/2.0 <code>` line and ignores subscription headers (fail-closed:
  unparsable bodies never count as success).
- REFER/CSeq: Asterisk authenticates in-dialog REFER per the endpoint's
  auth (same digest creds as the call). Our REFER reuses the verified
  dialog stream, so no new auth handshake is needed in-fixture.
- Known limitation: Asterisk may complete the transfer before our final
  NOTIFY arrives; the leg retires on the NOTIFY, so a lost NOTIFY leaves a
  held leg instead of an orphaned one — visible in `sip://call-state` and
  cleaned by explicit hangup (live-gate checklist covers this).

## 5. Live-gate checklist (human, against the fixture)

Pre-reqs: `cd docker/asterisk && ./scripts/gen-certs.sh`, `.env` with
per-run passwords, `docker compose up --build`; two provisioned devices
(1001 + 1002; interop pair 1003 + 1004 for Opus).

- [ ] A→B call, B answers: `Active` both ends, bidirectional G.711 audio.
- [ ] Blind: A `sip_call_transfer_blind(1002→600?)` — use extensions, e.g.
      B calls A, A transfers B to 600 (echo): B hears echo, A sees
      `Ended{transferred}`, `pjsip show channels` → only B–echo remains.
- [ ] Transfer rings: transferee phone rings (NOTIFY `180` observed in
      sanitized logs), transferor leg stays up until final `200`.
- [ ] Audio moves: post-transfer media flows transferee↔target; transferor
      hears nothing (its leg is gone, not held).
- [ ] Attended: A calls B, A consults C (`sip_call_consult`), B hears
      hold, A↔C talk, A completes (`sip_call_transfer_attended`): B↔C
      talk, A sees two `transferred` ends.
- [ ] Zero orphans: after every transfer + hangup, `pjsip show channels`
      → 0, `bridge show all` → 0, `pjsip show contacts` → 0 after logout.
- [ ] Waiting/swap: A↔B active, C calls A: A sees waiting (no auto-answer),
      accept → B held + C active; swap → B active + C held; hangup → survivor
      promoted, single audio path throughout.
- [ ] Opus interop: 1003↔1004 negotiates `opus/48000/2` only when both end
      in the interop profile; 1001 offers never contain `opus` (capture +
      redact via `scripts/redact-pcap.sh`).
- [ ] Failure paths: transfer to unregistered extension → transferee gets
      failure tone, transferor leg stays `Active`; consult callee declines →
      primary resumes automatically.

## 6. Files changed

- `src-tauri/src/sip_core/call.rs` — two-dialog manager (`WhichLeg`,
  waiting/consult slots, foreground focus), transfer state machine
  (blind/attended/202/NOTIFY/inbound REFER), per-leg teardown with
  promotion, single-stream invariant + 12 new tests.
- `src-tauri/src/sip_core/wire.rs` — REFER/NOTIFY dispatch, Call-ID-routed
  BYE/CANCEL, `dispatch_response` for REFER outcomes + 4 duplex tests.
- `src-tauri/src/sip_core/dialog.rs` — `note_transferred()`.
- `src-tauri/src/sip_core/sdp.rs` — ptime parse-width fix (u16 before
  clamp; pre-existing test now green).
- `src-tauri/src/lib.rs` — leg-aware drivers (`drive_establishing_for`,
  `relay_established_for`, per-leg transport loss), `Consult` wire queue +
  task, five facade commands, diagnostics flags (`opus_enabled`,
  `srtp_required`, `max_dialogs`).
- `docker/asterisk/{config/pjsip.conf,config/extensions.conf,.env.example,
  README.md}` — interop `daad-endpoint-opus` template + 1003/1004 pair.
- `src-tauri/Cargo.toml` — `audiopus = "0.2"` (pre-existing working-tree
  addition, kept for the Opus codec path).

## 7. Verification evidence

- `cd src-tauri && cargo test --lib` — **170 passed / 0 failed / 1 ignored**
  (the ignore is the opt-in keyring round-trip needing a real keychain).
- `cd src-tauri && cargo check --lib` — **0 errors** (warnings: pre-existing
  benign `dead_code`/`unused` on not-yet-wired public surface).
- JBM guards tested: `jbm_offer_stays_pcmu_pcma_exactly`,
  `codec_order_is_pcmu_then_pcma`, `interop_opus_order_is_pcmu_pcma_then_opus`,
  `unknown_codecs_rejected`, plain-RTP-488 paths in call + wire tests.
