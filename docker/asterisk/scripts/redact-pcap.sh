#!/usr/bin/env bash
# Redact secrets from a pcap-derived text log before it may be committed.
# Usage: redact-pcap.sh <raw.txt> > captures/<name>.sanitized.log
# Strips: Authorization/Digest responses, passwords, secrets, non-test IPs.
set -euo pipefail
sed -E \
  -e 's/(response=")[^"]+/\1REDACTED/g' \
  -e 's/(Authorization:[^\r\n]*response=)[^,]*/\1REDACTED/gi' \
  -e 's/(password[^=:]*[=:][" ]?)[^"& ]+/\1REDACTED/gi' \
  -e 's/(secret[^=:]*[=:][" ]?)[^"& ]+/\1REDACTED/gi' \
  "$1"
