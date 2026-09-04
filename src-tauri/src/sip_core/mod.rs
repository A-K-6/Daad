//! Native SIP call + media core (Phase 2).
//!
//! Sans-io call-signaling state machines plus media-plane helpers. This crate
//! module owns INVITE/100/180/183/200/ACK/CANCEL/BYE lifecycle, SDP
//! offer/answer for PCMU/PCMA with mandatory SDES-SRTP (JBM profile), RTP
//! sequencing, SRTP protection via `webrtc-srtp`, G.711 via `ezk-g711`,
//! RTP packetization via `rtp`, audio routing via `cpal`, and RFC 4733 DTMF.
//!
//! Invariants:
//! - Never downgrade SRTP silently: plain RTP is rejected, never accepted.
//! - Never log keys: [`srtp::SrtpKeys`] redacts material in `Debug` and
//!   zeroes memory on drop.
//! - Numeric extensions only: [`validate_extension`] rejects SIP URIs and
//!   PSTN-style inputs.
//! - No recording: this module exposes no recording API by design.

pub mod account;
pub mod audio;
pub mod call;
pub mod diagnostics;
pub mod dialog;
pub mod dtmf;
pub mod keystore;
pub mod register;
pub mod rtp;
pub mod sdp;
pub mod srtp;
pub mod state;
pub mod tls;
pub mod transport;
pub mod wire;

pub use call::{CallDirection, CallEvent, CallManager, CallStateNative, WhichLeg};
pub use dialog::{DialogState, InviteDedupCache, TransferProgress};
pub use sdp::{MediaDirection, RtpCodec};

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("invalid extension dial target: {0}")]
    InvalidExtension(String),
    #[error("call already in progress")]
    AlreadyInCall,
    #[error("no active call")]
    NoActiveCall,
    #[error("operation not valid in current state: {0}")]
    BadState(&'static str),
    #[error("dialog error: {0}")]
    Dialog(#[from] dialog::DialogError),
    #[error("sdp error: {0}")]
    Sdp(#[from] sdp::SdpError),
    #[error("srtp error: {0}")]
    Srtp(#[from] srtp::SrtpError),
    #[error("rtp error: {0}")]
    Rtp(#[from] rtp::RtpError),
    #[error("audio error: {0}")]
    Audio(#[from] audio::AudioError),
    #[error("dtmf error: {0}")]
    Dtmf(#[from] dtmf::DtmfError),
}

/// Validate a dial target. Delegates to the single Phase-1 dial rule
/// ([`account::validate_extension`]: 3–8 ASCII digits) so the native stack
/// has one source of truth; SIP URIs and PSTN-style inputs are rejected so
/// the call leg can never be tricked into arbitrary-URI dialing.
pub fn validate_extension(raw: &str) -> Result<String, CoreError> {
    let ext = raw.trim().to_string();
    account::validate_extension(&ext).map_err(CoreError::InvalidExtension)?;
    Ok(ext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_numeric_extensions() {
        assert_eq!(validate_extension("2001").unwrap(), "2001");
        assert_eq!(validate_extension(" 2001 ").unwrap(), "2001");
    }

    #[test]
    fn rejects_uri_pstn_and_short_inputs() {
        for bad in [
            "sip:2001@pbx.local",
            "+12025550134",
            "2001;transport=tcp",
            "2a01",
            "",
            "   ",
            "42", // Phase-1 dial rule: 3–8 digits
            "2001 2002",
        ] {
            assert!(validate_extension(bad).is_err(), "accepted {bad:?}");
        }
    }
}
