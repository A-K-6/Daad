# PBX Setup Guide • Asterisk, FreeSWITCH & Kamailio

Daad supports any PBX server capable of WebSocket transport (**WSS**) and **WebRTC** audio.

---

## 1. Asterisk (PJSIP + WebSockets)

### Step 1: Enable HTTP/WSS in `http.conf`
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

### Step 2: Configure Endpoint in `pjsip.conf`
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

---

## 2. FreeSWITCH (Verto / WSS)

### Enable WSS in `autoload_configs/sip_profiles/internal.xml`
```xml
<param name="ws-binding" value=":5066"/>
<param name="wss-binding" value=":7443"/>
<param name="tls-cert-dir" value="/etc/freeswitch/tls"/>
<param name="apply-candidate-acl" value="localnet.auto"/>
<param name="local-network-acl" value="localnet.auto"/>
```

---

## 3. Self-Signed TLS Certificates Notice

When connecting to a local PBX with a self-signed TLS certificate:
1. Open the WSS URL in your browser once (e.g. `https://your-pbx:8089/ws` or `https://your-pbx:7443`).
2. Click **"Advanced" $\rightarrow$ "Proceed / Accept Certificate"**.
3. Daad will now connect and register securely over WSS.
