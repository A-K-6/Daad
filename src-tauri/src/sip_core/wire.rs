//! Wire transport binding for call signalling (Phase-1 TLS/TCP streams).
//!
//! The dialog/call managers in [`super::dialog`] / [`super::call`] are
//! sans-io: they decide state + response text but never touch a socket.
//! This module binds them to a real signalling stream (`AsyncRead+Write`,
//! in production the verified TLS connection from [`super::transport`]):
//!
//! - [`read_sip_message`] / [`write_sip_message`]: Content-Length framing.
//! - Header parsers (`status_code`, `request_method`, `cseq_parts`, …).
//! - [`dispatch_request`]: route one inbound request (INVITE/CANCEL/BYE/ACK)
//!   through the [`CallManager`](super::call::CallManager), returning the
//!   response text to send (or `None` for ACK/absorb).
//! - [`run_outbound_invite`]: drive one outgoing INVITE transaction
//!   (100/180/183 → 200+SDP → ACK, failures → teardown) over a stream.
//!
//! Invariants:
//! - Mandatory SDES-SRTP is enforced by the call manager, never downgraded
//!   here: plain-RTP answers/INVITEs surface as 488 paths, not silent RTP.
//! - Malformed input fails closed (transaction aborted, never assumed).
//! - No secrets are logged: bodies (SDP/crypto) never appear in errors.

use crate::sip_core::call::CallManager;

/// One framed SIP message: header block + optional body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SipMessage {
    /// Header block including the start line (no trailing blank line).
    pub head: String,
    /// Body bytes decoded as lossy UTF-8 (SDP text in practice).
    pub body: String,
    /// `true` for `SIP/2.0 ...` responses, `false` for requests.
    pub is_response: bool,
}

/// Per-read I/O budget for the call-signalling path.
pub const CALL_IO_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// Per-stream reassembly buffer. SIP over TCP/TLS coalesces: one read can
/// carry several pipelined messages, so leftovers must survive across
/// [`read_framed`] calls instead of being dropped with a temporary buffer.
#[derive(Debug, Default)]
pub struct SipFramer {
    buf: Vec<u8>,
}

impl SipFramer {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Read one SIP message: headers until `\r\n\r\n`, then exactly
/// `Content-Length` body bytes. Pipelined bytes after the message stay in
/// the framer for the next call. Fails closed on oversize/garbage.
pub async fn read_framed<S>(framer: &mut SipFramer, stream: &mut S) -> Result<SipMessage, String>
where
    S: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::AsyncReadExt;
    let mut tmp = [0u8; 2048];
    loop {
        if let Some(end) = find_headers_end(&framer.buf) {
            let head = String::from_utf8_lossy(&framer.buf[..end]).to_string();
            let content_len = content_length(&head);
            let total = end + content_len;
            while framer.buf.len() < total {
                let n = tokio::time::timeout(CALL_IO_TIMEOUT, stream.read(&mut tmp))
                    .await
                    .map_err(|_| "call signalling body read timed out".to_string())?
                    .map_err(|e| format!("call signalling body read failed: {e}"))?;
                if n == 0 {
                    break;
                }
                framer.buf.extend_from_slice(&tmp[..n]);
            }
            if framer.buf.len() < total {
                return Err("call signalling stream closed mid-body".into());
            }
            let body = String::from_utf8_lossy(framer.buf.get(end..total).unwrap_or(b""))
                .to_string();
            framer.buf.drain(..total);
            let is_response = head.starts_with("SIP/2.0");
            return Ok(SipMessage { head, body, is_response });
        }
        if framer.buf.len() > 65536 {
            return Err("SIP message too large".into());
        }
        let n = tokio::time::timeout(CALL_IO_TIMEOUT, stream.read(&mut tmp))
            .await
            .map_err(|_| "call signalling read timed out".to_string())?
            .map_err(|e| format!("call signalling read failed: {e}"))?;
        if n == 0 {
            return Err("call signalling stream closed".into());
        }
        framer.buf.extend_from_slice(&tmp[..n]);
    }
}

/// Read one SIP message with a fresh buffer (no pipelining retained).
/// Prefer [`read_framed`] on live streams where responses can coalesce.
pub async fn read_sip_message<S>(stream: &mut S) -> Result<SipMessage, String>
where
    S: tokio::io::AsyncRead + Unpin,
{
    read_framed(&mut SipFramer::new(), stream).await
}

