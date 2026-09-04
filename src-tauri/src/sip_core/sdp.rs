//! SDP offer/answer for G.711 with mandatory SDES-SRTP (JBM profile),
//! plus Opus as an interop-profile codec (offered only after PCMU/PCMA,
//! never for JBM profiles).
//!
//! Only PCMU (payload 0) and PCMA (payload 8) are offered/accepted under the
//! JBM profile. A peer offer without `a=crypto` SDES lines or without
//! `RTP/SAVP` is rejected with [`SdpError::SrtpRequired`] (the caller maps
//! this to SIP 488). Plain RTP is never negotiated silently.
//!
//! Opus (dynamic payload, `opus/48000/2`, RFC 7587) is parsed and generated
//! only through the `*_interop` constructors / answer paths. The JBM
//! [`SdpOffer::offer`] / [`SdpOffer::answer_for`] pair never emits or accepts
//! Opus: an Opus-only offer answers [`SdpError::IncompatibleCodecs`] there.

use std::fmt::Write as _;

/// Dynamic payload type used when offering Opus (RFC 7587 §7; 96–127 free).
pub const OPUS_DYNAMIC_PT: u8 = 111;
/// Opus clock rate (Hz) and channel count on the wire.
pub const OPUS_CLOCK: u32 = 48_000;
pub const OPUS_CHANNELS: u8 = 2;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SdpError {
    #[error("SDES-SRTP required by JBM profile: peer offered plain RTP (respond 488)")]
    SrtpRequired,
    #[error("no compatible codec: only PCMU/PCMA are supported (respond 488)")]
    IncompatibleCodecs,
    #[error("malformed SDP: {0}")]
    Malformed(&'static str),
}

/// G.711 codecs (JBM) plus Opus (interop profiles only).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RtpCodec {
    Pcmu,
    Pcma,
    /// Opus, `opus/48000/2`, dynamic payload (default [`OPUS_DYNAMIC_PT`]).
    /// Never offered or accepted on the JBM profile — see [`SdpOffer::offer`]
    /// and [`SdpOffer::answer_for`].
    Opus(u8),
}

impl RtpCodec {
    pub fn payload_type(self) -> u8 {
        match self {
            RtpCodec::Pcmu => 0,
            RtpCodec::Pcma => 8,
            RtpCodec::Opus(pt) => pt,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            RtpCodec::Pcmu => "PCMU",
            RtpCodec::Pcma => "PCMA",
            RtpCodec::Opus(_) => "opus",
        }
    }

    /// Clock rate for the `a=rtpmap` line.
    pub fn clock(self) -> u32 {
        match self {
            RtpCodec::Opus(_) => OPUS_CLOCK,
            _ => 8000,
        }
    }

    /// Full `a=rtpmap` value (`PCMU/8000`, `opus/48000/2`).
    pub fn rtpmap(self) -> String {
        match self {
            RtpCodec::Opus(pt) => format!("{pt} opus/{OPUS_CLOCK}/{OPUS_CHANNELS}"),
            _ => format!("{} {}/8000", self.payload_type(), self.name()),
        }
    }

    pub fn from_pt(pt: u8) -> Option<Self> {
        match pt {
            0 => Some(RtpCodec::Pcmu),
            8 => Some(RtpCodec::Pcma),
            _ => None,
        }
    }

    /// Like [`from_pt`](Self::from_pt) but honours a negotiated dynamic Opus
    /// payload (interop profiles only).
    pub fn from_pt_with_opus(pt: u8, opus_pt: Option<u8>) -> Option<Self> {
        if Some(pt) == opus_pt {
            return Some(RtpCodec::Opus(pt));
        }
        Self::from_pt(pt)
    }

    /// `true` for the JBM codec set (PCMU/PCMA only).
    pub fn is_jbm(self) -> bool {
        !matches!(self, RtpCodec::Opus(_))
    }
}

/// RFC 3264 direction attributes. Hold uses `sendonly`/`inactive`;
/// resume restores `sendrecv`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MediaDirection {
    #[default]
    Sendrecv,
    Sendonly,
    Recvonly,
    Inactive,
}

