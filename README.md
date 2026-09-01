# Daad Softphone 📞

**Daad** is a lightweight, cross-platform softphone desktop application built with **Tauri v2 (Rust)**, **React**, **TypeScript**, **Tailwind CSS**, and **SIP.js (v0.21+)** using WebSockets (WSS) and WebRTC.

---

## Features

- ⚡ **Lightweight & Fast:** Single-window (~360x600px) compact dialer powered by Tauri v2 and Vite.
- 🎙️ **Two-Way WebRTC Audio:** Standard WebRTC audio stream routing with automatic audio track binding and DTMF support.
- 🔄 **SIP.js Telephony Engine:** Registration, outbound/inbound audio calls, real-time connection state management.
- 🎛️ **In-Call Controls:** Mute/Unmute microphone, Hold/Resume call, in-call DTMF Keypad for IVR menus, and Hangup.
- 🎹 **Dual-Frequency Tone Synthesis:** Pure Web Audio API synthesis for zero-dependency DTMF tones, ringback cadence, and melodic ringtones.
- 📥 **System Tray Support:** Minimizes to the system tray on window close (`on_window_event`) with left-click restore and "Show Daad" / "Quit" tray menu.
- ⌨️ **Keyboard Support:** Supports physical keyboard numeric dialing (0-9, *, #, +, Backspace, Enter).

---

## Project Structure

```
Daad/
├── src/
│   ├── components/
│   │   ├── ActiveCallView.tsx    # In-call interface (Timer, Mute, Hold, DTMF, Hangup)
│   │   ├── DialerPad.tsx         # 12-key numeric keypad with physical keyboard listener
│   │   ├── DtmfKeypadModal.tsx   # In-call DTMF dialer drawer for IVR menus
│   │   ├── IncomingCallModal.tsx # Ringing banner with Answer / Decline buttons
│   │   ├── SettingsModal.tsx     # SIP/WSS credentials manager with presets
│   │   └── StatusBar.tsx         # Connection indicator dot & extension badge
│   ├── hooks/
│   │   └── useSip.ts             # React hook orchestrating SIP state and persistence
│   ├── services/
│   │   ├── sipService.ts         # Singleton wrapper over SIP.js UserAgent & Sessions
│   │   └── soundService.ts       # Web Audio API synthesizer (DTMF, ringback, ringtone)
│   ├── types/
│   │   └── sip.ts                # TypeScript interfaces for SIP config & call states
│   ├── App.tsx                   # Main window layout
│   └── main.tsx                  # React entrypoint
└── src-tauri/
    ├── src/
    │   ├── lib.rs                # System tray & window close-to-tray interception
    │   └── main.rs               # Tauri entrypoint
    ├── Info.plist                # macOS microphone permission description
    └── tauri.conf.json           # Window dimensions (360x600) & capabilities
```

---

## Getting Started

### Prerequisites
- **Bun** (v1.0+) or Node.js (v18+)
- **Rust & Cargo** (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)

### Development

Run the frontend and desktop app in development mode with Bun:
```bash
bun run tauri dev
```

Or run the web frontend only:
```bash
bun run dev
```

### Production Build

Build the desktop bundle (DMG/App on macOS, MSI/EXE on Windows, AppImage/DEB on Linux):
```bash
bun run tauri build
```

---

## PBX Configuration Guide

### 1. Asterisk (PJSIP + WebRTC)

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

#### Settings in Daad:
- **WebSocket Server URL:** `wss://your-asterisk-ip:8089/ws`
- **SIP URI:** `sip:1001@your-asterisk-ip`
- **Username:** `1001`
- **Password:** `YourSecretPassword`
- **STUN Server:** `stun:stun.l.google.com:19302`

---

### 2. FreeSWITCH (WSS + WebRTC)

Ensure the internal SIP profile enables WSS in `autoload_configs/sip_profiles/internal.xml`:
```xml
<param name="ws-binding" value=":5066"/>
<param name="wss-binding" value=":7443"/>
<param name="tls-cert-dir" value="/etc/freeswitch/tls"/>
```

#### Settings in Daad:
- **WebSocket Server URL:** `wss://your-freeswitch-ip:7443`
- **SIP URI:** `sip:1000@your-freeswitch-ip`
- **Username:** `1000`
- **Password:** `1234`
- **STUN Server:** `stun:stun.l.google.com:19302`

> **Note for Self-Signed Certificates:**
> If your PBX uses a self-signed TLS certificate, navigate to the WebSocket URL in your browser once (e.g. `https://your-pbx:8089/ws` or `https://your-pbx:7443`) and click "Proceed / Accept Certificate" so the Webview trust store accepts the connection.

---

## Troubleshooting

### macOS: "“Daad” is damaged and can’t be opened. You should move it to the Trash."
This is a standard macOS Gatekeeper check for apps downloaded from the internet that are not signed with a paid Apple Developer certificate.

To bypass this on your Mac:
1. Move `Daad.app` to your `/Applications` folder.
2. Open your terminal and run:
   ```bash
   xattr -cr /Applications/Daad.app
   ```
3. Or open **System Settings $\rightarrow$ Privacy & Security**, scroll down to the **Security** section, and click **"Open Anyway"**.
