//! SIP account profile: addressing, transport, codecs and media policy.
//!
//! The profile intentionally carries **no secrets**. Passwords live in the
//! OS keychain via [`crate::sip_core::keystore`] and are only borrowed at
//! the moment a REGISTER challenge must be answered. Nothing here logs
//! credentials (there are none to log).
//!
//! JBM media profile (enforced by [`SipProfile::validate`]):
//! - SDES-SRTP mandatory, video disabled, symmetric RTP required.
//! - Codec offer order: PCMU first, then PCMA.
//! - Dialling: numeric extensions of 3–8 digits only.

use serde::{Deserialize, Serialize};

/// SIP signalling transport. TLS is the required default; TCP/UDP exist for
/// lab interoperability and must be chosen explicitly per account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SipTransport {
    /// Mandatory for production (SIP/TLS, default 5061).
    #[default]
    Tls,
    Tcp,
    Udp,
}

impl SipTransport {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s.trim().to_ascii_lowercase().as_str() {
            "tls" => Ok(Self::Tls),
            "tcp" => Ok(Self::Tcp),
            "udp" => Ok(Self::Udp),
            other => Err(format!("unsupported SIP transport '{other}' (expected tls|tcp|udp)")),
        }
    }

    pub fn default_port(self) -> u16 {
        match self {
            Self::Tls => 5061,
            Self::Tcp | Self::Udp => 5060,
        }
    }

    pub fn via_token(self) -> &'static str {
        match self {
            Self::Tls => "TLS",
            Self::Tcp => "TCP",
            Self::Udp => "UDP",
        }
    }
}

/// Audio codec in JBM offer order. PCMU MUST come before PCMA.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AudioCodec {
    Pcmu,
    Pcma,
}

impl AudioCodec {
    pub fn payload_type(self) -> u8 {
        match self {
            Self::Pcmu => 0,
            Self::Pcma => 8,
        }
    }

    pub fn sdp_name(self) -> &'static str {
        match self {
            Self::Pcmu => "PCMU",
            Self::Pcma => "PCMA",
        }
    }
}

/// Media policy: SDES-SRTP mandatory, no video, symmetric RTP.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaPolicy {
    /// SDES-SRTP is required; clear RTP MUST be rejected, never negotiated
    /// down silently.
    pub srtp_required: bool,
    /// No video m-lines are ever offered or accepted.
    pub video_enabled: bool,
    /// Symmetric RTP (send/recv on the same port pair).
    pub symmetric_rtp: bool,
}

impl Default for MediaPolicy {
    fn default() -> Self {
        Self {
            srtp_required: true,
            video_enabled: false,
            symmetric_rtp: true,
        }
    }
}

/// Validated SIP account profile. Secrets are NOT stored here.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SipProfile {
    /// Stable account id (keychain key, log correlation). Never a secret.
    pub account_id: String,
    /// Hostname or IP of the PBX. Configurable per deployment — never
    /// hardcoded. The test core address is supplied at runtime, not here.
    pub hostname: String,
    pub port: u16,
    pub transport: SipTransport,
    /// Extension / authorization username (numeric, 3–8 digits).
    pub username: String,
    pub display_name: Option<String>,
    /// SIP domain for the AoR; defaults to `hostname` when empty.
    pub domain: Option<String>,
    /// PEM-encoded deployment CA for private-IP PBX certificates.
    /// `None` means system roots only (still fully verified, fail-closed).
    pub ca_pem: Option<String>,
    /// Registration expiry requested from the registrar (seconds).
    pub expires_secs: u32,
    /// Codec offer order. MUST be [Pcmu, Pcma] per JBM profile.
    pub codecs: Vec<AudioCodec>,
    pub media: MediaPolicy,
}

