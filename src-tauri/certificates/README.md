# Core trust certificate

`neda-core-ca.pem` is the existing **public** CA certificate retrieved read-only
from Core's `/opt/jbm-os-call-service/.local/tls/ca.crt` on 2026-09-05.
No private key is included. No server configuration or certificate was changed.

SHA-256 fingerprint:
`94:85:9A:D9:CE:50:DA:67:B5:3B:15:15:B7:10:5F:33:56:A9:12:45:BD:43:50:E6:29:77:08:5E:C7:CD:86:F0`

The native client selects this CA automatically only for TLS connections to
`10.41.113.71` when the user has not supplied a custom CA. Explicit CA settings
take precedence. Server certificate chain, expiry, and address verification
remain enabled. Other servers do not inherit this private trust anchor.

The app does not fetch and automatically trust certificates from an
unauthenticated SIP connection. If this CA changes, obtain its replacement
through an authenticated channel and update this file or import it in Settings.
