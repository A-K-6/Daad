# Telephony Engine Deep Dive • Daad

Daad's telephony engine is powered by **SIP.js (v0.21+)** and the standard **WebRTC** API.

---

## 📞 Key Interfaces & Subsystems

### 1. `SipService` (`src/services/sipService.ts`)
Encapsulates SIP.js core objects:
- `UserAgent`: Manages WebSocket transport and account identity.
- `Registerer`: Maintains registration state and expires timer.
- `Inviter`: Handles outbound session creation and SDP offer negotiation.
- `Invitation`: Handles inbound session requests, acceptance, and rejection.
- `Session`: Manages active audio streams, mute toggling, on-hold re-invites, and hangup signals (`BYE`/`CANCEL`).

### 2. Audio Track Routing & Lifecycle
When a call enters `SessionState.Established`:
1. The remote `RTCPeerConnection` fires `ontrack` events.
2. Remote tracks are assigned to the `<audio id="remoteAudio" autoplay />` HTML5 element.
3. Upon termination, tracks are stopped and detached, clearing memory and peer listeners.

### 3. Audio Device Selection (`src/services/audioDeviceService.ts`)
- Queries hardware input and output devices using `navigator.mediaDevices.enumerateDevices()`.
- Dynamically responds to peripheral changes (`devicechange` event).
- Sets `sinkId` on audio output element where supported.

### 4. Zero-Asset Audio Synthesizer (`src/services/soundService.ts`)
- Pure Web Audio API tone synthesis.
- Generates standard DTMF row/column dual frequencies on demand without loading external audio files.
