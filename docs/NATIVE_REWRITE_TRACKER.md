# Native Rewrite Tracker (orchestrator)

Baseline 2026-09-04, branch `main` @ `8c3007e`:
- `bun run test`: 16 files, 74 tests passed
- `cd src-tauri && cargo check`: pass
- Stack: Tauri 2.11.3, React 18, sip.js 0.21.2, tokio/rustls/tungstenite only

Reusable as-is:
- `src/services/soundService.ts` (WebAudio synth, no assets) — keep for ringtones until platform ringtone adapters land
- `src/services/callHistoryService.ts` + tests — keep, sanitize numbers on export
- `src/services/audioDeviceService.ts` constraint logic — port to Rust `audio.rs` device selection reference
- `src-tauri/src/sip_bridge.rs` Via translate tests — keep as reference for interop tests, then delete proxy once native transport lands
- `SipService.lifecycleGate` single-worker pattern — port to Rust `register.rs` exactly-one-worker invariant
- UI layout/aesthetic, dialpad, ActiveCallView tests — keep, rewire to native client

Must delete before OSS stable:
- `NoCertVerifier` + `allow_insecure=true` default (`sip_bridge.rs:23`, `lib.rs:21`, `sipService.ts:373`)
- `localStorage` password (`SipContext.tsx:43`), `traceSip:true`

- ses_f9341a840ffeammz05DKOymL6r — DONE frontend MVP: CA field, Rust timing, legacy gated, 7 states. Verified: 22/129 pass, typecheck+lint ok.
- ses_f92ded183ffe8R6V3HQoyK3Ow2 — DONE call power (Rust): REFER/Replaces, 2-dialog waiting, interop Opus. Verified: cargo 170/0/1, vitest 133/133, lint ok. Committed 85166ea, pushed.
- ses_f92bd3389ffeja234RmVZPCrmy — RUNNING transfer/waiting UI (frontend only).

Order: Phase1 → Phase2 → Phase3 (DTMF/mute/hold/route/focus/reconnect) → Phase4 (packaging/mobile CallKit/ConnectionService separate gate) → Phase5 (interop profiles, never weaken JBM defaults).

Live-Core acceptance requires human: VPN to test Core, deployment CA, provisioned device creds, 2 real clients, 10-min call, VPN/sleep recovery, zero orphans on Core.
