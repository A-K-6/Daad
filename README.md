<div align="center">

# Daad • داد

**Ultra-fast, minimal, modern cross-platform SIP softphone desktop client.**

[![CI](https://github.com/A-K-6/Daad/actions/workflows/ci.yml/badge.svg)](https://github.com/A-K-6/Daad/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/A-K-6/Daad?color=10b981&label=release)](https://github.com/A-K-6/Daad/releases)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-blue?logo=tauri)](https://tauri.app)
[![Bun](https://img.shields.io/badge/Bun-v1.4+-fbf0df?logo=bun)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[**Live Web Showcase**](https://a-k-6.github.io/Daad/) • [**Download Releases**](https://github.com/A-K-6/Daad/releases) • [**PBX Setup Guide**](#-pbx-configuration-recipes)

</div>

---

## ⚡ What is Daad?

**Daad (داد)** is an industrial-grade, developer-first SIP softphone designed for speed, clarity, and zero bloat. Built on **Tauri v2 (Rust)**, **SIP.js (v0.21+)**, **React**, and **Bun**, it brings modern Raycast/Linear-level ergonomics to VoIP desktop applications.

- **🚀 Instant Startup & Low Memory:** Native Rust core with ~30MB RAM footprint.
- **🎧 Pure Web Audio & WebRTC:** Crystal-clear 2-way audio with zero external sound files (synthesizes DTMF, ringback, and ringtone frequencies directly via Web Audio API).
- **📥 Close-to-Tray Ergonomics:** Window hides to the system tray on close (`X`) with an interactive menu and single-click focus restore.
- **🔄 In-App Auto-Updates:** Live GitHub Releases integration with one-click download, changelog preview, and relaunch.
- **🎙️ Audio Device Selector:** Dynamic microphone and speaker enumeration with live output testing.
- **📞 Call History & One-Tap Redial:** Persistent timeline of outgoing, answered, and missed calls.
- **🛡️ Secure by Default:** Strict Content Security Policy (CSP), encrypted WSS/TLS transport, and WebRTC DTLS/SRTP audio.

---

## 🏛️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Daad UI (React)                       │
│  ┌──────────────┬────────────────────────┬───────────────┐  │
│  │ Login View   │ Keypad & Active Call   │ Recents View  │  │
│  └──────────────┴────────────────────────┴───────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              SipContext & State Machine               │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────┘
                               │ WebRTC Audio / WSS
┌──────────────────────────────▼──────────────────────────────┐
│                  SIP.js (v0.21+) Engine                     │
│  ┌──────────────────────┬────────────────────────────────┐  │
│  │ UserAgent / Register │ Session / Inviter / Invitation │  │
│  └──────────────────────┴────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────┘
                               │ Tauri IPC
┌──────────────────────────────▼──────────────────────────────┐
│                    Tauri v2 (Rust Core)                     │
│  ┌──────────────────────┬────────────────────────────────┐  │
│  │ System Tray Builder  │ Close Interceptor & AutoUpdate │  │
│  └──────────────────────┴────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 Downloads & Installation

Pre-compiled production binaries are generated on every tagged release:

| Platform | Format | Link |
| :--- | :--- | :--- |
| **macOS** (Apple Silicon) | `.dmg` | [Download macOS DMG](https://github.com/A-K-6/Daad/releases/latest) |
| **Windows** (x64) | `.exe` / `.msi` | [Download Windows Setup](https://github.com/A-K-6/Daad/releases/latest) |
| **Linux** (x64) | `.AppImage` / `.deb` | [Download Linux AppImage](https://github.com/A-K-6/Daad/releases/latest) |
| **iOS / Android** | Mobile & PWA | [Mobile Setup Guide](docs/MOBILE_SETUP.md) |

> **macOS Note:** For unsigned open-source binaries, run `xattr -cr /Applications/Daad.app` in Terminal or click *Open Anyway* in **System Settings $\rightarrow$ Privacy & Security**.

---

## 🛠️ Developer Quickstart

Daad uses **Bun** as its package manager and runtime.

### Prerequisites
- [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`)
- [Rust & Cargo](https://rustup.rs/) (stable)
- OS dependencies:
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Linux (Ubuntu/Debian):** `sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libasound2-dev`

### Setup & Run
```bash
# Clone the repository
git clone https://github.com/A-K-6/Daad.git
cd Daad

# Install frontend dependencies
bun install

# Run desktop app in development mode
bun run tauri dev

# Run automated tests (56 unit & component tests)
bun run test

# Build production desktop binary
bun run tauri build
```

### 📱 Test on Mobile Phone over Wi-Fi
You can test the softphone and WebRTC audio directly on your phone:
```bash
# Starts HTTPS development server exposed to your local network
bun run dev:phone
```
Open `https://<YOUR_LOCAL_IP>:1420` in Safari or Chrome on your mobile phone connected to the same Wi-Fi.

---

## 📡 PBX Configuration Recipes

Daad connects to any SIP PBX that supports WebSockets (**WSS**) and **WebRTC**.

### 1. Asterisk (PJSIP + WSS)

#### `http.conf`
```ini
[general]
enabled=yes
bindaddr=0.0.0.0
bindport=8088
tlsenable=yes
tlsbindaddr=0.0.0.0:8089
tlscertfile=/etc/asterisk/keys/asterisk.crt
tlsprivatekey=/etc/asterisk/keys/asterisk.key
```

#### `pjsip.conf`
```ini
[transport-wss]
type=transport
protocol=wss
bind=0.0.0.0:8089

[1001]
type=endpoint
transport=transport-wss
context=default
disallow=all
allow=opus,ulaw,alaw
aors=1001
auth=1001
dtls_auto_generate_cert=yes
webrtc=yes
use_avpf=yes
media_encryption=dtls
dtls_verify=fingerprint
dtls_setup=actpass
ice_support=yes
media_use_received_transport=yes
rtp_symmetric=yes
rewrite_contact=yes
force_rport=yes

[1001]
type=auth
auth_type=userpass
username=1001
password=YourSecretPassword

[1001]
type=aor
max_contacts=5
remove_existing=yes
```

#### Connection Settings in Daad:
- **WebSocket URL (WSS):** `wss://your-asterisk-ip:8089/ws`
- **SIP Address (URI):** `sip:1001@your-asterisk-ip`
- **Username:** `1001`
- **Password:** `YourSecretPassword`
- **STUN Server:** `stun:stun.l.google.com:19302`

---

### 2. FreeSWITCH (Verto / WSS)

Enable WSS in `autoload_configs/sip_profiles/internal.xml`:
```xml
<param name="ws-binding" value=":5066"/>
<param name="wss-binding" value=":7443"/>
<param name="tls-cert-dir" value="/etc/freeswitch/tls"/>
<param name="apply-candidate-acl" value="localnet.auto"/>
<param name="local-network-acl" value="localnet.auto"/>
```

#### Connection Settings in Daad:
- **WebSocket URL (WSS):** `wss://your-freeswitch-ip:7443`
- **SIP Address (URI):** `sip:1000@your-freeswitch-ip`
- **Username:** `1000`
- **Password:** `1234`
- **STUN Server:** `stun:stun.l.google.com:19302`

---

## 🧪 Test Suite

Daad includes comprehensive test coverage using **Vitest** and **React Testing Library**:

```bash
bun run test
```

```
 ✓ src/components/DialerPad.test.tsx (5 tests)
 ✓ src/components/RecentCallsView.test.tsx (4 tests)
 ✓ src/components/LandingHero.test.tsx (1 test)
 ✓ src/components/UpdateModal.test.tsx (2 tests)
 ✓ src/components/ActiveCallView.test.tsx (5 tests)
 ✓ src/components/LoginView.test.tsx (4 tests)
 ✓ src/components/SettingsModal.test.tsx (3 tests)
 ✓ src/services/audioDeviceService.test.ts (3 tests)
 ✓ src/services/soundService.test.ts (6 tests)
 ✓ src/services/updateService.test.ts (3 tests)
 ✓ src/services/callHistoryService.test.ts (3 tests)
 ✓ src/services/sipService.test.ts (10 tests)
 ✓ src/components/StatusBar.test.tsx (4 tests)
 ✓ src/components/IncomingCallModal.test.tsx (3 tests)

 Test Files  14 passed (14)
      Tests  56 passed (56)
```

---

## 📄 License

Daad is licensed under the [MIT License](LICENSE).
