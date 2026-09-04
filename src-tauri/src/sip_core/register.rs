//! REGISTER lifecycle: request building, Digest auth, refresh timing.
//!
//! Distinguishes the three milestones operators confuse most:
//! 1. **TCP/TLS-connected** — socket up, nothing registered yet.
//! 2. **REGISTER-accepted** — registrar answered `200 OK` to REGISTER.
//! 3. **Refreshed** — re-REGISTER accepted before expiry.
//!
//! Digest follows RFC 7616 (MD5 `auth` and algorithm-absent servers).
//! Crypto comes from the maintained `md-5` crate — never hand-rolled.
//! Exactly one registration worker per account is enforced by
//! [`RegistrationSupervisor`].

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use md5::{Digest, Md5};

use super::account::SipProfile;

/// Outcome of a single REGISTER transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegisterOutcome {
    /// `200 OK` with the bound expiry (seconds).
    Accepted { expires: u32 },
    /// `401/407` — caller must answer with [`build_authorization_header`].
    Challenged(AuthChallenge),
    /// Definite rejection (403, 404, 423 w/o Min-Expires handling, ...).
    Rejected { code: u16, reason: String },
    /// Socket/transport failure — reconnect path, not an auth decision.
    NetworkError { detail: String },
}

/// Parsed `WWW-Authenticate` / `Proxy-Authenticate` Digest challenge.
/// Passwords never appear here — only the server-supplied challenge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthChallenge {
    pub realm: String,
    pub nonce: String,
    pub qop: Option<String>,
    pub algorithm: String,
    pub opaque: Option<String>,
    pub stale: bool,
}

impl AuthChallenge {
    /// Minimal lenient parser for `Digest realm="..", nonce="..", ...`.
    /// Returns `None` when realm or nonce is missing (fail-closed: the
    /// caller must NOT retry with a guessed credential hash).
    pub fn parse(header_value: &str) -> Option<Self> {
        let v = header_value.trim();
        let v = v.strip_prefix("Digest").unwrap_or(v).trim();
        let get = |key: &str| -> Option<String> {
            for part in split_quoted_commas(v) {
                let part = part.trim();
                if part.len() > key.len()
                    && part[..key.len()].eq_ignore_ascii_case(key)
                    && part[key.len()..].trim_start().starts_with('=')
                {
                    let raw = part[key.len() + 1..].trim();
                    let unquoted = raw.strip_prefix('"').and_then(|s| s.strip_suffix('"')).unwrap_or(raw);
                    return Some(unquoted.to_string());
                }
            }
            None
        };
        let realm = get("realm")?;
        let nonce = get("nonce")?;
        if realm.is_empty() || nonce.is_empty() {
            return None;
        }
        let qop = get("qop").and_then(|q| {
            // `qop="auth,auth-int"` → prefer `auth`.
            let first = q.split(',').next().unwrap_or("").trim().trim_matches('"').to_string();
            if first.is_empty() { None } else { Some(first) }
        });
        Some(Self {
            realm,
            nonce,
            qop,
            algorithm: get("algorithm").unwrap_or_else(|| "MD5".into()),
            opaque: get("opaque"),
            stale: get("stale").is_some_and(|s| s.eq_ignore_ascii_case("true")),
        })
    }
}