impl MediaDirection {
    pub fn attr(self) -> &'static str {
        match self {
            MediaDirection::Sendrecv => "sendrecv",
            MediaDirection::Sendonly => "sendonly",
            MediaDirection::Recvonly => "recvonly",
            MediaDirection::Inactive => "inactive",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.trim() {
            "sendrecv" => Some(MediaDirection::Sendrecv),
            "sendonly" => Some(MediaDirection::Sendonly),
            "recvonly" => Some(MediaDirection::Recvonly),
            "inactive" => Some(MediaDirection::Inactive),
            _ => None,
        }
    }
}

/// Parsed audio media section.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SdpMedia {
    pub port: u16,
    /// `RTP/SAVP` (secure) or `RTP/AVP` (plain).
    pub proto: String,
    pub codecs: Vec<RtpCodec>,
    /// Raw `a=crypto:...` lines (SDES-SRTP keying).
    pub crypto_lines: Vec<String>,
    pub direction: MediaDirection,
    pub ptime: u8,
}

impl SdpMedia {
    pub fn is_secure(&self) -> bool {
        self.proto == "RTP/SAVP" && !self.crypto_lines.is_empty()
    }
}

/// Minimal session wrapper (single audio m-line, the only topology the
/// native stack supports).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SdpOffer {
    pub connection: String,
    pub media: SdpMedia,
}

impl SdpOffer {
    /// Build a local JBM offer: exactly PCMU+PCMA over SAVP with one SDES
    /// crypto line. Opus is never included here (JBM offer-order guard).
    pub fn offer(connection: &str, port: u16, crypto_line: String, ptime: u8) -> Self {
        Self {
            connection: connection.to_string(),
            media: SdpMedia {
                port,
                proto: "RTP/SAVP".to_string(),
                codecs: vec![RtpCodec::Pcmu, RtpCodec::Pcma],
                crypto_lines: vec![crypto_line],
                direction: MediaDirection::Sendrecv,
                ptime,
            },
        }
    }

    /// Build a local interop offer: PCMU, PCMA, then Opus (dynamic
    /// [`OPUS_DYNAMIC_PT`]) over SAVP. JBM profiles must never use this.
    pub fn offer_interop(connection: &str, port: u16, crypto_line: String, ptime: u8) -> Self {
        Self {
            connection: connection.to_string(),
            media: SdpMedia {
                port,
                proto: "RTP/SAVP".to_string(),
                codecs: vec![
                    RtpCodec::Pcmu,
                    RtpCodec::Pcma,
                    RtpCodec::Opus(OPUS_DYNAMIC_PT),
                ],
                crypto_lines: vec![crypto_line],
                direction: MediaDirection::Sendrecv,
                ptime,
            },
        }
    }

    /// Negotiate an answer for a parsed remote offer. Enforces the JBM
    /// profile: errors unless the offer is SAVP *and* carries SDES crypto,
    /// and accepts PCMU/PCMA only (Opus present → [`SdpError::IncompatibleCodecs`]
    /// unless an interop answer path is used).
    pub fn answer_for(offer: &SdpOffer, crypto_line: String) -> Result<SdpOffer, SdpError> {
        Self::answer_for_allowed(offer, crypto_line, &[RtpCodec::Pcmu, RtpCodec::Pcma])
    }

