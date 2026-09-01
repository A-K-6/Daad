# Daad Telephony SDK Guide

The **Daad Telephony SDK** (`@/sdk`) enables developers to embed complete SIP/WebRTC telephony into web applications, mobile apps (React Native, Capacitor, Ionic), and custom portals in just a few lines of code.

---

## 📦 What's in the SDK?

1. **`DaadClient` (Headless Telephony Engine):** Complete control over SIP registration, outbound calling, inbound call handling, audio devices, mute/hold, and DTMF tones without UI constraints.
2. **`<DaadPhoneWidget />` (Embeddable React Softphone):** Complete, obsidian dark, pre-built softphone widget that drops into any React/Next.js/Vite application.

---

## ⚡ Quickstart: Headless `DaadClient`

```typescript
import { createDaadClient } from '@/sdk';

// 1. Initialize client
const phone = createDaadClient({
  serverUrl: 'tls://10.41.113.71:5061', // Or 'wss://pbx:8089/ws', 'tcp://pbx:5060'
  sipUri: 'sip:host-1001@10.41.113.71',
  username: 'host-1001',
  password: 'your_sip_password',
  displayName: 'Support Agent',
});

// 2. Subscribe to events
phone.on('connection:state', (state, error) => {
  console.log('Connection state:', state, error);
});

phone.on('call:incoming', (caller, info) => {
  console.log('Incoming call from:', caller);
  // phone.answer(); or phone.reject();
});

phone.on('call:state', (state, info) => {
  console.log('Call state:', state, info?.duration);
});

// 3. Connect & make calls
await phone.connect();
await phone.call('2001');

// In-call actions:
phone.toggleMute();
await phone.toggleHold();
phone.sendDTMF('5');
await phone.hangup();
```

---

## 🎨 Quickstart: Embeddable React Widget

Drop the complete Daad softphone directly into your UI:

```tsx
import React from 'react';
import { DaadPhoneWidget } from '@/sdk';

export const MyDashboard: React.FC = () => {
  return (
    <div className="p-8">
      <h1 className="text-xl font-bold">Customer Support Portal</h1>
      <div className="mt-4">
        <DaadPhoneWidget
          autoConnect={true}
          initialConfig={{
            serverUrl: 'tls://10.41.113.71:5061',
            sipUri: 'sip:host-1001@10.41.113.71',
            username: 'host-1001',
            password: 'secretPassword',
          }}
        />
      </div>
    </div>
  );
};
```

---

## 📡 Supported Protocols

| Transport | URI Scheme | Default Port | Description |
| :--- | :--- | :--- | :--- |
| **TLS** | `tls://` | `5061` | Raw encrypted SIP over TLS socket (Asterisk, FreeSWITCH) |
| **TCP** | `tcp://` | `5060` | Raw unencrypted SIP over TCP stream |
| **UDP** | `udp://` | `5060` | Raw SIP over UDP datagrams |
| **WSS** | `wss://` | `8089` / `7443` | SIP over Secure WebSockets (WebRTC) |

---

## 🎛️ API Reference

### `DaadClient` Methods

| Method | Parameters | Returns | Description |
| :--- | :--- | :--- | :--- |
| `connect(config?)` | `SipConfig` | `Promise<void>` | Connects and registers with PBX |
| `disconnect()` | - | `Promise<void>` | Unregisters and closes session |
| `call(target)` | `target: string` | `Promise<void>` | Places an outbound voice call |
| `answer()` | - | `Promise<void>` | Answers an incoming ringing call |
| `reject()` | - | `Promise<void>` | Rejects an incoming call |
| `hangup()` | - | `Promise<void>` | Terminates the active call |
| `toggleMute()` | - | `boolean` | Toggles local microphone mute state |
| `toggleHold()` | - | `Promise<boolean>` | Toggles call on-hold status (re-INVITE) |
| `sendDTMF(tone)` | `tone: string` | `void` | Sends RFC 4733 DTMF dual-tone |
| `getAudioDevices()` | - | `Promise<AudioDevice[]>` | Enumerates microphones and speakers |
| `setAudioDevice(id, kind)` | `id, 'audioinput' \| 'audiooutput'` | `Promise<void>` | Switches active audio hardware |
| `on(event, callback)` | `event, listener` | `() => void` | Subscribes to events with unsubscribe function |
