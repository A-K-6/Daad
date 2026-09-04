//! Sanitised diagnostics: redact everything identifying before export.
//!
//! Redaction targets: phone numbers / extensions, SIP URIs, IP addresses,
//! Call-IDs / branches / nonces, and any credential-bearing header
//! (`Authorization`, `Proxy-Authenticate`, passwords, SDP `crypto` lines).
//! The webview only ever receives the sanitised form.

/// Redact credential-bearing SIP headers (whole value → `[REDACTED]`).
fn redact_secret_headers(line: &str) -> Option<String> {
    let lower = line.to_ascii_lowercase();
    for key in [
        "authorization:",
        "proxy-authorization:",
        "proxy-authenticate:",
        "www-authenticate:",
        "p-asserted-identity:",
    ] {
        if lower.trim_start().starts_with(key) {
            let name = line[..line.find(':').unwrap_or(line.len())].trim().to_string();
            return Some(format!("{name}: [REDACTED]"));
        }
    }
    if lower.contains("password") && lower.contains(':') {
        let name = line[..line.find(':').unwrap_or(line.len())].trim().to_string();
        return Some(format!("{name}: [REDACTED]"));
    }
    None
}

/// Redact an IPv4 literal inside a string.
fn redact_ipv4(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            // Try to match N.N.N.N with 1-3 digits per group.
            let mut groups: Vec<&str> = Vec::new();
            let mut pos = i;
            let mut ok = true;
            for _ in 0..4 {
                let mut len = 0;
                while pos + len < bytes.len()
                    && bytes[pos + len].is_ascii_digit()
                    && len < 3
                {
                    len += 1;
                }
                if len == 0 {
                    ok = false;
                    break;
                }
                groups.push(&s[pos..pos + len]);
                pos += len;
                if groups.len() < 4 {
                    if pos < bytes.len() && bytes[pos] == b'.' {
                        pos += 1;
                    } else {
                        ok = false;
                        break;
                    }
                }
            }
            if ok && groups.iter().all(|g| g.parse::<u8>().is_ok()) {
                // Boundary check: not part of a longer digit/dot run.
                let before_ok =
                    i == 0 || (!bytes[i - 1].is_ascii_digit() && bytes[i - 1] != b'.');
                let after_ok =
                    pos >= bytes.len() || (!bytes[pos].is_ascii_digit() && bytes[pos] != b'.');
                if before_ok && after_ok {
                    out.push_str("[IP]");
                    i = pos;
                    continue;
                }
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

/// Redact the user part of `sip:user@` / `sips:user@` / `tel:+...` URIs.
fn redact_sip_users(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let rest = &s[i..];
        let lower = rest.to_ascii_lowercase();
        let mut matched: Option<&str> = None;
        for scheme in ["sips:", "sip:", "tel:"] {
            if lower.starts_with(scheme) {
                matched = Some(scheme);
                break;
            }
        }
        if let Some(scheme) = matched {
            let slen = scheme.len();
            out.push_str(&rest[..slen]);
            let after = &rest[slen..];
            let end = after
                .find(|c| matches!(c, '@' | '>' | '"' | ' ' | '\r' | '\n' | ';' | ','))
                .unwrap_or(after.len());
            // Only treat as a user part when it is non-empty; for sip/sips
            // require the '@' terminator so bare `sip:host` is untouched.
            // The '@...' remainder is NOT appended here: the scan continues
            // there naturally, so it is emitted exactly once.
            let is_user = !after[..end].is_empty()
                && (scheme == "tel:" || after[end.min(after.len())..].starts_with('@'));
            if is_user {
                out.push_str("[USER]");
                i += slen + end;
                continue;
            }
            i += slen;
            continue;
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

/// Sanitize one header line's value for identity-bearing fields.
fn redact_identity_line(line: &str) -> String {
    if let Some(red) = redact_secret_headers(line) {
        return red;
    }
    let lower = line.to_ascii_lowercase();
    let is_identity = ["call-id:", "i:", "branch=", "nonce=", "cnonce=", "tag="]
        .iter()
        .any(|k| lower.contains(k));
    let mut s = line.to_string();
    if lower.trim_start().starts_with("call-id:") || lower.trim_start().starts_with("i:") {
        let name = line[..line.find(':').unwrap_or(line.len())].to_string();
        return format!("{name}: [CALL-ID]");
    }
    if is_identity {
        s = redact_token_values(s);
    }
    s = redact_sip_users(&s);
    s = redact_ipv4(&s);
    // SDP crypto lines carry SRTP keys — drop the key material entirely.
    if lower.trim_start().starts_with("a=crypto") {
        return "a=crypto: [REDACTED]".to_string();
    }
    s
}

/// Redact one token value (up to a delimiter) starting at `after`.
/// Returns `(redacted_segment, rest)`.
fn redact_one_token(after: &str) -> (String, &str) {
    let a = after.strip_prefix('"').unwrap_or(after);
    let end = a
        .find(|c| matches!(c, '"' | ';' | ',' | ' ' | '\r' | '\n' | '>'))
        .unwrap_or(a.len());
    let mut rest = &a[end..];
    rest = rest.strip_prefix('"').unwrap_or(rest);
    ("[ID]".to_string(), rest)
}

fn redact_token_values(s: String) -> String {
    // Redact branch=/nonce=/cnonce=/tag= token values (repeat occurrences).
    let mut out = s;
    for key in ["branch=", "nonce=", "cnonce=", "tag="] {
        let mut res = String::with_capacity(out.len());
        let mut rest = out.as_str();
        loop {
            let low = rest.to_ascii_lowercase();
            let Some(idx) = low.find(key) else {
                res.push_str(rest);
                break;
            };
            res.push_str(&rest[..idx + key.len()]);
            let (seg, remaining) = redact_one_token(&rest[idx + key.len()..]);
            res.push_str(&seg);
            rest = remaining;
        }
        out = res;
    }
    out
}

/// Sanitize a full SIP message (request/status + headers + body).
///
/// Only true request lines (`METHOD SP ...`) and the `SIP/2.0` status line
/// take the light path. Every other line — including `Via:` (which embeds
/// `SIP/2.0/<transport>`) — goes through full identity redaction so branch
/// tags and sent-by IPs never leak.
pub fn sanitize_sip_message(msg: &str) -> String {
    const METHODS: [&str; 13] = [
        "REGISTER ", "INVITE ", "ACK ", "BYE ", "CANCEL ", "OPTIONS ",
        "SUBSCRIBE ", "NOTIFY ", "REFER ", "PRACK ", "UPDATE ", "MESSAGE ",
        "INFO ",
    ];
    msg.lines()
        .map(|line| {
            if line.starts_with("SIP/2.0") || METHODS.iter().any(|m| line.starts_with(m)) {
                return redact_ipv4(&redact_sip_users(line));
            }
            redact_identity_line(line)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Sanitize an arbitrary log line (URIs, IPs, secrets).
pub fn sanitize_log(line: &str) -> String {
    redact_ipv4(&redact_sip_users(&redact_identity_line(line)))
}

/// Sanitised snapshot for `diagnostics_export_sanitized`. Contains NO
/// secrets, NO raw URIs, NO IPs — only state names and counters.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SanitizedDiagnostics {
    pub account_id: String,
    pub account_state: String,
    pub transport: String,
    pub registered: bool,
    pub failed_attempts: u32,
    pub events_total: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uris_redacted() {
        let out = sanitize_log("From: <sip:2001@10.0.0.5>;tag=abc");
        assert!(!out.contains("2001@"), "{out}");
        assert!(!out.contains("10.0.0.5"), "{out}");
        assert!(out.contains("[USER]") && out.contains("[IP]"), "{out}");
    }

    #[test]
    fn credential_headers_fully_redacted() {
        for line in [
            "Authorization: Digest username=\"2001\", response=\"abcd\"",
            "Proxy-Authorization: Digest username=\"2001\"",
            "WWW-Authenticate: Digest realm=\"x\", nonce=\"abc\"",
            "X-Password: hunter2",
        ] {
            let out = sanitize_log(line);
            assert!(!out.contains("2001"), "{out}");
            assert!(!out.contains("hunter2"), "{out}");
            assert!(out.contains("[REDACTED]"), "{out}");
        }
    }

    #[test]
    fn call_id_and_branch_redacted() {
        let out = sanitize_log("Call-ID: abc123@host");
        assert!(!out.contains("abc123"), "{out}");
        assert!(out.contains("[CALL-ID]"), "{out}");
        let out = sanitize_log("Via: SIP/2.0/TLS 1.2.3.4:5061;branch=z9hG4bK999");
        assert!(!out.contains("z9hG4bK999"), "{out}");
        assert!(!out.contains("1.2.3.4"), "{out}");
    }

    #[test]
    fn sdp_crypto_keys_dropped() {
        let out = sanitize_log("a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:SECRETKEYDATA...");
        assert!(!out.contains("SECRETKEYDATA"), "{out}");
        assert!(out.contains("[REDACTED]"), "{out}");
    }

    #[test]
    fn request_line_user_and_ip_redacted() {
        let msg = "INVITE sip:2002@10.0.0.5 SIP/2.0\r\nCall-ID: xyz\r\nContent-Length: 0";
        let out = sanitize_sip_message(msg);
        assert!(!out.contains("2002@"), "{out}");
        assert!(!out.contains("10.0.0.5"), "{out}");
        assert!(!out.contains("xyz"), "{out}");
    }

    #[test]
    fn full_register_message_sanitized() {
        let msg = "REGISTER sip:pbx.example.com SIP/2.0\r\n\
Via: SIP/2.0/TLS 192.168.1.10:5070;branch=z9hG4bKabc;rport\r\n\
From: <sip:2001@pbx.example.com>;tag=deadbeef\r\n\
To: <sip:2001@pbx.example.com>\r\n\
Call-ID: my-call-id-123\r\n\
CSeq: 1 REGISTER\r\n\
Authorization: Digest username=\"2001\", response=\"secret-hash\"\r\n\
Contact: <sip:2001@192.168.1.10:5070;transport=tls>\r\n";
        let out = sanitize_sip_message(msg);
        for secret in ["2001", "192.168.1.10", "z9hG4bKabc", "deadbeef", "my-call-id-123", "secret-hash"] {
            assert!(!out.contains(secret), "leaked {secret}: {out}");
        }
        // Structure survives redaction (still a readable REGISTER trace).
        assert!(out.contains("REGISTER"), "{out}");
        assert!(out.contains("CSeq: 1 REGISTER"), "{out}");
    }

    #[test]
    fn plain_text_without_pii_passes_through() {
        let out = sanitize_log("SIP bridge shutting down listener");
        assert_eq!(out, "SIP bridge shutting down listener");
    }
}