    /// Negotiate an answer honouring an explicit codec allowlist (interop
    /// profiles pass PCMU/PCMA/Opus; JBM passes PCMU/PCMA via [`answer_for`](Self::answer_for)).
    /// SRTP enforcement is identical: SAVP + SDES crypto required, never downgraded.
    pub fn answer_for_allowed(
        offer: &SdpOffer,
        crypto_line: String,
        allowed: &[RtpCodec],
    ) -> Result<SdpOffer, SdpError> {
        if offer.media.proto != "RTP/SAVP" || offer.media.crypto_lines.is_empty() {
            return Err(SdpError::SrtpRequired);
        }
        // Intersect remote offer with the allowlist, preserving remote order.
        let mut negotiated: Vec<RtpCodec> = Vec::new();
        for c in &offer.media.codecs {
            // Opus matches any offered dynamic PT against an allowed Opus entry.
            let ok = match c {
                RtpCodec::Opus(_) => allowed.iter().any(|a| matches!(a, RtpCodec::Opus(_))),
                _ => allowed.contains(c),
            };
            if ok && !negotiated.iter().any(|n| std::mem::discriminant(n) == std::mem::discriminant(c)) {
                negotiated.push(*c);
            }
        }
        if negotiated.is_empty() {
            return Err(SdpError::IncompatibleCodecs);
        }
        Ok(SdpOffer {
            connection: offer.connection.clone(),
            media: SdpMedia {
                port: offer.media.port,
                proto: "RTP/SAVP".to_string(),
                codecs: negotiated,
                crypto_lines: vec![crypto_line],
                direction: match offer.media.direction {
                    MediaDirection::Sendonly => MediaDirection::Recvonly,
                    MediaDirection::Recvonly => MediaDirection::Sendonly,
                    d => d,
                },
                ptime: offer.media.ptime,
            },
        })
    }

    /// Re-INVITE/UPDATE offer placing the peer on hold.
    pub fn with_hold(&self) -> Self {
        let mut o = self.clone();
        o.media.direction = MediaDirection::Sendonly;
        o
    }

    /// Re-INVITE/UPDATE offer resuming from hold.
    pub fn with_resume(&self) -> Self {
        let mut o = self.clone();
        o.media.direction = MediaDirection::Sendrecv;
        o
    }

    pub fn to_string(&self) -> String {
        let m = &self.media;
        let fmt_list = m
            .codecs
            .iter()
            .map(|c| c.payload_type().to_string())
            .collect::<Vec<_>>()
            .join(" ");
        let mut s = format!(
            "v=0\r\n\
             o=daad 1 1 IN IP4 {conn}\r\n\
             s=daad\r\n\
             c=IN IP4 {conn}\r\n\
             t=0 0\r\n\
             m=audio {port} {proto} {fmts}\r\n",
            conn = self.connection,
            port = m.port,
            proto = m.proto,
            fmts = fmt_list,
        );
        for c in &m.codecs {
            let _ = writeln!(s, "a=rtpmap:{}", c.rtpmap());
        }
        for crypto in &m.crypto_lines {
            let _ = writeln!(s, "a=crypto:{crypto}");
        }
        let _ = writeln!(s, "a=ptime:{}", m.ptime);
        let _ = writeln!(s, "a={}", m.direction.attr());
        s
    }