/// Write one SIP request/response text to the stream.
pub async fn write_sip_message<S>(stream: &mut S, text: &str) -> Result<(), String>
where
    S: tokio::io::AsyncWrite + Unpin,
{
    use tokio::io::AsyncWriteExt;
    tokio::time::timeout(CALL_IO_TIMEOUT, async {
        stream.write_all(text.as_bytes()).await?;
        stream.flush().await?;
        Ok::<(), std::io::Error>(())
    })
    .await
    .map_err(|_| "call signalling write timed out".to_string())?
    .map_err(|e| format!("call signalling write failed: {e}"))?;
    Ok(())
}

fn find_headers_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|i| i + 4)
}

fn content_length(head: &str) -> usize {
    header_value(head, "content-length")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0)
}

/// First header value matching `name` (case-insensitive), trimmed.
pub fn header_value(head: &str, name: &str) -> Option<String> {
    for line in head.split("\r\n").skip(1) {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case(name) {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

/// `(status code, reason)` for `SIP/2.0` responses; `None` otherwise.
pub fn status_code(head: &str) -> Option<(u16, String)> {
    let line = head.split("\r\n").next().unwrap_or("");
    let mut parts = line.splitn(3, ' ');
    if !parts.next().unwrap_or("").eq_ignore_ascii_case("SIP/2.0") {
        return None;
    }
    let code: u16 = parts.next().unwrap_or("").parse().ok()?;
    Some((code, parts.next().unwrap_or("").to_string()))
}

/// Request method (`INVITE`, `CANCEL`, `BYE`, `ACK`, …); `None` for responses.
pub fn request_method(head: &str) -> Option<String> {
    let line = head.split("\r\n").next().unwrap_or("");
    if line.starts_with("SIP/2.0") {
        return None;
    }
    line.split_whitespace().next().map(str::to_string)
}

/// `(CSeq number, method)` from the `CSeq` header.
pub fn cseq_parts(head: &str) -> Option<(u32, String)> {
    let v = header_value(head, "cseq")?;
    let mut it = v.split_whitespace();
    let n: u32 = it.next()?.parse().ok()?;
    Some((n, it.next().unwrap_or("").to_string()))
}

/// `Call-ID` header value.
pub fn call_id(head: &str) -> Option<String> {
    header_value(head, "call-id")
}

/// Branch parameter of the top `Via` header (empty when absent).
pub fn via_branch(head: &str) -> String {
    for line in head.split("\r\n").skip(1) {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("via") {
                for param in v.split(';').skip(1) {
                    let p = param.trim();
                    if let Some(b) = p
                        .strip_prefix("branch=")
                        .or_else(|| p.strip_prefix("BRANCH="))
                    {
                        return b.trim().trim_matches('"').to_string();
                    }
                }
                return String::new();
            }
        }
    }
    String::new()
}

/// User part of the `From` header URI (`<sip:user@host>`); `None` when absent.
pub fn from_user(head: &str) -> Option<String> {
    let from = header_value(head, "from")?;
    let uri = from.split('<').nth(1)?.split('>').next()?;
    let no_scheme = uri
        .strip_prefix("sip:")
        .or_else(|| uri.strip_prefix("SIP:"))?;
    Some(no_scheme.split('@').next().unwrap_or(no_scheme).trim().to_string())
}

/// Minimal stateless response echoing Via/From/To/Call-ID/CSeq when present.
/// Used for CANCEL/BYE/OPTIONS handling (INVITE answers carry SDP and come
/// from the call manager instead).
pub fn minimal_response(code: u16, reason: &str, head: &str) -> String {
    let mut res = format!("SIP/2.0 {code} {reason}\r\n");
    for name in ["via", "from", "to", "call-id", "cseq"] {
        // Echo the first occurrence of each routing header verbatim.
        for line in head.split("\r\n").skip(1) {
            if let Some((k, v)) = line.split_once(':') {
                if k.trim().eq_ignore_ascii_case(name) {
                    res.push_str(&format!("{}: {}\r\n", k.trim(), v.trim()));
                    break;
                }
            }
        }
    }
    res.push_str("Content-Length: 0\r\n\r\n");
    res
}

/// Route one inbound request through the call manager.
///
/// Returns the response text to send (`None` for ACK, which is absorbed).
/// Unknown methods yield `None` except OPTIONS (stateless 200).
pub fn dispatch_request(
    mgr: &mut CallManager,
    head: &str,
    body: &str,
) -> Option<String> {
    match request_method(head).as_deref() {
        Some("INVITE") => {
            let cid = match call_id(head) {
                Some(c) if !c.is_empty() => c,
                _ => return Some(minimal_response(400, "Bad Request", head)),
            };
            let (cseq, _) = cseq_parts(head).unwrap_or((1, "INVITE".into()));
            let branch = via_branch(head);
            let from = from_user(head).unwrap_or_else(|| "unknown".into());
            Some(mgr.on_invite_received(&cid, cseq, &branch, &from, body))
        }
        Some("CANCEL") => match mgr.on_cancel() {
            Ok(()) => Some(minimal_response(200, "OK", head)),
            Err(_) => Some(minimal_response(481, "Call/Transaction Does Not Exist", head)),
        },
        Some("BYE") => match mgr.on_bye() {
            Ok(()) => Some(minimal_response(200, "OK", head)),
            Err(_) => Some(minimal_response(481, "Call/Transaction Does Not Exist", head)),
        },
        Some("ACK") => None,
        Some("OPTIONS") => Some(minimal_response(200, "OK", head)),
        _ => None,
    }
}

/// Outcome of [`run_outbound_invite`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutboundOutcome {
    /// `200 OK` answered with SDP, ACK sent, media up.
    Answered,
    /// Definite failure (`on_failure` already applied to the manager).
    Failed { code: u16 },
}

/// Drive one outgoing INVITE transaction over an open stream.
///
/// `invite_req` is the request text from
/// [`CallManager::invite`](super::call::CallManager::invite) (already applied
/// to local state). Sends it, folds 100/180/183 into the manager, answers a
/// `200 OK` (SDP body → SRTP negotiation → media start) with ACK, and maps
/// `3xx–6xx` (including 401/407: INVITE Digest is a Phase-2 item, surfaced as
/// failure rather than retried blind) into `on_failure`. Inbound CANCEL/BYE
/// interleaved mid-transaction are dispatched; a terminal manager state ends
/// the drive so a concurrent local hangup (CANCEL) wins without deadlock.
pub async fn run_outbound_invite<S>(
    mgr: &mut CallManager,
    stream: &mut S,
    invite_req: &str,
) -> Result<OutboundOutcome, String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    write_sip_message(stream, invite_req).await?;
    // A persistent framer: the UAS may pipeline 100/180/200 in one segment.
    let mut framer = SipFramer::new();
    loop {
        // A concurrent hangup ends local state first: the CANCEL/BYE text it
        // built travels via the command layer, so stop driving here.
        if mgr.state() != crate::sip_core::call::CallStateNative::OutgoingRinging {
            return Ok(OutboundOutcome::Failed { code: 487 });
        }
        let msg = read_framed(&mut framer, stream).await?;
        if msg.is_response {
            let (code, _) = status_code(&msg.head)
                .ok_or_else(|| "outbound: malformed SIP status line (fail-closed)".to_string())?;
            if (100..200).contains(&code) {
                // Best-effort: out-of-order provisionals must not kill the leg.
                let _ = mgr.on_provisional(code);
            } else if (200..300).contains(&code) {
                match mgr.on_answer(&msg.body) {
                    Ok(ack) => {
                        write_sip_message(stream, &ack).await?;
                        return Ok(OutboundOutcome::Answered);
                    }
                    Err(e) => {
                        // Answer unusable (plain RTP / bad SDP): never
                        // downgrade — end the leg as incompatible.
                        let _ = mgr.on_failure(488);
                        return Err(format!(
                            "outbound: unusable 200 OK SDP (fail-closed 488): {}",
                            crate::sip_core::diagnostics::sanitize_log(&e.to_string())
                        ));
                    }
                }
            } else {
                let _ = mgr.on_failure(code);
                return Ok(OutboundOutcome::Failed { code });
            }
        } else if let Some(resp) = dispatch_request(mgr, &msg.head, &msg.body) {
            write_sip_message(stream, &resp).await?;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sip_core::call::CallManager;

    const SECURE_SDP: &str = "v=0\r\n\
        o=asterisk 1 1 IN IP4 10.0.0.1\r\n\
        s=A\r\n\
        c=IN IP4 10.0.0.1\r\n\
        t=0 0\r\n\
        m=audio 11700 RTP/SAVP 0 8\r\n\
        a=rtpmap:0 PCMU/8000\r\n\
        a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:QUJDMTIzNDU2Nzg5MEFCQ0RFRjEyMzQ=\r\n\
        a=ptime:20\r\n\
        a=sendrecv\r\n";

    const PLAIN_SDP: &str = "v=0\r\n\
        o=asterisk 1 1 IN IP4 10.0.0.1\r\n\
        s=A\r\n\
        c=IN IP4 10.0.0.1\r\n\
        t=0 0\r\n\
        m=audio 11700 RTP/AVP 0 8\r\n\
        a=rtpmap:0 PCMU/8000\r\n\
        a=ptime:20\r\n\
        a=sendrecv\r\n";

    fn invite_head(call_id: &str, cseq: u32, branch: &str, from: &str) -> String {
        format!(
            "INVITE sip:2001@pbx SIP/2.0\r\n\
             Via: SIP/2.0/TLS pbx;branch={branch}\r\n\
             From: <sip:{from}@pbx>;tag=aaa\r\n\
             To: <sip:2001@pbx>\r\n\
             Call-ID: {call_id}\r\n\
             CSeq: {cseq} INVITE\r\n\
             Contact: <sip:{from}@pbx>\r\n\
             Content-Type: application/sdp\r\n\
             Content-Length: {len}\r\n\
             \r\n",
            len = SECURE_SDP.len()
        )
    }

    #[tokio::test]
    async fn outbound_invite_100_180_200_ack_then_bye() {
        use tokio::io::AsyncWriteExt;
        let (mut client, mut server) = tokio::io::duplex(65536);
        let mut mgr = CallManager::with_audio(true);
        let mut framer = SipFramer::new();
        let req = mgr.invite("2001").unwrap();

        let server_task = tokio::spawn(async move {
            // Framed reads: the INVITE carries an SDP body that must be
            // consumed, otherwise it contaminates subsequent reads.
            let mut server_framer = SipFramer::new();
            let inv = read_framed(&mut server_framer, &mut server).await.unwrap();
            assert!(inv.head.starts_with("INVITE sip:2001"));
            for code in ["100 Trying", "180 Ringing"] {
                server
                    .write_all(format!("SIP/2.0 {code}\r\nContent-Length: 0\r\n\r\n").as_bytes())
                    .await
                    .unwrap();
            }
            let body = SECURE_SDP;
            server
                .write_all(
                    format!(
                        "SIP/2.0 200 OK\r\nContent-Type: application/sdp\r\nContent-Length: {}\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            let ack = read_framed(&mut server_framer, &mut server).await.unwrap();
            assert!(ack.head.starts_with("ACK"));
            // Caller hangs up: BYE → 200.
            let bye = read_framed(&mut server_framer, &mut server).await.unwrap();
            assert!(bye.head.starts_with("BYE"));
            server
                .write_all(b"SIP/2.0 200 OK\r\nContent-Length: 0\r\n\r\n")
                .await
                .unwrap();
        });

        let outcome = run_outbound_invite(&mut mgr, &mut client, &req).await.unwrap();
        assert_eq!(outcome, OutboundOutcome::Answered);
        assert_eq!(mgr.state(), crate::sip_core::call::CallStateNative::Active);
        let bye = mgr.hangup().unwrap().expect("BYE text");
        write_sip_message(&mut client, &bye).await.unwrap();
        let resp = read_framed(&mut framer, &mut client).await.unwrap();
        assert_eq!(status_code(&resp.head).map(|(c, _)| c), Some(200));
        server_task.await.unwrap();
    }

    #[tokio::test]
    async fn invite_challenge_is_failure_not_loop() {
        let (mut client, mut server) = tokio::io::duplex(65536);
        let mut mgr = CallManager::with_audio(true);
        let req = mgr.invite("2002").unwrap();
        let server_task = tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut buf = vec![0u8; 4096];
            let _ = server.read(&mut buf).await.unwrap();
            // INVITE Digest auth is Phase-2: the stack surfaces 407 as a
            // definite failure instead of retrying blind.
            server
                .write_all(b"SIP/2.0 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n")
                .await
                .unwrap();
        });
        let outcome = run_outbound_invite(&mut mgr, &mut client, &req).await.unwrap();
        assert_eq!(outcome, OutboundOutcome::Failed { code: 407 });
        server_task.await.unwrap();
    }

    #[tokio::test]
    async fn inbound_invite_180_200_ack_over_wire() {
        let (mut client, mut server) = tokio::io::duplex(65536);
        let mut mgr = CallManager::with_audio(true);
        let mut server_framer = SipFramer::new();
        // Fake caller sends INVITE with SDES-SRTP offer.
        let head = invite_head("wire-in-1", 1, "z9hG4bKaa01", "1000");
        write_sip_message(&mut server, &format!("{head}{SECURE_SDP}")).await.unwrap();

        let msg = read_sip_message(&mut client).await.unwrap();
        assert!(!msg.is_response);
        let resp = dispatch_request(&mut mgr, &msg.head, &msg.body).expect("180");
        assert!(resp.contains("180"));
        write_sip_message(&mut client, &resp).await.unwrap();
        assert_eq!(mgr.state(), crate::sip_core::call::CallStateNative::IncomingRinging);

        // Callee answers: 200 OK with SDP goes back on the same stream.
        let ok200 = mgr.answer().unwrap();
        assert!(ok200.contains("200 OK"));
        write_sip_message(&mut client, &ok200).await.unwrap();
        assert_eq!(mgr.state(), crate::sip_core::call::CallStateNative::Active);

        // Caller ACKs; absorbed without a response.
        write_sip_message(&mut server, "ACK sip:x SIP/2.0\r\nContent-Length: 0\r\n\r\n")
            .await
            .unwrap();
        let ack = read_sip_message(&mut client).await.unwrap();
        assert!(dispatch_request(&mut mgr, &ack.head, &ack.body).is_none());
        assert_eq!(mgr.state(), crate::sip_core::call::CallStateNative::Active);
        // Server drains the two responses the client sent (180 + 200 OK).
        // A persistent framer: the responses may arrive coalesced.
        for expect in ["180", "200"] {
            let msg = read_framed(&mut server_framer, &mut server).await.unwrap();
            assert!(msg.head.contains(expect), "{}", msg.head);
        }
    }

    #[tokio::test]
    async fn cancel_before_answer_is_missed_late_bye_is_481() {
        let mut mgr = CallManager::with_audio(true);
        let head = invite_head("wire-missed-1", 1, "z9hG4bKmm01", "1000");
        let r = dispatch_request(&mut mgr, &head, SECURE_SDP).unwrap();
        assert!(r.contains("180"));
        let cancel = "CANCEL sip:2001@pbx SIP/2.0\r\nCall-ID: wire-missed-1\r\nCSeq: 1 CANCEL\r\nContent-Length: 0\r\n\r\n";
        let r = dispatch_request(&mut mgr, cancel, "").unwrap();
        assert!(r.contains("200"));
        assert!(mgr.media_released());
        // Late BYE after CANCEL-termination: no dialog → 481, never resurrected.
        let bye = "BYE sip:2001@pbx SIP/2.0\r\nCall-ID: wire-missed-1\r\nCSeq: 2 BYE\r\nContent-Length: 0\r\n\r\n";
        let r = dispatch_request(&mut mgr, bye, "").unwrap();
        assert!(r.contains("481"));
        let evs = mgr.take_events();
        assert!(evs.iter().any(|e| matches!(
            e,
            crate::sip_core::call::CallEvent::Ended { reason, .. } if reason == "missed"
        )));
    }

    #[tokio::test]
    async fn bye_after_active_ends_second_bye_is_481() {
        let mut mgr = CallManager::with_audio(true);
        let head = invite_head("wire-bye-1", 1, "z9hG4bKbb01", "1000");
        dispatch_request(&mut mgr, &head, SECURE_SDP);
        mgr.answer().unwrap();
        let bye = "BYE sip:x SIP/2.0\r\nCall-ID: wire-bye-1\r\nCSeq: 2 BYE\r\nContent-Length: 0\r\n\r\n";
        let r = dispatch_request(&mut mgr, bye, "").unwrap();
        assert!(r.contains("200"));
        assert!(mgr.media_released());
        let r2 = dispatch_request(&mut mgr, bye, "").unwrap();
        assert!(r2.contains("481"), "second BYE must not resurrect the dialog");
    }

    #[tokio::test]
    async fn plain_rtp_invite_rejected_with_488_never_downgraded() {
        let mut mgr = CallManager::with_audio(true);
        let mut head = invite_head("wire-plain-1", 1, "z9hG4bKpp01", "1000");
        head = head.replace(&format!("Content-Length: {}", SECURE_SDP.len()), &format!("Content-Length: {}", PLAIN_SDP.len()));
        let r = dispatch_request(&mut mgr, &head, PLAIN_SDP).unwrap();
        assert!(r.contains("488"));
        assert_eq!(mgr.state(), crate::sip_core::call::CallStateNative::Idle);
    }

    #[tokio::test]
    async fn retransmitted_invite_replays_without_new_dialog() {
        let mut mgr = CallManager::with_audio(true);
        let head = invite_head("wire-dup-1", 1, "z9hG4bKdd01", "1000");
        let r1 = dispatch_request(&mut mgr, &head, SECURE_SDP).unwrap();
        let r2 = dispatch_request(&mut mgr, &head, SECURE_SDP).unwrap();
        assert!(r1.contains("180") && r2.contains("180"));
        assert_eq!(mgr.state(), crate::sip_core::call::CallStateNative::IncomingRinging);
    }

    #[test]
    fn header_parsers() {
        let head = "INVITE sip:2001@pbx SIP/2.0\r\nVia: SIP/2.0/TLS h;branch=z9hG4bK12\r\nFrom: <sip:1000@pbx>;tag=a\r\nTo: <sip:2001@pbx>\r\nCall-ID: cid-9\r\nCSeq: 7 INVITE\r\nContent-Length: 0";
        assert_eq!(request_method(head).as_deref(), Some("INVITE"));
        assert_eq!(cseq_parts(head), Some((7, "INVITE".into())));
        assert_eq!(call_id(head).as_deref(), Some("cid-9"));
        assert_eq!(via_branch(head), "z9hG4bK12");
        assert_eq!(from_user(head).as_deref(), Some("1000"));
        assert!(status_code(head).is_none());
        let resp = "SIP/2.0 180 Ringing\r\nContent-Length: 0";
        assert_eq!(status_code(resp).map(|(c, _)| c), Some(180));
        assert!(request_method(resp).is_none());
    }

    #[test]
    fn malformed_status_fails_closed() {
        assert!(status_code("GARBAGE NOT SIP\r\n\r\n").is_none());
        assert!(request_method("SIP/2.0 200 OK\r\n\r\n").is_none());
        // INVITE without Call-ID → 400, never a phantom dialog.
        let mut mgr = CallManager::with_audio(true);
        let bad = "INVITE sip:2001@pbx SIP/2.0\r\nCSeq: 1 INVITE\r\nContent-Length: 0\r\n\r\n";
        let r = dispatch_request(&mut mgr, bad, SECURE_SDP).unwrap();
        assert!(r.contains("400"));
        assert_eq!(mgr.state(), crate::sip_core::call::CallStateNative::Idle);
    }

    #[tokio::test]
    async fn pipelined_responses_survive_one_segment() {
        // The UAS may coalesce 100+180+200 in a single TCP segment: the
        // framer must return all three, in order, without losing bytes.
        let (mut client, mut server) = tokio::io::duplex(65536);
        let body = SECURE_SDP;
        let blob = format!(
            "SIP/2.0 100 Trying\r\nContent-Length: 0\r\n\r\n\
             SIP/2.0 180 Ringing\r\nContent-Length: 0\r\n\r\n\
             SIP/2.0 200 OK\r\nContent-Type: application/sdp\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        {
            use tokio::io::AsyncWriteExt;
            server.write_all(blob.as_bytes()).await.unwrap();
        }
        let mut framer = SipFramer::new();
        let m1 = read_framed(&mut framer, &mut client).await.unwrap();
        let m2 = read_framed(&mut framer, &mut client).await.unwrap();
        let m3 = read_framed(&mut framer, &mut client).await.unwrap();
        assert_eq!(status_code(&m1.head).map(|(c, _)| c), Some(100));
        assert_eq!(status_code(&m2.head).map(|(c, _)| c), Some(180));
        assert_eq!(status_code(&m3.head).map(|(c, _)| c), Some(200));
        assert_eq!(m3.body, SECURE_SDP);
    }

    #[tokio::test]
    async fn framing_survives_split_writes_and_carries_bodies() {
        let (mut a, mut b) = tokio::io::duplex(65536);
        let full = format!("{head}{SECURE_SDP}", head = invite_head("wire-split-1", 3, "z9hG4bKss01", "1000"));
        let (first, second) = full.split_at(full.len() / 2);
        {
            use tokio::io::AsyncWriteExt;
            b.write_all(first.as_bytes()).await.unwrap();
            b.write_all(second.as_bytes()).await.unwrap();
        }
        let msg = read_sip_message(&mut a).await.unwrap();
        assert!(!msg.is_response);
        assert_eq!(msg.body, SECURE_SDP);
        assert_eq!(call_id(&msg.head).as_deref(), Some("wire-split-1"));
    }
}