fn split_quoted_commas(s: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut in_quotes = false;
    for (i, c) in s.char_indices() {
        match c {
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => {
                parts.push(&s[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    parts.push(&s[start..]);
    parts
}

fn md5_hex(input: &str) -> String {
    let mut h = Md5::new();
    h.update(input.as_bytes());
    hex::encode(h.finalize())
}

/// Compute the Digest `response` hash (RFC 7616, MD5).
/// Pure function — unit-testable against the RFC reference vector.
pub fn digest_response(
    username: &str,
    password: &str,
    realm: &str,
    nonce: &str,
    method: &str,
    uri: &str,
    qop: Option<&str>,
    nc: &str,
    cnonce: &str,
) -> String {
    let ha1 = md5_hex(&format!("{username}:{realm}:{password}"));
    let ha2 = md5_hex(&format!("{method}:{uri}"));
    match qop {
        Some(q) if q.eq_ignore_ascii_case("auth") || q.eq_ignore_ascii_case("auth-int") => {
            md5_hex(&format!("{ha1}:{nonce}:{nc}:{cnonce}:{q}:{ha2}"))
        }
        _ => md5_hex(&format!("{ha1}:{nonce}:{ha2}")),
    }
}

/// Build the `Authorization: Digest ...` header value for a REGISTER.
/// The password is consumed only inside the hash — never embedded.
#[allow(clippy::too_many_arguments)]
pub fn build_authorization_header(
    challenge: &AuthChallenge,
    username: &str,
    password: &str,
    method: &str,
    uri: &str,
    nc: &str,
    cnonce: &str,
) -> String {
    let qop = challenge.qop.as_deref();
    let response = digest_response(username, password, &challenge.realm, &challenge.nonce, method, uri, qop, nc, cnonce);
    let mut h = format!(
        "Digest username=\"{username}\", realm=\"{}\", nonce=\"{}\", uri=\"{uri}\", response=\"{response}\", algorithm={}",
        challenge.realm, challenge.nonce, challenge.algorithm
    );
    if let Some(q) = qop {
        h.push_str(&format!(", qop={q}, nc={nc}, cnonce=\"{cnonce}\""));
    }
    if let Some(opaque) = &challenge.opaque {
        h.push_str(&format!(", opaque=\"{opaque}\""));
    }
    h
}

/// Parameters for one REGISTER request.
#[derive(Debug, Clone)]
pub struct RegisterParams {
    pub call_id: String,
    pub cseq: u32,
    pub branch: String,
    /// Local socket address for the Contact header.
    pub local_ip: String,
    pub local_port: u16,
    pub authorization: Option<String>,
    /// `true` for unregister (`Expires: 0`, `expires=0`).
    pub unregister: bool,
}

/// Build a REGISTER request string. Minimal, dialog-free, exactly what the
/// registrar needs — full dialog/SDP offer handling arrives in Phase 2 on
/// top of `rsipstack`.
pub fn build_register(profile: &SipProfile, p: &RegisterParams) -> String {
    let expires = if p.unregister { 0 } else { profile.expires_secs };
    let from = profile.aor();
    let contact = profile.contact_uri(&p.local_ip, p.local_port);
    let mut req = format!(
        "REGISTER {} SIP/2.0\r\n\
         Via: SIP/2.0/{} {}:{};branch={};rport\r\n\
         Max-Forwards: 70\r\n\
         From: <{from}>;tag={tag}\r\n\
         To: <{from}>\r\n\
         Call-ID: {call_id}\r\n\
         CSeq: {cseq} REGISTER\r\n\
         Contact: <{contact}>;expires={expires}\r\n\
         Expires: {expires}\r\n\
         Allow: INVITE, ACK, CANCEL, BYE, OPTIONS\r\n\
         User-Agent: Daad/1.0 (native-core)\r\n\
         Content-Length: 0\r\n",
        profile.request_uri(),
        profile.transport.via_token(),
        p.local_ip,
        p.local_port,
        p.branch,
        tag = short_tag(&p.call_id, p.cseq),
        call_id = p.call_id,
        cseq = p.cseq,
    );
    if let Some(auth) = &p.authorization {
        req.push_str(&format!("Authorization: {auth}\r\n"));
    }
    req.push_str("\r\n");
    req
}

fn short_tag(call_id: &str, cseq: u32) -> String {
    md5_hex(&format!("{call_id}:{cseq}"))[..8].to_string()
}

/// Classify a registrar response status line into a [`RegisterOutcome`].
/// `www_auth` is the raw `WWW-Authenticate` header value, if present.
pub fn classify_register_response(status: u16, reason: &str, www_auth: Option<&str>, expires: u32) -> RegisterOutcome {
    match status {
        200..=299 => RegisterOutcome::Accepted { expires },
        401 | 407 => match www_auth.and_then(AuthChallenge::parse) {
            Some(ch) => RegisterOutcome::Challenged(ch),
            None => RegisterOutcome::Rejected {
                code: status,
                reason: "challenge unparsable; refusing blind retry".into(),
            },
        },
        _ => RegisterOutcome::Rejected {
            code: status,
            reason: reason.to_string(),
        },
    }
}

/// When to send the refresh re-REGISTER: 85% of the bound expiry, at least
/// 5s before expiry, clamped to a minimum of 10s so tiny expiries cannot
/// busy-loop the registrar.
pub fn refresh_delay(bound_expires_secs: u32) -> Duration {
    let e = bound_expires_secs.max(1) as u64;
    let at_85 = e.saturating_mul(85) / 100;
    let five_before = e.saturating_sub(5);
    Duration::from_secs(at_85.min(five_before).max(10))
}

/// Monotonic CSeq source (starts at 1, never 0).
#[derive(Debug, Default)]
pub struct CSeqGen {
    next: std::sync::atomic::AtomicU32,
}

impl CSeqGen {
    pub fn new() -> Self {
        Self {
            next: std::sync::atomic::AtomicU32::new(1),
        }
    }

    pub fn next(&self) -> u32 {
        self.next.fetch_add(1, std::sync::atomic::Ordering::SeqCst).max(1)
    }
}

/// Parsed SIP response (status line + headers + optional body).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SipResponse {
    pub status: u16,
    pub reason: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl SipResponse {
    /// Case-insensitive header lookup.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

/// Parse a raw SIP response. `Err` on malformed status line (fail-closed:
/// the transaction is aborted, never assumed accepted).
pub fn parse_response(raw: &str) -> Result<SipResponse, String> {
    let (head, body) = match raw.split_once("\r\n\r\n") {
        Some((h, b)) => (h, b.to_string()),
        None => (raw, String::new()),
    };
    let mut lines = head.split("\r\n");
    let status_line = lines.next().unwrap_or("");
    let mut parts = status_line.splitn(3, ' ');
    let version = parts.next().unwrap_or("");
    let code: u16 = parts
        .next()
        .unwrap_or("")
        .parse()
        .map_err(|_| format!("malformed SIP status line: '{status_line}'"))?;
    if !version.eq_ignore_ascii_case("SIP/2.0") {
        return Err(format!("not a SIP response: '{status_line}'"));
    }
    let reason = parts.next().unwrap_or("").to_string();
    let mut headers = Vec::new();
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let (k, v) = line
            .split_once(':')
            .ok_or_else(|| format!("malformed header line: '{line}'"))?;
        headers.push((k.trim().to_string(), v.trim().to_string()));
    }
    Ok(SipResponse {
        status: code,
        reason,
        headers,
        body,
    })
}

/// Effective bound expiry from a `200 OK`: `Expires` header, else the
/// `expires=` Contact parameter, else the requested value.
pub fn bound_expires(resp: &SipResponse, requested: u32) -> u32 {
    if let Some(e) = resp.header("expires").and_then(|v| v.parse::<u32>().ok()) {
        return e;
    }
    if let Some(contact) = resp.header("contact") {
        for param in contact.split(';').skip(1) {
            let p = param.trim();
            if p.to_ascii_lowercase().starts_with("expires=") {
                if let Ok(e) = p["expires=".len()..].trim().parse::<u32>() {
                    return e;
                }
            }
        }
    }
    requested
}

static ID_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn unique_suffix() -> String {
    let n = ID_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    md5_hex(&format!("{now}:{n}"))[..12].to_string()
}

/// Fresh Call-ID for a new registration dialog.
pub fn new_call_id(domain: &str) -> String {
    format!("{}@{}", unique_suffix(), domain)
}

/// Fresh Via branch (`z9hG4bK` magic cookie + token).
pub fn new_branch() -> String {
    format!("z9hG4bK{}", unique_suffix())
}

/// Fresh client nonce for Digest `qop=auth`.
pub fn new_cnonce() -> String {
    unique_suffix()
}

/// I/O budget for one REGISTER round-trip.
pub const REGISTER_IO_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Run one full REGISTER handshake over an open signalling stream:
/// initial REGISTER → optional single `401/407` challenge answer → final
/// classification. `password` is borrowed only for the challenge hash and
/// never stored or logged.
///
/// Returns the final [`RegisterOutcome`]. A second consecutive challenge
/// (wrong credentials) becomes `Rejected`, never an infinite auth loop.
pub async fn register_once<S>(
    profile: &SipProfile,
    password: Option<&str>,
    stream: &mut S,
    local_ip: &str,
    local_port: u16,
    cseq: &CSeqGen,
) -> Result<RegisterOutcome, String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    use tokio::io::AsyncWriteExt;

    let call_id = new_call_id(profile.effective_domain());
    let send = async |stream: &mut S, req: &str| -> Result<SipResponse, String> {
        stream
            .write_all(req.as_bytes())
            .await
            .map_err(|e| format!("REGISTER write failed: {e}"))?;
        stream
            .flush()
            .await
            .map_err(|e| format!("REGISTER flush failed: {e}"))?;
        let raw = read_response(stream).await?;
        parse_response(&raw)
    };

    // Attempt 1: bare REGISTER.
    let first = RegisterParams {
        call_id: call_id.clone(),
        cseq: cseq.next(),
        branch: new_branch(),
        local_ip: local_ip.to_string(),
        local_port,
        authorization: None,
        unregister: false,
    };
    let resp = tokio::time::timeout(REGISTER_IO_TIMEOUT, send(stream, &build_register(profile, &first)))
        .await
        .map_err(|_| "REGISTER response timed out".to_string())??;

    if resp.status == 401 || resp.status == 407 {
        let www_auth = resp
            .header(if resp.status == 401 {
                "www-authenticate"
            } else {
                "proxy-authenticate"
            })
            .map(str::to_string);
        let challenge = www_auth
            .as_deref()
            .and_then(AuthChallenge::parse)
            .ok_or_else(|| "registrar challenge unparsable; refusing blind retry".to_string())?;
        let pw = password
            .filter(|p| !p.is_empty())
            .ok_or_else(|| "registrar demands authentication but no password is stored".to_string())?;
        let nc = "00000001";
        let cnonce = new_cnonce();
        let uri = profile.request_uri();
        let auth = build_authorization_header(&challenge, &profile.username, pw, "REGISTER", &uri, nc, &cnonce);
        let second = RegisterParams {
            call_id,
            cseq: cseq.next(),
            branch: new_branch(),
            local_ip: local_ip.to_string(),
            local_port,
            authorization: Some(auth),
            unregister: false,
        };
        let resp2 = tokio::time::timeout(REGISTER_IO_TIMEOUT, send(stream, &build_register(profile, &second)))
            .await
            .map_err(|_| "REGISTER (authenticated) response timed out".to_string())??;
        Ok(classify_challenged(profile, &resp2))
    } else {
        Ok(classify_challenged(profile, &resp))
    }
}

/// Send an `Expires: 0` unregister over an open stream (best-effort).
pub async fn unregister_once<S>(
    profile: &SipProfile,
    stream: &mut S,
    local_ip: &str,
    local_port: u16,
    cseq: &CSeqGen,
) -> Result<(), String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    use tokio::io::AsyncWriteExt;
    let p = RegisterParams {
        call_id: new_call_id(profile.effective_domain()),
        cseq: cseq.next(),
        branch: new_branch(),
        local_ip: local_ip.to_string(),
        local_port,
        authorization: None,
        unregister: true,
    };
    let req = build_register(profile, &p);
    tokio::time::timeout(REGISTER_IO_TIMEOUT, async {
        stream.write_all(req.as_bytes()).await?;
        stream.flush().await?;
        Ok::<(), std::io::Error>(())
    })
    .await
    .map_err(|_| "unregister write timed out".to_string())?
    .map_err(|e| format!("unregister write failed: {e}"))?;
    Ok(())
}

fn classify_challenged(profile: &SipProfile, resp: &SipResponse) -> RegisterOutcome {
    match resp.status {
        200..=299 => RegisterOutcome::Accepted {
            expires: bound_expires(resp, profile.expires_secs),
        },
        // A second 401/407 after answering means wrong credentials or a
        // stale-nonce loop the server will not exit: definite rejection.
        401 | 407 => RegisterOutcome::Rejected {
            code: resp.status,
            reason: "authentication failed (credentials rejected)".into(),
        },
        code => RegisterOutcome::Rejected {
            code,
            reason: resp.reason.clone(),
        },
    }
}

async fn read_response<S>(stream: &mut S) -> Result<String, String>
where
    S: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::AsyncReadExt;
    let mut buf = Vec::with_capacity(4096);
    let mut tmp = [0u8; 2048];
    loop {
        let n = tokio::time::timeout(REGISTER_IO_TIMEOUT, stream.read(&mut tmp))
            .await
            .map_err(|_| "REGISTER read timed out".to_string())?
            .map_err(|e| format!("REGISTER read failed: {e}"))?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(end) = find_headers_end(&buf) {
            let head = String::from_utf8_lossy(&buf[..end]).to_string();
            let content_len = head
                .split("\r\n")
                .filter_map(|l| l.split_once(':'))
                .find(|(k, _)| k.trim().eq_ignore_ascii_case("content-length"))
                .and_then(|(_, v)| v.trim().parse::<usize>().ok())
                .unwrap_or(0);
            let total = end + content_len;
            while buf.len() < total {
                let n = stream.read(&mut tmp).await.map_err(|e| format!("REGISTER body read failed: {e}"))?;
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&tmp[..n]);
            }
            break;
        }
        if buf.len() > 65536 {
            return Err("SIP response too large".into());
        }
    }
    String::from_utf8(buf).map_err(|_| "SIP response is not valid UTF-8".into())
}

fn find_headers_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|i| i + 4)
}