impl SipProfile {
    pub fn validate(&self) -> Result<(), String> {
        if self.account_id.trim().is_empty() {
            return Err("account_id must not be empty".into());
        }
        validate_hostname(&self.hostname)?;
        if self.port == 0 {
            return Err("port must be 1..=65535".into());
        }
        validate_extension(&self.username)
            .map_err(|e| format!("invalid username/extension: {e}"))?;
        if !(60..=3600).contains(&self.expires_secs) {
            return Err(format!(
                "expires_secs must be 60..=3600, got {}",
                self.expires_secs
            ));
        }
        if self.codecs != [AudioCodec::Pcmu, AudioCodec::Pcma] {
            return Err("codec offer order must be exactly [PCMU, PCMA] (JBM profile)".into());
        }
        if !self.media.srtp_required {
            return Err("SDES-SRTP is mandatory; srtp_required must be true".into());
        }
        if self.media.video_enabled {
            return Err("video must stay disabled".into());
        }
        if !self.media.symmetric_rtp {
            return Err("symmetric RTP is required".into());
        }
        if let Some(pem) = &self.ca_pem {
            if !pem.contains("BEGIN CERTIFICATE") {
                return Err("ca_pem does not look like a PEM certificate".into());
            }
        }
        Ok(())
    }

    /// Effective SIP domain (explicit domain or hostname fallback).
    pub fn effective_domain(&self) -> &str {
        self.domain
            .as_deref()
            .filter(|d| !d.trim().is_empty())
            .unwrap_or(&self.hostname)
    }

    /// Address-of-record: `sip:<user>@<domain>`.
    pub fn aor(&self) -> String {
        format!("sip:{}@{}", self.username, self.effective_domain())
    }

    /// Request-URI for REGISTER.
    pub fn request_uri(&self) -> String {
        format!("sip:{}", self.effective_domain())
    }

    /// Contact URI bound to the native transport (no `transport=ws`; the
    /// WebSocket pinning of the legacy sip.js bridge does not apply here).
    pub fn contact_uri(&self, local_ip: &str, local_port: u16) -> String {
        format!(
            "sip:{}@{}:{};transport={}",
            self.username,
            local_ip,
            local_port,
            self.transport.via_token().to_ascii_lowercase()
        )
    }
}

/// Numeric extension dialling rule: 3–8 ASCII digits, nothing else.
/// Leading zeros are rejected (JBM single-profile dial plan: extensions are
/// non-zero-prefixed; matches the webview `validateDialTarget`).
pub fn validate_extension(ext: &str) -> Result<(), String> {
    let t = ext.trim();
    if !(3..=8).contains(&t.len()) {
        return Err(format!(
            "extension must be 3-8 digits, got length {}",
            t.len()
        ));
    }
    if !t.bytes().all(|b| b.is_ascii_digit()) {
        return Err("extension must contain only ASCII digits 0-9".into());
    }
    if t.starts_with('0') {
        return Err("extension must not start with 0".into());
    }
    Ok(())
}

/// Returns `true` for diallable destinations (extension rule only).
pub fn is_diallable(target: &str) -> bool {
    validate_extension(target).is_ok()
}

