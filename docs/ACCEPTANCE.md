# Acceptance Checklist — Daad × Isolated Asterisk Fixture

Run against `docker/asterisk` (`docker compose up --build` after
`scripts/gen-certs.sh` + local `.env`). Static items are asserted in CI
by `src/test/integration/asteriskContract.test.ts` (suffix **[S]**) and
`src/test/integration/faultInjection.test.ts` (suffix **[F]**); live
items (suffix **[L]**) need two registered clients and are performed by
the operator.

## Registration & transport

- [ ] **1. TLS verify [L]** — Register `1001` over `tls://…:5061` with the
  fixture CA trusted → `Registered`. Repeat with an untrusted/expired
  cert and no insecure-override → `RegistrationFailed`, no media, no retry storm.
- [ ] **2. Fail-closed [F/L]** — Invalid URI, refused TLS handshake, or
  `401/403` with bad creds → `RegistrationFailed`, never a phantom
  `Registered`. (`cert reject analogue`, `bad-creds analogue` in [F].)
- [ ] **3. Timeout [F/L]** — Unroutable PBX address → bounded failure,
  UI leaves `Connecting` within the timeout budget, state never stuck.
- [ ] **4. Single contact [S/L]** — `pjsip show contacts` shows exactly
  one contact per extension after register; fixture enforces
  `max_contacts=1` + `remove_existing=yes`.
- [ ] **5. Refresh, no dupes [S/L]** — Force re-REGISTER (expiry 600s,
  min 60 / max 3600) and confirm the contact count stays at 1.

## Call flows

- [ ] **6. Ringing [L]** — `1001` dials `1002` → callee rings (`180`),
  caller shows `Ringing`, ringback is synthesized (no audio assets).
- [ ] **7. Reject [L]** — Callee rejects → caller gets `486 Busy`,
  both sides return to `Idle`, history logs `rejected`.
- [ ] **8. CANCEL race [F/L]** — Caller hangs up before answer →
  callee ringing stops, no stuck session on either side, fixture shows
  zero channels. (Shutdown/CANCEL race analogue in [F].)
- [ ] **9. Answer [L]** — Callee answers → both sides `Active`, duration
  timer runs, history logs `answered` on hangup.
- [ ] **10. 2-way audio [L]** — Speak both directions (or loopback via
  echo ext `600` for single-client checks); confirm audible audio each way.
- [ ] **11. SRTP, no downgrade [S/L]** — SDP on the wire shows
  `a=crypto` (SDES); `media_encryption=sdes` in fixture; tearing out the
  crypto line must fail the call, never fall back to plain RTP.
- [ ] **12. PCMU/PCMA [S/L]** — Offered `m=audio` lists payloads `0/8`
  only; `disallow=all` + `allow=ulaw,alaw` in fixture.
- [ ] **13. DTMF [S/L]** — In-call DTMF `0-9*#` arrives as RFC 4733
  `telephone-event`; `dtmf_mode=rfc4733`, never in-band.
- [ ] **14. Mute / hold [L]** — Mute toggles the mic track only; hold
  re-INVITEs with `sendonly` and resumes cleanly to `Active`.
- [ ] **15. Hangup cleanup [F/L]** — Either side hangs up → `Idle`,
  streams/timers released, history written; fixture `pjsip show
  channels` + `bridge show all` return zero.

## Resilience & hygiene

- [ ] **16. VPN / sleep recovery [S/L]** — Drop the network 30s (or
  sleep the laptop) → client re-registers, contact count stays 1
  (`rtp_symmetric`, `rewrite_contact`, `force_rport` in fixture).
- [ ] **17. No secret in logs [F]** — Full register → call → hangup →
  logout cycle leaves zero passwords / Digest responses / keys in
  console output, committed logs, or captures (redact script + [F]
  `log hygiene` test).
- [ ] **18. Zero orphans after logout [F/L]** — After both clients log
  out: `pjsip show contacts` → 0, `pjsip show channels` → 0,
  `bridge show all` → 0. (Teardown/idempotency analogues in [F].)
- [ ] **19. 10-min 2-client call [L]** — `1001 ↔ 1002` stay `Active`
  for 10 minutes with periodic DTMF + mute/hold cycles; no drops, no
  one-way-audio drift, RTCP healthy.
- [ ] **20. Mobile background — separate gate [L]** — Background /
  killed-app incoming-call behavior is platform-gated (PushKit on iOS,
  FCM + `SYSTEM_ALERT_WINDOW`/CallStyle notification on Android) and is
  tracked as its own acceptance gate in `docs/MOBILE_SETUP.md`, not as
  part of the desktop fixture pass.

## Quick commands

```bash
cd docker/asterisk
./scripts/gen-certs.sh && cp .env.example .env   # fill TEST passwords
docker compose up --build
docker exec daad-asterisk-test asterisk -rx "pjsip show contacts"
docker exec daad-asterisk-test asterisk -rx "pjsip show channels"
docker exec daad-asterisk-test asterisk -rx "bridge show all"
```

Evidence shared from a run must be a `*.sanitized.log` (see
`scripts/redact-pcap.sh`); raw pcaps never enter the repo.
