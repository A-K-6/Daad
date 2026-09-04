//! SDES-SRTP protection via the maintained `webrtc-srtp` crate.
//!
//! JBM profile: `AES_CM_128_HMAC_SHA1_80` only. Keys come from the SDP
//! `a=crypto` inline material negotiated in [`crate::sdp`]; this module
//! never accepts plain RTP (see [`require_sdes`]) and never logs key
//! material ([`SrtpKeys`] has a redacting `Debug` impl and zeroes on drop).

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rand::RngCore;
use webrtc_srtp::context::Context;
use webrtc_srtp::option::{srtcp_replay_protection, srtp_replay_protection};
use webrtc_srtp::protection_profile::ProtectionProfile;

pub const MASTER_KEY_LEN: usize = 16;
pub const MASTER_SALT_LEN: usize = 14;
/// Sliding replay window per RFC 3711 §3.3.2 guidance.
pub const REPLAY_WINDOW: usize = 128;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SrtpError {
    #[error("SDES-SRTP required: refusing plain RTP (no silent downgrade)")]
    PlainRtpRejected,
    #[error("replayed packet rejected (sequence already seen)")]
    ReplayDetected,
    #[error("authentication/decryption failed")]
    AuthFailed,
    #[error("bad SDES inline key material")]
    BadKeyMaterial,
    #[error("srtp backend error: {0}")]
    Backend(String),
}

/// Master key + salt for one SRTP direction. Redacted in logs; zeroed on drop.
pub struct SrtpKeys {
    master_key: [u8; MASTER_KEY_LEN],
    master_salt: [u8; MASTER_SALT_LEN],
}

impl SrtpKeys {
    pub fn generate() -> Self {
        let mut key = [0u8; MASTER_KEY_LEN];
        let mut salt = [0u8; MASTER_SALT_LEN];
        let mut rng = rand::thread_rng();
        rng.fill_bytes(&mut key);
        rng.fill_bytes(&mut salt);
        Self {
            master_key: key,
            master_salt: salt,
        }
    }

    /// Parse the base64 portion of `a=crypto:<tag> AES_CM_128_HMAC_SHA1_80
    /// inline:<b64>` into key||salt (30 bytes).
    pub fn from_inline_base64(b64: &str) -> Result<Self, SrtpError> {
        let raw = B64.decode(b64.trim()).map_err(|_| SrtpError::BadKeyMaterial)?;
        if raw.len() != MASTER_KEY_LEN + MASTER_SALT_LEN {
            return Err(SrtpError::BadKeyMaterial);
        }
        let mut key = [0u8; MASTER_KEY_LEN];
        let mut salt = [0u8; MASTER_SALT_LEN];
        key.copy_from_slice(&raw[..MASTER_KEY_LEN]);
        salt.copy_from_slice(&raw[MASTER_KEY_LEN..]);
        Ok(Self {
            master_key: key,
            master_salt: salt,
        })
    }

    /// Serialize to the base64 portion of an `inline:` value.
    pub fn to_inline_base64(&self) -> String {
        let mut raw = Vec::with_capacity(MASTER_KEY_LEN + MASTER_SALT_LEN);
        raw.extend_from_slice(&self.master_key);
        raw.extend_from_slice(&self.master_salt);
        B64.encode(raw)
    }

    /// Full `a=crypto` value line (without the `a=crypto:` prefix).
    pub fn to_crypto_attr(&self, tag: u8) -> String {
        format!(
            "{tag} AES_CM_128_HMAC_SHA1_80 inline:{}",
            self.to_inline_base64()
        )
    }
}

// Never log key material.
impl std::fmt::Debug for SrtpKeys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SrtpKeys")
            .field("master_key", &"<redacted>")
            .field("master_salt", &"<redacted>")
            .finish()
    }
}

impl Drop for SrtpKeys {
    fn drop(&mut self) {
        for b in self.master_key.iter_mut().chain(self.master_salt.iter_mut()) {
            *b = 0;
        }
    }
}

/// Enforce mandatory SRTP: call with whether the negotiated SDP carried
/// SDES crypto. Plain RTP is an error, never a fallback.
pub fn require_sdes(has_sdes_crypto: bool) -> Result<(), SrtpError> {
    if has_sdes_crypto {
        Ok(())
    } else {
        Err(SrtpError::PlainRtpRejected)
    }
}

/// One-way SRTP session (encrypt *or* decrypt per `webrtc-srtp` rules).
pub struct SrtpSession {
    ctx: Context,
}

