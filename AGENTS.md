# AGENTS.md • Autonomous AI Agent Architectural Specification & System Prompts

This document defines the architectural guidelines, design system invariants, protocol specifications, operational protocols, and specialized **System Prompts** for autonomous coding agents developing on the **Daad** softphone codebase.

---

## 🏛️ Project Architecture & Technology Stack

- **Desktop Framework:** [Tauri v2](https://v2.tauri.app) (Rust core backend, secure webview frontend)
- **Package Manager & Toolchain:** [Bun](https://bun.sh) (`bun` MUST always be used instead of `npm`, `pnpm`, or `yarn`)
- **Frontend Stack:** React 19 + TypeScript + Vite + Tailwind CSS + Lucide React
- **Telephony Engine:** `sip.js` (v0.21+) + WebRTC + Native Asynchronous Rust Socket Bridge
- **Multi-Transport Support:**
  - **TLS (Port 5061):** Raw encrypted SIP stream via `tokio-rustls` with custom CA & self-signed cert verifier.
  - **TCP (Port 5060):** Raw bidirectional TCP stream.
  - **UDP (Port 5060):** Raw UDP socket datagram proxy.
  - **WSS (Port 8089 / 7443):** Direct Secure WebSockets over WebRTC.
- **Audio Synthesizer:** Pure Web Audio API in [`soundService.ts`](src/services/soundService.ts) (Zero external `.mp3` / `.wav` assets).
- **Public SDK:** Headless [`DaadClient`](src/sdk/client.ts) and drop-in [`<DaadPhoneWidget />`](src/sdk/widget.tsx).
- **Test Runner:** Vitest + React Testing Library (`bun run test` — **100% Passing Invariant Required**).

---

## 📜 Strict Architectural Invariants & Rules

### 1. Zero Relative Path Spaghetti (`@/*` Aliases Required)
- **NEVER** use relative parent paths like `../../components/StatusBar` or `../types/sip`.
- **ALWAYS** use configured root path aliases:
  ```typescript
  import { StatusBar, DialerPad } from '@/components';
  import { sipService, soundService } from '@/services';
  import { SipConfig, ConnectionState, CallState } from '@/types';
  import { useSip, SipProvider } from '@/context';
  import { DaadClient, DaadPhoneWidget } from '@/sdk';
  ```

### 2. Package Manager Rule
- **ALWAYS** execute commands via `bun`:
  - `bun install` / `bun add <pkg>` / `bun add -d <pkg>`
  - `bun run dev` (Desktop Web dev)
  - `bun run dev:phone` (HTTPS dev server exposed to Wi-Fi for mobile phone testing)
  - `bun run tauri dev` (Native Tauri desktop dev)
  - `bun run build` (TypeScript compiler check + Vite build)
  - `bun run test` (Vitest full test suite)

### 3. State Management & React Context
- All telephony state transitions flow through `SipProvider` in [`src/context/SipContext.tsx`](src/context/SipContext.tsx).
- UI views must subscribe to `useSip()` rather than invoking singleton methods directly without reactive bindings.
- Required reactive state machines:
  - `ConnectionState`: `Disconnected` | `Connecting` | `Registered` | `RegistrationFailed`
  - `CallState`: `Idle` | `Calling` | `Ringing` | `Active` | `Holding`
  - `CallHistory`: Persistent records synchronized with `callHistoryService.ts` and `localStorage`.

### 4. Telephony Engine & WebRTC Invariants
- **Remote Audio Output:** Bound via `RTCPeerConnection.ontrack` to `<audio id="remoteAudio" autoplay />`.
- **Microphone Permissions:** Pre-configured in [`src-tauri/Info.plist`](src-tauri/Info.plist) (`NSMicrophoneUsageDescription`).
- **Zero Asset Audio:** All ringback tones, incoming melodies, DTMF dual-frequencies, and call termination beeps are mathematically synthesized via the Web Audio API in [`soundService.ts`](src/services/soundService.ts).
- **Session Teardown:** Every terminated session MUST release media streams, clear call duration timers, and log the call outcome to `callHistoryService`.

### 5. UI Design Philosophy (Anti-AI Slop)
- **Utilitarian / Obsidian / Linear / Raycast Aesthetic:** Dark obsidian backgrounds (`#090a0f`, `#0c0e15`, `#13151f`), subtle 1px borders (`border-white/[0.08]`), tactile press feedback (`active:scale-95`), monospaced numerical typography (`JetBrains Mono` / `SF Pro`).
- **Dual Responsive Layout:**
  - Inside Tauri Desktop / Mobile Window: Renders compact 360x600px softphone window.
  - Inside Web Browser: Renders responsive product showcase + interactive live softphone widget side-by-side.

### 6. Automated Testing Invariant
- **100% Passing Tests:** Run `bun run test` after any modifications. Every new feature or service must be accompanied by unit and component tests.

---

## 📂 Codebase Directory Map

```
Daad/
├── src/
│   ├── components/       # React UI Views & Modals (StatusBar, DialerPad, ActiveCallView, etc.)
│   │   └── index.ts      # Component barrel export
│   ├── context/          # SipContext & React Provider
│   │   └── index.ts      # Context barrel export
│   ├── hooks/            # Custom telephony hooks (useSip)
│   │   └── index.ts      # Hooks barrel export
│   ├── sdk/              # Public Telephony SDK (DaadClient, DaadPhoneWidget)
│   │   └── index.ts      # SDK public API entrypoint
│   ├── services/         # Core Singletons (sipService, soundService, audioDeviceService, updateService)
│   │   └── index.ts      # Services barrel export
│   ├── types/            # Domain interfaces (sip.ts, callHistory.ts)
│   │   └── index.ts      # Types barrel export
│   ├── test/             # Vitest test setup and Web Audio / MediaDevices mocks
│   ├── App.tsx           # Dual layout entry component
│   └── main.tsx          # React DOM entrypoint
├── src-tauri/
│   ├── src/
│   │   ├── main.rs       # Tauri desktop entrypoint
│   │   ├── lib.rs        # System tray & IPC commands
│   │   └── sip_bridge.rs # Asynchronous Rust bridge for raw TLS 5061, TCP 5060, UDP 5060
│   ├── capabilities/     # Fine-grained Tauri security permissions
│   ├── tauri.conf.json   # Tauri v2 configuration (bundle, CSP, dimensions)
│   ├── Info.plist        # macOS & iOS hardware permissions
│   └── Cargo.toml        # Rust backend dependencies
├── docs/                 # Documentation & Architecture Guides
│   ├── ARCHITECTURE.md   # Architectural design document
│   ├── PBX_SETUP.md      # Asterisk & FreeSWITCH setup guide
│   ├── TELEPHONY_ENGINE.md # SIP.js & WebRTC engine deep dive
│   ├── SDK_GUIDE.md      # Public Telephony SDK guide
│   ├── MOBILE_SETUP.md   # iOS & Android mobile setup
│   └── CONTRIBUTING.md   # Contribution workflow
├── .github/
│   └── workflows/
│       ├── ci.yml            # Automated CI lint, typecheck, tests, and cargo check
│       ├── release.yml       # Multi-platform desktop build & automated publish
│       └── deploy-pages.yml  # Live GitHub Pages deployment
└── README.md             # Public repository presentation & quickstart
```

---

## 🤖 Specialized Agent System Prompts

When delegating tasks or spawning subagents, use the following role-specific system prompts:

---

### 1. Telephony & Protocol Specialist Agent
```markdown
You are the Telephony Protocol Engineer for Daad Softphone.
Your core expertise is SIP (RFC 3261), WebRTC (RFC 8829), SDP negotiation, SRTP (SDES/DTLS), DTMF (RFC 4733), and audio codec orchestration (PCMU, PCMA, Opus).

Key Invariants:
1. All SIP state flows through `src/services/sipService.ts` and `src/context/SipContext.tsx`.
2. Connect to raw TLS 5061, TCP 5060, UDP 5060, and WSS 8089 seamlessly via `resolveServerTransport()` and the Rust native bridge.
3. Handle private IP PBX certificates without handshake failures using insecure cert assertion when requested.
4. Ensure full media cleanup on every call termination (stopping tracks, clearing timers, resetting UI).
5. Always use `@/` path aliases and verify tests with `bun run test`.
```

---

### 2. Rust Core & Native Bridge Specialist Agent
```markdown
You are the Tauri Rust Backend Systems Engineer for Daad Softphone.
Your responsibility is maintaining high-performance native bridges in `src-tauri/src/sip_bridge.rs` and `src-tauri/src/lib.rs`.

Key Invariants:
1. Maintain asynchronous streaming with Tokio, `tokio-tungstenite`, and `tokio-rustls`.
2. Implement bidirectional forwarding between local WebSocket clients and remote PBX endpoints (TLS, TCP, UDP).
3. Handle graceful shutdown tokens with `tokio::sync::broadcast`.
4. Ensure strict `Send + 'static` thread safety across all spawned futures.
5. Verify Rust compilation with `cargo check` in `src-tauri/`.
```

---

### 3. UI/UX & Design Systems Specialist Agent
```markdown
You are the Frontend UI/UX Engineer for Daad Softphone.
You specialize in modern, high-precision, obsidian utilitarian design (Linear / Raycast aesthetic).

Key Invariants:
1. Anti-AI Slop: Use obsidian dark backgrounds (#090a0f, #0c0e15, #13151f), 1px subtle borders (border-white/[0.08]), tactile press feedback (active:scale-95), and JetBrains Mono numerical typography.
2. Responsive Dual Layout: Render the compact softphone widget in desktop/mobile Tauri viewports and the full product showcase on web.
3. Zero relative imports: Import exclusively from `@/components`, `@/services`, `@/types`, `@/context`, `@/hooks`.
4. Write React Testing Library tests for every UI component.
```

---

### 4. SDK & Platform Integration Specialist Agent
```markdown
You are the SDK & Developer Platform Engineer for Daad.
Your mission is maintaining the public headless SDK (`DaadClient`) and drop-in component (`<DaadPhoneWidget />`) in `src/sdk/`.

Key Invariants:
1. Ensure the SDK can be imported and consumed cleanly in any TypeScript, React, React Native, or Vanilla JS environment.
2. Provide clean event-driven subscriptions (`phone.on('call:incoming', ...)`).
3. Keep SDK documentation and code samples in `docs/SDK_GUIDE.md` up-to-date.
4. Ensure 100% test coverage in `src/sdk/client.test.ts`.
```

---

### 5. CI/CD & Multi-Platform Release Specialist Agent
```markdown
You are the DevOps & Release Engineer for Daad.
Your responsibility is maintaining GitHub Actions workflows (`ci.yml`, `release.yml`, `deploy-pages.yml`).

Key Invariants:
1. Explicitly provision Node.js 24 and latest Bun across all workflows.
2. Ensure release drafts are automatically published (`gh release edit --draft=false`) once multi-platform matrix builds complete.
3. Maintain zero deprecation warnings on GitHub Actions runners.
4. Synchronize version tags across `package.json`, `Cargo.toml`, `tauri.conf.json`, and `updateService.ts`.
```

---

## 🚀 Common Development Commands

```bash
# Start desktop development
bun run tauri dev

# Start local network mobile test server (open on iPhone / Android via Wi-Fi)
bun run dev:phone

# Run automated test suite
bun run test

# Run tests in watch mode
bun run test:watch

# Compile frontend build
bun run build

# Check Rust backend compilation
cd src-tauri && cargo check
```
