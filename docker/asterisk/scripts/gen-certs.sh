#!/usr/bin/env bash
# Generate a throwaway self-signed CA + server cert for the TEST fixture.
# Output goes to docker/asterisk/certs/ (gitignored) and is mounted into
# the container at /etc/asterisk/keys. NEVER commit the output.
set -euo pipefail
OUT="$(cd "$(dirname "$0")/../certs" && pwd)"
mkdir -p "$OUT"
CN="${DAAD_TEST_CN:-127.0.0.1}"

openssl req -x509 -newkey rsa:2048 -sha256 -days 30 -nodes \
  -keyout "$OUT/asterisk.key" -out "$OUT/asterisk.crt" \
  -subj "/CN=$CN" \
  -addext "subjectAltName=IP:127.0.0.1,DNS:localhost,DNS:asterisk" 2>/dev/null
cp "$OUT/asterisk.crt" "$OUT/ca.crt"
chmod 600 "$OUT/asterisk.key"
echo "Test certs written to $OUT (CN=$CN). Do not commit."