    /// Parse the first audio m-line of a remote SDP blob. Dynamic Opus
    /// payloads are recognised via `a=rtpmap:<pt> opus/48000[/2]` lines
    /// (RFC 7587); unknown formats are skipped, never assumed.
    pub fn parse(raw: &str) -> Result<SdpOffer, SdpError> {
        let mut connection = String::new();
        let mut in_audio = false;
        let mut media: Option<SdpMedia> = None;
        /// m-line payload numbers in offer order (resolved at the end, once
        /// all `a=rtpmap` lines — including a late Opus mapping — are seen).
        let mut fmt_pts: Vec<u8> = Vec::new();
        /// Dynamic PT carrying `opus/48000`, if any rtpmap declares it.
        let mut opus_pt: Option<u8> = None;

        for line in raw.lines() {
            let line = line.trim();
            if let Some(conn) = line.strip_prefix("c=IN IP4 ") {
                if connection.is_empty() {
                    connection = conn.trim().to_string();
                }
            } else if let Some(rest) = line.strip_prefix("m=audio ") {
                let parts: Vec<&str> = rest.split_whitespace().collect();
                if parts.len() < 3 {
                    return Err(SdpError::Malformed("bad m=audio line"));
                }
                let port: u16 = parts[0].parse().map_err(|_| SdpError::Malformed("bad port"))?;
                let proto = parts[1].to_string();
                fmt_pts.clear();
                for pt in &parts[2..] {
                    if let Ok(n) = pt.parse::<u8>() {
                        fmt_pts.push(n);
                    }
                }
                in_audio = true;
                media = Some(SdpMedia {
                    port,
                    proto,
                    codecs: Vec::new(),
                    crypto_lines: Vec::new(),
                    direction: MediaDirection::Sendrecv,
                    ptime: 20,
                });
            } else if in_audio {
                if line.starts_with("m=") {
                    break; // only first audio section
                }
                if let Some(crypto) = line.strip_prefix("a=crypto:") {
                    if let Some(m) = media.as_mut() {
                        m.crypto_lines.push(crypto.trim().to_string());
                    }
                } else if let Some(rtpmap) = line.strip_prefix("a=rtpmap:") {
                    // `<pt> <encoding>/<clock>[/<channels>]`
                    let mut it = rtpmap.split_whitespace();
                    if let (Some(pt_s), Some(enc)) = (it.next(), it.next()) {
                        if let Ok(pt) = pt_s.parse::<u8>() {
                            let enc_lower = enc.to_ascii_lowercase();
                            if enc_lower == "opus/48000" || enc_lower.starts_with("opus/48000/") {
                                opus_pt = Some(pt);
                            }
                        }
                    }
                } else if let Some(dir) = line
                    .strip_prefix("a=")
                    .and_then(MediaDirection::parse)
                {
                    if let Some(m) = media.as_mut() {
                        m.direction = dir;
                    }
                } else if let Some(pt) = line.strip_prefix("a=ptime:") {
                    if let Some(m) = media.as_mut() {
                        // Clamp absurd values; Opus and G.711 both use 20 ms here.
                        // (Parsed wide: a u8 parse would reject "999" into the
                        // default before clamping ever ran.)
                        m.ptime = pt.trim().parse::<u16>().unwrap_or(20).clamp(10, 60) as u8;
                    }
                }
            }
        }

        let mut media = media.ok_or(SdpError::Malformed("no audio m-line"))?;
        // Resolve codecs in m-line order now that the Opus rtpmap is known.
        for pt in fmt_pts {
            if let Some(c) = RtpCodec::from_pt_with_opus(pt, opus_pt) {
                if !media.codecs.contains(&c) {
                    media.codecs.push(c);
                }
            }
        }
        if connection.is_empty() {
            return Err(SdpError::Malformed("no c= line"));
        }
        Ok(SdpOffer { connection, media })
    }
}