fn validate_hostname(host: &str) -> Result<(), String> {
    let h = host.trim();
    if h.is_empty() {
        return Err("hostname must not be empty".into());
    }
    for scheme in ["sip:", "sips:", "tls://", "tcp://", "udp://", "ws://", "wss://", "http://", "https://"] {
        if h.to_ascii_lowercase().starts_with(scheme) {
            return Err(format!("hostname must be a bare host/IP, not a URL ('{scheme}...' prefix forbidden)"));
        }
    }
    if h.len() > 253 {
        return Err("hostname too long".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_profile() -> SipProfile {
        SipProfile {
            account_id: "test-1".into(),
            hostname: "pbx.example.com".into(),
            port: 5061,
            transport: SipTransport::Tls,
            username: "2001".into(),
            display_name: Some("User 2001".into()),
            domain: None,
            ca_pem: None,
            expires_secs: 600,
            codecs: vec![AudioCodec::Pcmu, AudioCodec::Pcma],
            media: MediaPolicy::default(),
        }
    }

    #[test]
    fn valid_profile_passes() {
        assert!(valid_profile().validate().is_ok());
    }

    #[test]
    fn profile_carries_no_secret_field() {
        // Compile-time guard: serialised profile must not contain a password.
        let json = serde_json::to_string(&valid_profile()).unwrap();
        assert!(!json.to_ascii_lowercase().contains("password"));
        assert!(!json.to_ascii_lowercase().contains("secret"));
    }

    #[test]
    fn transport_parse_and_defaults() {
        assert_eq!(SipTransport::parse("TLS").unwrap(), SipTransport::Tls);
        assert_eq!(SipTransport::parse("tcp").unwrap(), SipTransport::Tcp);
        assert_eq!(SipTransport::parse("udp").unwrap(), SipTransport::Udp);
        assert!(SipTransport::parse("wss").is_err());
        assert!(SipTransport::parse("").is_err());
        assert_eq!(SipTransport::Tls.default_port(), 5061);
        assert_eq!(SipTransport::Tcp.default_port(), 5060);
    }

    #[test]
    fn extension_rule_numeric_3_to_8() {
        for good in ["100", "2001", "12345678"] {
            assert!(validate_extension(good).is_ok(), "{good}");
            assert!(is_diallable(good));
        }
        for bad in ["", "12", "123456789", "20a1", "+201", "2 01", "sip:2001", "*2001", "0123", "007"] {
            assert!(validate_extension(bad).is_err(), "{bad}");
            assert!(!is_diallable(bad));
        }
    }

    #[test]
    fn hostname_must_be_bare_and_present() {
        let mut p = valid_profile();
        p.hostname = String::new();
        assert!(p.validate().is_err());
        p.hostname = "tls://pbx.example.com".into();
        assert!(p.validate().is_err());
        p.hostname = "sip:pbx.example.com".into();
        assert!(p.validate().is_err());
        p.hostname = "10.0.0.5".into();
        p.port = 5061;
        assert!(p.validate().is_ok(), "plain IPs are valid runtime config");
    }

    #[test]
    fn no_hardcoded_test_core_address() {
        // The test-core IP must be supplied at runtime, never baked in.
        // (Needle is assembled so this file's own source never contains it.)
        let needle = ["10", "41", "113", "71"].join(".");
        let src = include_str!("account.rs");
        assert!(
            !src.contains(&needle),
            "account.rs must not hardcode the test-core address"
        );
    }

    #[test]
    fn codec_order_is_pcmu_then_pcma() {
        let mut p = valid_profile();
        p.codecs = vec![AudioCodec::Pcma, AudioCodec::Pcmu];
        assert!(p.validate().is_err());
        p.codecs = vec![AudioCodec::Pcmu];
        assert!(p.validate().is_err());
    }

    #[test]
    fn media_policy_cannot_downgrade() {
        let mut p = valid_profile();
        p.media.srtp_required = false;
        assert!(p.validate().is_err());
        p = valid_profile();
        p.media.video_enabled = true;
        assert!(p.validate().is_err());
        p = valid_profile();
        p.media.symmetric_rtp = false;
        assert!(p.validate().is_err());
    }

    #[test]
    fn expires_bounds() {
        let mut p = valid_profile();
        p.expires_secs = 30;
        assert!(p.validate().is_err());
        p.expires_secs = 7200;
        assert!(p.validate().is_err());
    }

    #[test]
    fn aor_and_contact_shapes() {
        let p = valid_profile();
        assert_eq!(p.aor(), "sip:2001@pbx.example.com");
        assert_eq!(p.request_uri(), "sip:pbx.example.com");
        assert_eq!(
            p.contact_uri("192.168.1.10", 5070),
            "sip:2001@192.168.1.10:5070;transport=tls"
        );
    }
}
