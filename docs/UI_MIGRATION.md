# UI Migration — Native Rust SIP Ownership

Frontend is now presentation-only. Rust owns SIP signaling, media, and credentials.

## Files changed

- `src/services/nativeSipClient.ts` (new): typed Tauri `invoke`/`listen` wrapper.
  Commands: `sip_account_upsert`, `sip_account_remove`, `sip_register`, `sip_unregister`,
  `sip_status`, `sip_call_invite`, `sip_call_answer`, `sip_call_reject`, `sip_call_hangup`,
  `sip_call_mute`, `sip_call_hold`, `sip_call_dtmf`, `sip_audio_route`, `sip_diagnostics_export`.
  Events: `sip://connection-state`, `sip://call-state`, `sip://cert-status`.
  Includes `validateDialTarget` (numeric 3–8 digits, no leading zero), `stripSecrets`,
  `sanitizeDiagnostics`, `mapNativeStatusToConnectionState`.
- `src/services/nativeSipClient.test.ts` (new): IPC serialization/auth tests, secret-redaction
  tests, dial-validation tests, event subscribe/dispose tests.
- `src/types/sip.ts`: `ConnectionState` extended with `NetworkConnected`, `TlsVerified`,
  `Registering`, `Reconnecting`, `AuthFailed`, `CertFailed`, `MicFailed`, `NoReachableContact`.
  Added `CertTrustStatus`, `AudioRoute`, `SafeSipConfig`, `NativeSipStatus`.
- `src/context/SipContext.tsx` (refactored): uses `NativeSipClient`; public `useSip` API stable
  (all previous fields kept; added `certStatus`, `audioRoute`, `contactsReachable`,
  `setAudioRoute`, `exportDiagnostics`). Password is transient only — persisted profile
  (`daad_sip_profile`) never contains secrets; session flag in `daad_sip_session`.
  Single-flight via monotonic `opSeq` generation guard + single `subscribed` ref + `beforeunload`
  unregister; `Registered` is only set from native `registered=true`, never socket-open alone.
- `src/context/SipContext.test.tsx` (new): no-password-in-storage, socket-open mapping,
  latest-wins concurrency, pre-IPC dial rejection, dialpad guidance.
- `src/components/ProvisioningView.tsx` (new) + `NativeScreens.test.tsx`: setup screen with
  cert badge, distinct failure titles, progress states; clears password from form after submit.
- `src/components/CertTrustBadge.tsx` (new): TLS trust indicator.
- `src/components/DiagnosticsPanel.tsx` (new): sanitized export + download; preview asserted
  secret-free in tests.
- `src/components/DialerPad.tsx`: numeric-only validation on dial with inline guidance;
  keypad/DTMF entry unchanged.
- `src/components/StatusBar.tsx`: handles all new states + `CertTrustBadge`; failure alert for
  `AuthFailed`/`CertFailed`/`MicFailed`/`NoReachableContact`.
- `src/components/LoginView.tsx`, `SettingsModal.tsx`: failure banners extended to new states;
  `Registering`/`Reconnecting` treated as busy.
- `src/components/ActiveCallView.tsx` (+ `ActiveCallRoute.test.tsx`): `audioRoute`/`onAudioRoute`
  route selector (earpiece/speaker/bluetooth/system); mute/keypad/hold/route/hangup retained.
- `src/components/index.ts`, `src/services/index.ts`: barrel exports.
- `src/App.tsx`: provisioning gate via `ProvisioningView`, reconnecting/failure banners,
  `DiagnosticsPanel` in Recents tab, obsidian shell (`#090a0f`/`#0c0e15`/`#13151f`,
  `border-white/[0.08]`, `active:scale-95`, JetBrains Mono numerals).

## MVP closeout (frontend — desktop only)

Evidence (`bun run test` 22 files / 129 tests green, `bun run typecheck`, `bun run lint` clean):

- `ProvisioningView`: custom CA PEM textarea (paste) + CA file loader (`.pem/.crt/.cer`),
  validated with `validateCaPem` (BEGIN/END CERTIFICATE framing), sent once as
  `custom_ca_pem` via `sip_account_upsert` and cleared from the webview with the
  password after handoff. Never logged (`stripSecrets` redacts `custom_ca_pem` /
  `customCaPem`) and never persisted (`toSafeProfile` drops it). Numeric-only
  extension validation (`validateExtension`) blocks submit with inline guidance.
  Cert badge states: verified / failed / self-signed / pending (`cert-pending`
  indicator while `unknown` + Connecting/NetworkConnected/TlsVerified/Registering/
  Reconnecting).
- `StatusBar` / `LoginView` / `SettingsModal`: distinct states for Network connected /
  TLS verified / Registering / Registered / Auth / Cert / Mic / No-contact, with the
  Rust `status.message` shown verbatim as the subtitle/banner detail.
- Call timing is Rust-owned: `SipContext` applies `sip://call-state` event
  `startTime`/`duration` verbatim and never synthesizes `startTime` in the webview.
  The 1s interval is display-only (re-renders elapsed time from the event timestamp)
  and stops on non-Active states. Call-history records are logged on the
  Active→Idle transition using Rust timestamps only. `beforeunload` unregister,
  `opSeq` single-flight, and single `subscribed` guard retained — no duplicate
  registration workers on reload.
- `sipService.ts` (sip.js) gated behind `VITE_DEV_LEGACY_WS=1` (default off):
  `connectAndRegister`/`makeCall` throw unless explicitly enabled, `traceSip: false`,
  SDK signaling methods assert the flag (history/device queries stay available).
  CI lint fails if the default desktop path (`App`/`context`/`components`/`main`)
  imports `sipService`, if `traceSip: true` returns, if the flag leaks into
  `.env`/`.env.production`, or if it is enabled in the CI env.
- Legacy `daad_sip_config` key is purged on every `connect`/`login` (never read for
  secrets); persisted profile (`daad_sip_profile`) carries no password or CA material.
  `callHistory` + `soundService` retained; diagnostics export remains sanitized-only.

## Gaps / follow-ups (post-MVP)

1. Rust commands (`sip_account_upsert`, `sip_register`, `sip_call_*`, …) remain a
   frontend contract owned by the Rust closer — `src-tauri/src/sip_core` and `lib.rs`
   untouched by this change. (`lib.rs` currently only exposes `start_sip_bridge` /
   `stop_sip_bridge` / `open_url`; the `sip_*` commands, event emission, credential
   vault (keyring), and single-registration-worker guarantee still need implementing,
   plus `cargo check`.)
2. Mobile background (iOS/Android suspended-call, CallKit/Telecom integration) is
   explicitly out of the desktop MVP.
3. `DaadClient` SDK signaling still targets the gated legacy path; a native-backed
   SDK is future work.
4. No live-Tauri integration test yet — current tests mock `invoke`/`listen`.
5. Call-history records are mirrored locally from Rust events; authoritative Rust CDRs
   still to be decided.
6. `getStatus` polling fallback is minimal (single fetch after `register`); consider a
   short poll loop until first native event arrives.
7. Mic-permission probing (`MicFailed`) is mapped from native errors only; no frontend
   `getUserMedia` pre-check — intentional (Rust owns media).
8. `sip.js` dependency retained for the gated dev-only path; remove it once Rust parity
   (hold/DTMF/history semantics) is verified and the SDK goes native.
