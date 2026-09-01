# Architecture Overview • Daad

Daad is architected as a lightweight, cross-platform desktop softphone application using a decoupled, reactive model across three core layers:

1. **Native Desktop Host (Tauri v2 / Rust)**
2. **Telephony & Media Engine (SIP.js v0.21+ / Web Audio / WebRTC)**
3. **Application State & UI Layer (React 19 / TypeScript / Tailwind CSS)**

---

## 🏗️ System Architecture Diagram

```
+-------------------------------------------------------------------------+
|                              REACT 19 UI LAYER                          |
|                                                                         |
|   +-------------------+  +--------------------+  +------------------+   |
|   |   LoginView.tsx   |  |   DialerPad.tsx    |  | ActiveCallView   |   |
|   +-------------------+  +--------------------+  +------------------+   |
|   +-------------------+  +--------------------+  +------------------+   |
|   | RecentCallsView   |  | SettingsModal.tsx  |  | UpdateModal.tsx  |   |
|   +-------------------+  +--------------------+  +------------------+   |
|                                                                         |
|                          SipContext (Provider)                          |
+------------------------------------+------------------------------------+
                                     | Reactive Subscriptions
+------------------------------------v------------------------------------+
|                         CORE SERVICES & ENGINES                         |
|                                                                         |
|   +------------------+  +--------------------+  +-------------------+   |
|   |  sipService.ts   |  |  soundService.ts   |  | audioDeviceMgr    |   |
|   |  (SIP.js v0.21+) |  |  (Web Audio API)   |  | (MediaDevices)    |   |
|   +------------------+  +--------------------+  +-------------------+   |
|   +------------------+  +--------------------+                          |
|   | callHistoryMgr   |  |  updateService.ts  |                          |
|   | (LocalStorage)   |  |  (GitHub API/Tauri)|                          |
|   +------------------+  +--------------------+                          |
+------------------------------------+------------------------------------+
                                     | WebRTC Audio Tracks / WSS Frames
+------------------------------------v------------------------------------+
|                         NATIVE TAURI V2 CORE                            |
|                                                                         |
|   +------------------------------------+  +-------------------------+   |
|   | System Tray (TrayIconBuilder)      |  | Close-to-Tray Manager   |   |
|   +------------------------------------+  +-------------------------+   |
|   +------------------------------------+  +-------------------------+   |
|   | Native Auto-Updater Plugin         |  | OS Permissions Handler  |   |
|   +------------------------------------+  +-------------------------+   |
+-------------------------------------------------------------------------+
```

---

## 1. Native Desktop Host (Tauri v2)

- **Window Management:** Window initialized to a fixed `360x600px` frame.
- **Close-to-Tray Lifecycle:** In [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs), `WindowEvent::CloseRequested` is intercepted with `api.prevent_close()` and `window.hide()`.
- **System Tray:** A system tray icon with a contextual menu ("Show Daad", "Quit") allows minimizing to background and single-click focus restoration.
- **Security & Capabilities:** Configured with strict Content Security Policy (`default-src 'self'; connect-src 'self' wss: ws: https: http: stun:`) and fine-grained permissions in `capabilities/default.json`.

---

## 2. Telephony & Media Engine

- **SIP Transport:** SIP.js connects over secure WebSockets (`wss://`) to PBX servers.
- **WebRTC PeerConnection:** Audio streams negotiate via standard SDP (Session Description Protocol) with STUN ICE servers (`stun:stun.l.google.com:19302`).
- **Zero-Dependency Audio Synthesizer:** [`soundService.ts`](../src/services/soundService.ts) constructs dual-frequency sine wave oscillators using the Web Audio API for:
  - DTMF tones ($697\text{Hz}-1633\text{Hz}$)
  - Ringback tone ($440\text{Hz} + 480\text{Hz}$)
  - Incoming call melody
  - Hangup confirmation beeps

---

## 3. Application State Machine

The softphone maintains strict state machines for both connection and in-call states:

### Connection State
`Disconnected` $\rightarrow$ `Connecting` $\rightarrow$ `Registered` $\rightarrow$ `RegistrationFailed` (with auto-reconnect backoff).

### Call State
`Idle` $\rightarrow$ `Calling` (Ringback) $\rightarrow$ `Ringing` $\rightarrow$ `Active` (Connected) $\rightarrow$ `Holding` $\rightarrow$ `Idle` (Call End).