impl SrtpSession {
    fn new(keys: &SrtpKeys) -> Result<Self, SrtpError> {
        let ctx = Context::new(
            &keys.master_key,
            &keys.master_salt,
            ProtectionProfile::Aes128CmHmacSha1_80,
            Some(srtp_replay_protection(REPLAY_WINDOW)),
            Some(srtcp_replay_protection(REPLAY_WINDOW)),
        )
        .map_err(|e| SrtpError::Backend(e.to_string()))?;
        Ok(Self { ctx })
    }

    /// Outbound (encryption) side.
    pub fn new_sender(keys: &SrtpKeys) -> Result<Self, SrtpError> {
        Self::new(keys)
    }

    /// Inbound (decryption + replay-window) side.
    pub fn new_receiver(keys: &SrtpKeys) -> Result<Self, SrtpError> {
        Self::new(keys)
    }

    /// Encrypt a marshalled RTP packet (header + payload).
    pub fn protect(&mut self, rtp_packet: &[u8]) -> Result<Vec<u8>, SrtpError> {
        self.ctx
            .encrypt_rtp(rtp_packet)
            .map(|b| b.to_vec())
            .map_err(|e| SrtpError::Backend(e.to_string()))
    }

    /// Decrypt an SRTP packet. Replays are rejected by the library's
    /// sliding window and surfaced as [`SrtpError::ReplayDetected`].
    pub fn unprotect(&mut self, srtp_packet: &[u8]) -> Result<Vec<u8>, SrtpError> {
        self.ctx.decrypt_rtp(srtp_packet).map(|b| b.to_vec()).map_err(|e| {
            let msg = e.to_string();
            // webrtc-srtp reports duplicates as SsrcDuplicated; auth
            // failures surface as cipher/auth errors.
            if msg.contains("duplicated") || msg.contains("Duplicated") || msg.contains("replay") {
                SrtpError::ReplayDetected
            } else {
                SrtpError::AuthFailed
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sip_core::rtp::{build_packet, parse_packet};

    fn packet_bytes(seq: u16) -> Vec<u8> {
        build_packet(seq, 160 * seq as u32, 0x1234, 0, false, &[0xFFu8; 160])
    }

    #[test]
    fn roundtrip_via_lib_apis() {
        let keys = SrtpKeys::generate();
        let mut tx = SrtpSession::new_sender(&keys).unwrap();
        let mut rx = SrtpSession::new_receiver(&keys).unwrap();
        let plain = packet_bytes(1);
        let enc = tx.protect(&plain).unwrap();
        assert_ne!(enc, plain);
        let dec = rx.unprotect(&enc).unwrap();
        assert_eq!(dec, plain);
        // And the decrypted bytes still parse as RTP.
        let pkt = parse_packet(&dec).unwrap();
        assert_eq!(pkt.header.sequence_number, 1);
    }

    #[test]
    fn replay_window_rejects_second_delivery() {
        let keys = SrtpKeys::generate();
        let mut tx = SrtpSession::new_sender(&keys).unwrap();
        let mut rx = SrtpSession::new_receiver(&keys).unwrap();
        let enc = tx.protect(&packet_bytes(7)).unwrap();
        rx.unprotect(&enc).unwrap();
        let err = rx.unprotect(&enc).expect_err("replay must be rejected");
        assert_eq!(err, SrtpError::ReplayDetected);
    }

    #[test]
    fn wrong_key_fails_authentication() {
        let a = SrtpKeys::generate();
        let b = SrtpKeys::generate();
        let mut tx = SrtpSession::new_sender(&a).unwrap();
        let mut rx = SrtpSession::new_receiver(&b).unwrap();
        let enc = tx.protect(&packet_bytes(3)).unwrap();
        assert_eq!(rx.unprotect(&enc).unwrap_err(), SrtpError::AuthFailed);
    }

    #[test]
    fn plain_rtp_never_accepted_silently() {
        assert_eq!(require_sdes(false).unwrap_err(), SrtpError::PlainRtpRejected);
        assert!(require_sdes(true).is_ok());
    }

    #[test]
    fn sdes_inline_material_roundtrips() {
        let keys = SrtpKeys::generate();
        let attr = keys.to_crypto_attr(1);
        assert!(attr.starts_with("1 AES_CM_128_HMAC_SHA1_80 inline:"));
        let b64 = attr.split("inline:").nth(1).unwrap();
        let back = SrtpKeys::from_inline_base64(b64).unwrap();
        assert_eq!(back.to_inline_base64(), keys.to_inline_base64());
    }

    #[test]
    fn debug_redacts_key_material() {
        let keys = SrtpKeys::generate();
        let dbg = format!("{keys:?}");
        assert!(dbg.contains("<redacted>"));
        assert!(!dbg.contains(&keys.to_inline_base64()));
    }
}