/// Map an [`SdpError`] to the SIP failure code the dialog must emit.
pub fn sip_code_for(err: &SdpError) -> u16 {
    match err {
        SdpError::SrtpRequired | SdpError::IncompatibleCodecs => 488,
        SdpError::Malformed(_) => 400,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn secure_offer_sdp() -> String {
        "v=0\r\n\
         o=asterisk 1 1 IN IP4 10.0.0.1\r\n\
         s=Asterisk\r\n\
         c=IN IP4 10.0.0.1\r\n\
         t=0 0\r\n\
         m=audio 11700 RTP/SAVP 0 8\r\n\
         a=rtpmap:0 PCMU/8000\r\n\
         a=rtpmap:8 PCMA/8000\r\n\
         a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:QUJDRA==\r\n\
         a=ptime:20\r\n\
         a=sendrecv\r\n"
            .to_string()
    }

    #[test]
    fn parse_secure_offer_and_answer() {
        let offer = SdpOffer::parse(&secure_offer_sdp()).unwrap();
        assert_eq!(offer.media.codecs, vec![RtpCodec::Pcmu, RtpCodec::Pcma]);
        assert!(offer.media.is_secure());
        let answer = SdpOffer::answer_for(&offer, "1 AES_CM_128_HMAC_SHA1_80 inline:SEVMTE8=".into());
        assert!(answer.is_ok());
        let answer = answer.unwrap();
        assert_eq!(answer.media.proto, "RTP/SAVP");
        assert_eq!(answer.media.crypto_lines.len(), 1);
    }

    #[test]
    fn plain_rtp_offer_rejected_never_downgraded() {
        let plain = secure_offer_sdp()
            .replace("RTP/SAVP", "RTP/AVP")
            .lines()
            .filter(|l| !l.trim_start_matches([' ', '\t']).starts_with("a=crypto:"))
            .collect::<Vec<_>>()
            .join("\r\n")
            + "\r\n";
        let offer = SdpOffer::parse(&plain).unwrap();
        assert!(!offer.media.is_secure());
        let err = SdpOffer::answer_for(&offer, "1 AES_CM_128_HMAC_SHA1_80 inline:SEVMTE8=".into())
            .expect_err("plain RTP must be rejected");
        assert_eq!(err, SdpError::SrtpRequired);
        assert_eq!(sip_code_for(&err), 488);
    }

    #[test]
    fn savp_without_crypto_also_rejected() {
        let no_crypto = secure_offer_sdp()
            .lines()
            .filter(|l| !l.trim_start_matches([' ', '\t']).starts_with("a=crypto:"))
            .collect::<Vec<_>>()
            .join("\r\n")
            + "\r\n";
        let offer = SdpOffer::parse(&no_crypto).unwrap();
        assert_eq!(offer.media.proto, "RTP/SAVP");
        let err = SdpOffer::answer_for(&offer, "1 AES_CM_128_HMAC_SHA1_80 inline:SEVMTE8=".into())
            .expect_err("SAVP without keys must be rejected");
        assert_eq!(err, SdpError::SrtpRequired);
    }

    #[test]
    fn unknown_codecs_rejected() {
        let opus = secure_offer_sdp().replace("0 8", "111").replace(
            "a=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000",
            "a=rtpmap:111 opus/48000/2",
        );
        let offer = SdpOffer::parse(&opus).unwrap();
        // Parsed (interop-visible) but rejected on the JBM answer path.
        assert_eq!(offer.media.codecs, vec![RtpCodec::Opus(111)]);
        let err = SdpOffer::answer_for(&offer, "1 AES_CM_128_HMAC_SHA1_80 inline:SEVMTE8=".into())
            .expect_err("opus-only must be rejected on the JBM profile");
        assert_eq!(err, SdpError::IncompatibleCodecs);
        assert_eq!(sip_code_for(&err), 488);
    }

    #[test]
    fn jbm_offer_stays_pcmu_pcma_exactly() {
        // JBM closed-profile guard: exactly [PCMU, PCMA], never Opus.
        let offer = SdpOffer::offer(
            "127.0.0.1",
            4000,
            "1 AES_CM_128_HMAC_SHA1_80 inline:QUJDRA==".into(),
            20,
        );
        assert_eq!(offer.media.codecs, vec![RtpCodec::Pcmu, RtpCodec::Pcma]);
        let text = offer.to_string();
        assert!(text.contains("m=audio 4000 RTP/SAVP 0 8"));
        assert!(!text.to_ascii_lowercase().contains("opus"));
    }

    #[test]
    fn interop_offer_appends_opus_after_g711() {
        let offer = SdpOffer::offer_interop(
            "127.0.0.1",
            4000,
            "1 AES_CM_128_HMAC_SHA1_80 inline:QUJDRA==".into(),
            20,
        );
        assert_eq!(
            offer.media.codecs,
            vec![RtpCodec::Pcmu, RtpCodec::Pcma, RtpCodec::Opus(OPUS_DYNAMIC_PT)]
        );
        let text = offer.to_string();
        assert!(text.contains("m=audio 4000 RTP/SAVP 0 8 111"), "{text}");
        assert!(text.contains("a=rtpmap:111 opus/48000/2"), "{text}");
        // Offer order preserved through parse: PCMU first, Opus last.
        let back = SdpOffer::parse(&text).unwrap();
        assert_eq!(
            back.media.codecs,
            vec![RtpCodec::Pcmu, RtpCodec::Pcma, RtpCodec::Opus(111)]
        );
        assert!(back.media.is_secure());
    }

    #[test]
    fn interop_answer_negotiates_opus_plain_rtp_still_rejected() {
        let offer = SdpOffer::parse(
            &SdpOffer::offer_interop(
                "10.0.0.1",
                11700,
                "1 AES_CM_128_HMAC_SHA1_80 inline:QUJDRA==".into(),
                20,
            )
            .to_string(),
        )
        .unwrap();
        let answer = SdpOffer::answer_for_allowed(
            &offer,
            "1 AES_CM_128_HMAC_SHA1_80 inline:SEVMTE8=".into(),
            &[RtpCodec::Pcmu, RtpCodec::Pcma, RtpCodec::Opus(OPUS_DYNAMIC_PT)],
        )
        .unwrap();
        assert_eq!(answer.media.proto, "RTP/SAVP");
        assert!(answer.media.codecs.contains(&RtpCodec::Opus(111)));
        // Downgrade to plain RTP is still rejected on the interop path.
        let mut plain = offer.clone();
        plain.media.proto = "RTP/AVP".into();
        plain.media.crypto_lines.clear();
        let err = SdpOffer::answer_for_allowed(
            &plain,
            "1 AES_CM_128_HMAC_SHA1_80 inline:SEVMTE8=".into(),
            &[RtpCodec::Pcmu, RtpCodec::Pcma, RtpCodec::Opus(OPUS_DYNAMIC_PT)],
        )
        .expect_err("plain RTP must be rejected on interop profiles too");
        assert_eq!(err, SdpError::SrtpRequired);
        assert_eq!(sip_code_for(&err), 488);
    }

    #[test]
    fn opus_rtpmap_variants_and_ptime_clamp() {
        for (pt, rtpmap) in [(96u8, "a=rtpmap:96 opus/48000"), (111u8, "a=rtpmap:111 opus/48000/2")] {
            let sdp = format!(
                "v=0\r\n\
                 o=asterisk 1 1 IN IP4 10.0.0.1\r\n\
                 s=Asterisk\r\n\
                 c=IN IP4 10.0.0.1\r\n\
                 t=0 0\r\n\
                 m=audio 11700 RTP/SAVP {pt}\r\n\
                 {rtpmap}\r\n\
                 a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:QUJDRA==\r\n\
                 a=ptime:20\r\n\
                 a=sendrecv\r\n"
            );
            let offer = SdpOffer::parse(&sdp).unwrap();
            assert_eq!(offer.media.codecs, vec![RtpCodec::Opus(pt)], "{rtpmap}");
        }
        // Absurd ptime values clamp instead of poisoning negotiation.
        let weird = secure_offer_sdp().replace("a=ptime:20", "a=ptime:999");
        assert_eq!(SdpOffer::parse(&weird).unwrap().media.ptime, 60);
    }

    #[test]
    fn hold_resume_direction_attrs() {
        let offer = SdpOffer::parse(&secure_offer_sdp()).unwrap();
        let hold = offer.with_hold();
        assert_eq!(hold.media.direction, MediaDirection::Sendonly);
        assert!(hold.to_string().contains("a=sendonly"));
        let resume = hold.with_resume();
        assert_eq!(resume.media.direction, MediaDirection::Sendrecv);
        assert!(resume.to_string().contains("a=sendrecv"));
    }

    #[test]
    fn offer_roundtrip() {
        let offer = SdpOffer::offer(
            "127.0.0.1",
            4000,
            "1 AES_CM_128_HMAC_SHA1_80 inline:QUJDRA==".into(),
            20,
        );
        let text = offer.to_string();
        assert!(text.contains("m=audio 4000 RTP/SAVP 0 8"));
        let back = SdpOffer::parse(&text).unwrap();
        assert_eq!(back.media.codecs, vec![RtpCodec::Pcmu, RtpCodec::Pcma]);
        assert!(back.media.is_secure());
    }
}
