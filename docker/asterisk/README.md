# Isolated Asterisk fixture — TEST ONLY

Deterministic local PBX implementing the JBM contract. No production
credentials or captures live in this repo — ever.

## Contract implemented

| Item | Value |
|---|---|
| SIP/TLS | `0.0.0.0:5061` (`transport-tls`), TLSv1.2+ |
| Fallback | TCP/UDP `5060` |
| Media security | `media_encryption=sdes` (mandatory SDES-SRTP) |
| Codecs | `disallow=all` + `allow=ulaw,alaw` (PCMU/PCMA only) |
| DTMF | `dtmf_mode=rfc4733` |
| RTP range | `10000–10199` (`rtp.conf`, `strictrtp=yes`) |
| NAT/VPN recovery | `rtp_symmetric=yes`, `rewrite_contact=yes`, `force_rport=yes`, `direct_media=no` |
| Single contact | `max_contacts=1`, `remove_existing=yes` per AOR |
| Registration expiry | default 600s, min 60s, max 3600s |
| Dial plan | `1001 ↔ 1002`, echo `600`, probe `699`, catch-all reject |

## Bring-up (local only)

```bash
cd docker/asterisk
./scripts/gen-certs.sh            # throwaway self-signed certs → certs/ (gitignored)
cp .env.example .env              # fill device-scoped TEST passwords (gitignored)
docker compose up --build
```

`.env.example` contains placeholder values only. Real passwords are
generated per-run (e.g. `openssl rand -hex 16`) and never committed.

## Captures

Raw `.pcap`/`.pcapng` and unredacted logs are gitignored. To share
evidence, export text + run through `scripts/redact-pcap.sh` and commit
only the `.sanitized.log` under `captures/`.

## Zero-orphan check after logout

```bash
docker exec daad-asterisk-test asterisk -rx "pjsip show contacts"   # expect 0 after both clients log out
docker exec daad-asterisk-test asterisk -rx "pjsip show channels"   # expect 0 after hangup
docker exec daad-asterisk-test asterisk -rx "bridge show all"       # expect 0 after hangup
```

The integration suite (`src/test/integration/`) asserts the static
contract; live checks above are gated behind `DAAD_LIVE_ASTERISK=1` and
documented in `docs/ACCEPTANCE.md`.
