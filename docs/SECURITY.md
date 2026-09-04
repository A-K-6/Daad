# Security Policy — Daad Softphone

## 1. Credential storage (keystore per OS)

Device-scoped SIP credentials must live in the OS keystore, never in
`localStorage`, config files, or the repo:

| Platform | Store | Access path |
|---|---|---|
| macOS | Keychain (`kSecClassGenericPassword`, `kSecAttrService = "daad-sip"`) | Tauri `plugin-keyring` / `security` CLI |
| Windows | Credential Manager (`CredWriteW`, target `daad-sip/<username>`) | Tauri `plugin-keyring` |
| Linux | Secret Service via D-Bus (`libsecret`, collection `daad-sip`) | Tauri `plugin-keyring` |
| iOS / Android | Keychain / EncryptedSharedPreferences | Tauri mobile keyring shim |
| Web preview | Memory only (session-scoped); warn before persist | — |

Rules:
- One entry per device per extension (device-scoped creds only).
- Passwords are write-once / read-on-use; the UI never renders them
  except inside a masked `<input type="password">` during entry.
- Export, copy-to-clipboard, and crash-dump inclusion of secrets are forbidden.

## 2. Redaction policy (logs, pcaps, bug reports)

- `console.log/warn/error` must never print: passwords, SIP
  `Authorization` / `Proxy-Authenticate` response hashes, cert private
  keys, full SIP URIs containing secrets, or Call Service / ARI / admin
  credentials (which must not exist client-side at all).
- `docker/asterisk/config/logger.conf` keeps `pjsip set logger` OFF by
  default. Captures are opt-in, local-only, and gitignored
  (`*.pcap`, `*.pcapng`, raw `*.log` under `docker/asterisk/captures/`).
- Only `*.sanitized.log` files produced via
  `docker/asterisk/scripts/redact-pcap.sh` may be committed. The script
  strips Digest `response=`, `Authorization:` material, `password=` and
  `secret=` values.
- CI runs `bun run lint`, which fails on `password`/`secret` literals in
  committed fixture configs and on raw captures.

## 3. What the client must NEVER hold

- No Call Service credentials, no Asterisk ARI username/password, no
  AMI credentials, no admin tokens. The client speaks SIP (+SDES-SRTP)
  as a plain endpoint; management-plane access stays server-side.
- No CA private keys. `gen-certs.sh` output is throwaway test material
  confined to the gitignored `docker/asterisk/certs/` directory.

## 4. Transport & media invariants

- TLS verification is ON by default and **fail-closed**: an untrusted /
  expired / hostname-mismatched PBX certificate aborts registration with
  `RegistrationFailed`. `allowInsecure` exists only for explicitly
  user-consented private-IP PBX onboarding and must surface a persistent
  UI warning while active.
- SDES-SRTP is mandatory on TLS endpoints (`media_encryption=sdes`).
  The client must never silently downgrade to plain RTP; if crypto
  negotiation fails the call fails loudly.
- Offered codecs are PCMU/PCMA only; DTMF is RFC 4733 out-of-band.

## 5. Dial-plan restriction

- The client dialer accepts **numeric destinations only** (`^[0-9+*#]+$`,
  max 32 chars). `sip:` URIs, letters, and `@`-routes are rejected
  before any INVITE is constructed (see `makeCall` validation).
- The fixture dial plan mirrors this server-side: extensions
  `1001/1002`, echo `600`, probe `699`, catch-all `Hangup(21)`.
  No trunks, no PSTN breakout.

## 6. Registration hygiene

- Single-contact binding (`max_contacts=1`, `remove_existing=yes`).
  Re-REGISTER / refresh / network-change must replace, never accumulate.
- Logout performs full teardown: unregister → stop UserAgent → stop
  native bridge → clear timers/streams. Post-logout the fixture must
  show zero channels, zero bridges, zero contacts
  (`pjsip show contacts/channels`, `bridge show all`).