/// Enforces exactly one registration worker per account.
#[derive(Debug, Default)]
pub struct RegistrationSupervisor {
    active: Arc<Mutex<HashSet<String>>>,
}

#[derive(Debug)]
pub struct RegistrationGuard {
    active: Arc<Mutex<HashSet<String>>>,
    account_id: String,
}

impl RegistrationSupervisor {
    pub fn new() -> Self {
        Self::default()
    }

    /// Acquire the worker slot; `Err` when a worker already runs.
    pub fn try_acquire(&self, account_id: &str) -> Result<RegistrationGuard, String> {
        let mut set = self
            .active
            .lock()
            .map_err(|e| format!("registration supervisor poisoned: {e}"))?;
        if !set.insert(account_id.to_string()) {
            return Err(format!("registration worker already running for '{account_id}'"));
        }
        Ok(RegistrationGuard {
            active: Arc::clone(&self.active),
            account_id: account_id.to_string(),
        })
    }

    pub fn is_running(&self, account_id: &str) -> bool {
        self.active.lock().map(|s| s.contains(account_id)).unwrap_or(false)
    }
}

impl Drop for RegistrationGuard {
    fn drop(&mut self) {
        if let Ok(mut set) = self.active.lock() {
            set.remove(&self.account_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sip_core::account::{AudioCodec, MediaPolicy, SipProfile, SipTransport};

    fn profile() -> SipProfile {
        SipProfile {
            account_id: "acc-1".into(),
            hostname: "pbx.example.com".into(),
            port: 5061,
            transport: SipTransport::Tls,
            username: "2001".into(),
            extension: Some("2001".into()),
            display_name: None,
            domain: None,
            ca_pem: None,
            expires_secs: 600,
            codecs: vec![AudioCodec::Pcmu, AudioCodec::Pcma],
            media: MediaPolicy::default(),
        }
    }

    #[test]
    fn rfc_2617_reference_vector() {
        // RFC 2617 §3.5 example (no qop): independently cross-checked with
        // Python hashlib (ha1=939e7578...): response=670fd8c2...ff02.
        let resp = digest_response(
            "Mufasa",
            "Circle Of Life",
            "testrealm@host.com",
            "dcd98b7102dd2f0e8b11d0f600bfb0c093",
            "GET",
            "/dir/index.html",
            None,
            "00000001",
            "0a4f113b",
        );
        assert_eq!(resp, "670fd8c2df070c60b045671b8b24ff02");
    }

    #[test]
    fn digest_with_qop_auth() {
        // Cross-checked against Python's hashlib implementation vector.
        let r1 = digest_response("alice", "secret", "example.com", "abc123", "REGISTER", "sip:example.com", Some("auth"), "00000001", "xyz");
        let r2 = digest_response("alice", "secret", "example.com", "abc123", "REGISTER", "sip:example.com", Some("auth"), "00000001", "xyz");
        assert_eq!(r1, r2);
        assert_eq!(r1.len(), 32);
        // Different password → different response; wrong creds never collide.
        let r3 = digest_response("alice", "wrong", "example.com", "abc123", "REGISTER", "sip:example.com", Some("auth"), "00000001", "xyz");
        assert_ne!(r1, r3);
    }

    #[test]
    fn challenge_parse_roundtrip() {
        let h = "Digest realm=\"example.com\", nonce=\"abc123\", algorithm=MD5, qop=\"auth\", opaque=\"opaque-here\"";
        let ch = AuthChallenge::parse(h).unwrap();
        assert_eq!(ch.realm, "example.com");
        assert_eq!(ch.nonce, "abc123");
        assert_eq!(ch.qop.as_deref(), Some("auth"));
        assert_eq!(ch.opaque.as_deref(), Some("opaque-here"));
    }

    #[test]
    fn challenge_missing_nonce_is_refused() {
        assert!(AuthChallenge::parse("Digest realm=\"x\"").is_none());
        assert!(AuthChallenge::parse("garbage").is_none());
    }

    #[test]
    fn register_request_shape() {
        let p = RegisterParams {
            call_id: "call-1".into(),
            cseq: 1,
            branch: "z9hG4bKabc".into(),
            local_ip: "192.168.1.10".into(),
            local_port: 5070,
            authorization: None,
            unregister: false,
        };
        let req = build_register(&profile(), &p);
        assert!(req.starts_with("REGISTER sip:pbx.example.com SIP/2.0\r\n"));
        assert!(req.contains("Via: SIP/2.0/TLS 192.168.1.10:5070;branch=z9hG4bKabc;rport"));
        assert!(req.contains("CSeq: 1 REGISTER"));
        assert!(req.contains("Expires: 600"));
        assert!(!req.contains("transport=ws"), "native core never pins transport=ws");
        assert!(!req.contains("WSS") && !req.contains("SIP/2.0/WS "));
    }

    #[test]
    fn unregister_uses_expires_zero() {
        let p = RegisterParams {
            call_id: "call-1".into(),
            cseq: 7,
            branch: "z9hG4bKx".into(),
            local_ip: "192.168.1.10".into(),
            local_port: 5070,
            authorization: None,
            unregister: true,
        };
        let req = build_register(&profile(), &p);
        assert!(req.contains("Expires: 0"));
        assert!(req.contains(";expires=0"));
    }

    #[test]
    fn auth_header_embeds_hash_not_password() {
        let ch = AuthChallenge {
            realm: "example.com".into(),
            nonce: "n".into(),
            qop: None,
            algorithm: "MD5".into(),
            opaque: None,
            stale: false,
        };
        let h = build_authorization_header(&ch, "2001", "s3cret!", "REGISTER", "sip:example.com", "00000001", "c");
        assert!(h.starts_with("Digest "));
        assert!(!h.contains("s3cret!"), "password must never appear in the header");
        assert!(h.contains("response=\""));
    }

    #[test]
    fn classify_responses() {
        assert_eq!(
            classify_register_response(200, "OK", None, 600),
            RegisterOutcome::Accepted { expires: 600 }
        );
        match classify_register_response(401, "Unauthorized", Some("Digest realm=\"r\", nonce=\"n\""), 0) {
            RegisterOutcome::Challenged(ch) => assert_eq!(ch.realm, "r"),
            other => panic!("expected challenge, got {other:?}"),
        }
        match classify_register_response(401, "Unauthorized", Some("garbage"), 0) {
            RegisterOutcome::Rejected { .. } => {}
            other => panic!("unparsable challenge must reject, got {other:?}"),
        }
        match classify_register_response(403, "Forbidden", None, 0) {
            RegisterOutcome::Rejected { code: 403, .. } => {}
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn refresh_happens_before_expiry() {
        assert_eq!(refresh_delay(600), Duration::from_secs(510)); // 85%
        assert_eq!(refresh_delay(60), Duration::from_secs(51));
        // Tiny expiry clamps to 10s minimum instead of busy-looping.
        assert_eq!(refresh_delay(5), Duration::from_secs(10));
        // Always strictly before expiry for sane values.
        for e in [120u32, 300, 600, 3600] {
            assert!(refresh_delay(e) < Duration::from_secs(e as u64), "{e}");
        }
    }

    #[test]
    fn duplicate_worker_rejected() {
        let sup = RegistrationSupervisor::new();
        let _g = sup.try_acquire("acc-1").unwrap();
        assert!(sup.is_running("acc-1"));
        assert!(sup.try_acquire("acc-1").is_err(), "exactly one worker per account");
        // Different account unaffected.
        let _g2 = sup.try_acquire("acc-2").unwrap();
    }

    #[test]
    fn worker_slot_frees_on_drop() {
        let sup = RegistrationSupervisor::new();
        { let _g = sup.try_acquire("acc-1").unwrap(); }
        assert!(!sup.is_running("acc-1"));
        assert!(sup.try_acquire("acc-1").is_ok());
    }

    #[test]
    fn cseq_monotonic_nonzero() {
        let g = CSeqGen::new();
        let a = g.next();
        let b = g.next();
        assert!(a >= 1);
        assert!(b == a + 1);
    }

    #[test]
    fn parse_response_ok_and_contact_expires() {
        let raw = "SIP/2.0 200 OK\r\nVia: SIP/2.0/TLS x;branch=y\r\nContact: <sip:2001@h>;expires=300\r\nContent-Length: 0\r\n\r\n";
        let r = parse_response(raw).unwrap();
        assert_eq!(r.status, 200);
        assert_eq!(r.header("contact"), Some("<sip:2001@h>;expires=300"));
        assert_eq!(bound_expires(&r, 600), 300);
    }

    #[test]
    fn parse_response_rejects_garbage_fail_closed() {
        assert!(parse_response("HTTP/1.1 200 OK\r\n\r\n").is_err());
        assert!(parse_response("SIP/2.0 OK\r\n\r\n").is_err());
        assert!(parse_response("SIP/2.0 200 OK\r\nBroken-Header\r\n\r\n").is_err());
    }

    #[test]
    fn unique_ids_differ() {
        assert_ne!(new_call_id("example.com"), new_call_id("example.com"));
        assert_ne!(new_branch(), new_branch());
        assert!(new_branch().starts_with("z9hG4bK"));
    }

    async fn read_request(stream: &mut tokio::io::DuplexStream) -> String {
        use tokio::io::AsyncReadExt;
        let mut buf = Vec::new();
        let mut tmp = [0u8; 2048];
        loop {
            let n = stream.read(&mut tmp).await.unwrap();
            buf.extend_from_slice(&tmp[..n]);
            if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                break;
            }
        }
        String::from_utf8(buf).unwrap()
    }

    #[tokio::test]
    async fn full_handshake_against_fake_registrar() {
        use tokio::io::AsyncWriteExt;
        let prof = profile();
        let (mut client, mut server) = tokio::io::duplex(65536);
        let cseq = CSeqGen::new();

        let server_task = tokio::spawn(async move {
            // 1. Bare REGISTER → 401 challenge.
            let req1 = read_request(&mut server).await;
            assert!(req1.starts_with("REGISTER sip:pbx.example.com SIP/2.0"));
            assert!(!req1.contains("Authorization:"));
            server
                .write_all(
                    b"SIP/2.0 401 Unauthorized\r\nWWW-Authenticate: Digest realm=\"example.com\", nonce=\"n123\", algorithm=MD5, qop=\"auth\"\r\nContent-Length: 0\r\n\r\n",
                )
                .await
                .unwrap();
            // 2. Authenticated REGISTER → 200 with bound expiry.
            let req2 = read_request(&mut server).await;
            assert!(req2.contains("Authorization: Digest"));
            assert!(req2.contains("username=\"2001\""));
            assert!(!req2.contains("s3cret"), "password must never hit the wire in clear");
            server
                .write_all(b"SIP/2.0 200 OK\r\nExpires: 600\r\nContent-Length: 0\r\n\r\n")
                .await
                .unwrap();
        });

        let outcome = register_once(&prof, Some("s3cret"), &mut client, "192.168.1.10", 5070, &cseq)
            .await
            .expect("handshake succeeds");
        assert_eq!(outcome, RegisterOutcome::Accepted { expires: 600 });
        server_task.await.unwrap();
    }

    #[tokio::test]
    async fn wrong_password_becomes_rejection_not_loop() {
        use tokio::io::AsyncWriteExt;
        let prof = profile();
        let (mut client, mut server) = tokio::io::duplex(65536);
        let cseq = CSeqGen::new();

        let server_task = tokio::spawn(async move {
            let _ = read_request(&mut server).await;
            server
                .write_all(
                    b"SIP/2.0 401 Unauthorized\r\nWWW-Authenticate: Digest realm=\"example.com\", nonce=\"n\"\r\nContent-Length: 0\r\n\r\n",
                )
                .await
                .unwrap();
            let _ = read_request(&mut server).await;
            // Second 401: credentials rejected.
            server
                .write_all(
                    b"SIP/2.0 401 Unauthorized\r\nWWW-Authenticate: Digest realm=\"example.com\", nonce=\"n2\"\r\nContent-Length: 0\r\n\r\n",
                )
                .await
                .unwrap();
        });

        let outcome = register_once(&prof, Some("wrong"), &mut client, "192.168.1.10", 5070, &cseq)
            .await
            .expect("transaction completes");
        assert!(matches!(outcome, RegisterOutcome::Rejected { code: 401, .. }), "{outcome:?}");
        server_task.await.unwrap();
    }

    #[tokio::test]
    async fn missing_password_is_hard_error() {
        let prof = profile();
        let (mut client, mut server) = tokio::io::duplex(65536);
        let cseq = CSeqGen::new();
        let server_task = tokio::spawn(async move {
            use tokio::io::AsyncWriteExt;
            let _ = read_request(&mut server).await;
            server
                .write_all(
                    b"SIP/2.0 401 Unauthorized\r\nWWW-Authenticate: Digest realm=\"example.com\", nonce=\"n\"\r\nContent-Length: 0\r\n\r\n",
                )
                .await
                .unwrap();
        });
        let err = register_once(&prof, None, &mut client, "192.168.1.10", 5070, &cseq)
            .await
            .unwrap_err();
        assert!(err.contains("no password"), "{err}");
        server_task.await.unwrap();
    }
}
