//! Account input parsing. No SIP transactions or media implementation here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SipTransport { Tls, Tcp, Udp }
impl SipTransport {
    pub fn default_port(self) -> u16 { if self == Self::Tls {5061} else {5060} }
    pub fn via_token(self) -> &'static str { match self { Self::Tls => "TLS", Self::Tcp => "TCP", Self::Udp => "UDP" } }
}
pub(crate) fn validate_device_username(username: &str) -> Result<(), String> {
    if username.is_empty() || username.len() > 64 || !username.bytes().all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c)) {
        return Err("SIP username must contain 1-64 letters, digits, dots, dashes or underscores.".into());
    }
    Ok(())
}
pub(crate) fn parse_server_url(server_url: &str) -> Result<(SipTransport, String, u16), String> {
    let raw = server_url.trim();
    if raw.is_empty() {
        return Err("serverUrl must not be empty".into());
    }
    let lower = raw.to_ascii_lowercase();
    if lower.starts_with("ws://") || lower.starts_with("wss://") {
        return Err("native core expects a tls://, tcp://, udp:// or sip: serverUrl (WebSocket servers are not supported by the native phone)".into());
    }
    let (transport, rest) = if lower.starts_with("tls://") {
        (SipTransport::Tls, raw[6..].trim())
    } else if lower.starts_with("tcp://") {
        (SipTransport::Tcp, raw[6..].trim())
    } else if lower.starts_with("udp://") {
        (SipTransport::Udp, raw[6..].trim())
    } else if lower.starts_with("sip:") {
        let mut r = raw[4..].trim();
        let mut t = SipTransport::Tls;
        if let Some(semi) = r.find(';') {
            let params = r[semi..].to_ascii_lowercase();
            if params.contains("transport=tcp") {
                t = SipTransport::Tcp;
            } else if params.contains("transport=udp") {
                t = SipTransport::Udp;
            }
            r = r[..semi].trim();
        }
        // `sip:user@host` — the username argument is authoritative.
        if let Some(at) = r.find('@') {
            r = r[at + 1..].trim();
        }
        (t, r)
    } else {
        (SipTransport::Tls, raw)
    };
    let rest = rest.split('/').next().unwrap_or("").trim();
    if rest.is_empty() {
        return Err("serverUrl must contain a host".into());
    }
    let (host, port) = if let Some(stripped) = rest.strip_prefix('[') {
        let end = stripped
            .find(']')
            .ok_or_else(|| format!("invalid IPv6 host in serverUrl '{rest}'"))?;
        let after = stripped[end + 1..].trim();
        let port = if let Some(p) = after.strip_prefix(':') {
            p.trim()
                .parse::<u16>()
                .map_err(|_| format!("invalid port in serverUrl '{rest}'"))?
        } else if after.is_empty() {
            transport.default_port()
        } else {
            return Err(format!("invalid host in serverUrl '{rest}'"));
        };
        (stripped[..end].to_string(), port)
    } else {
        match rest.rfind(':') {
            Some(i) if rest[..i].contains(':') => {
                return Err("wrap IPv6 hosts in [brackets] in serverUrl".into());
            }
            Some(i) => {
                let port = rest[i + 1..]
                    .trim()
                    .parse::<u16>()
                    .map_err(|_| format!("invalid port in serverUrl '{rest}'"))?;
                (rest[..i].trim().to_string(), port)
            }
            None => (rest.to_string(), transport.default_port()),
        }
    };
    if host.is_empty() || port == 0 || host.chars().any(|c| c.is_whitespace() || matches!(c, '@' | ';' | '<' | '>')) {
        return Err("serverUrl must contain a host".into());
    }
    Ok((transport, host, port))
}

/// Split `sip:<user>@<domain>` (trailing `;params` dropped).
pub(crate) fn parse_sip_uri(sip_uri: &str) -> Result<(String, String), String> {
    let raw = sip_uri.trim();
    let no_scheme = raw
        .strip_prefix("sip:")
        .or_else(|| raw.strip_prefix("SIP:"))
        .ok_or_else(|| "sipUri must look like sip:<device-username>@<domain>".to_string())?;
    let (user, domain) = no_scheme
        .split_once('@')
        .ok_or_else(|| "sipUri must look like sip:<device-username>@<domain>".to_string())?;
    let user = user.trim().to_string();
    let domain = domain.split(';').next().unwrap_or("").trim().to_string();
    if user.is_empty() || domain.is_empty() {
        return Err("sipUri must look like sip:<device-username>@<domain>".into());
    }
    Ok((user, domain))
}

/// Validate the optional deployment CA PEM from provisioning. Empty means
/// "system roots only" (still fully verified, fail-closed). A non-empty
/// value must look like a PEM bundle; deep parsing happens in `tls.rs`
/// (a bundle with zero usable certs is a hard connect error there).
pub(crate) fn validate_custom_ca(input: Option<String>) -> Result<Option<String>, String> {
    match input {
        None => Ok(None),
        Some(p) if p.trim().is_empty() => Ok(None),
        Some(p) => {
            let t = p.trim().to_string();
            if !t.contains("BEGIN CERTIFICATE") || !t.contains("END CERTIFICATE") {
                return Err("custom_ca_pem must be a PEM bundle with BEGIN/END CERTIFICATE lines".into());
            }
            Ok(Some(t))
        }
    }
}


#[cfg(test)]
mod tests {
use super::*;
    #[test]
    fn server_url_shapes() {
        assert_eq!(
            parse_server_url("tls://pbx.example.com:5061").unwrap(),
            (SipTransport::Tls, "pbx.example.com".into(), 5061)
        );
        assert_eq!(
            parse_server_url("tcp://10.0.0.5").unwrap(),
            (SipTransport::Tcp, "10.0.0.5".into(), 5060)
        );
        assert_eq!(
            parse_server_url("udp://10.0.0.5:5060").unwrap(),
            (SipTransport::Udp, "10.0.0.5".into(), 5060)
        );
        // Bare host defaults to TLS/5061; sip: URIs honour transport params.
        assert_eq!(
            parse_server_url("pbx.example.com").unwrap(),
            (SipTransport::Tls, "pbx.example.com".into(), 5061)
        );
        assert_eq!(
            parse_server_url("sip:pbx.example.com;transport=tcp").unwrap(),
            (SipTransport::Tcp, "pbx.example.com".into(), 5060)
        );
        assert_eq!(
            parse_server_url("sip:2001@pbx.example.com:5061").unwrap(),
            (SipTransport::Tls, "pbx.example.com".into(), 5061)
        );
        // Bracketed IPv6 works; bare IPv6 is rejected (ambiguous port).
        assert_eq!(
            parse_server_url("tls://[fd00::1]:5061").unwrap(),
            (SipTransport::Tls, "fd00::1".into(), 5061)
        );
        assert!(parse_server_url("tls://[fd00::1").is_err());
        assert!(parse_server_url("tls://::1").is_err());
        // WSS belongs to the legacy bridge; empty/hostless inputs rejected.
        assert!(parse_server_url("wss://pbx.example.com:8089/ws").is_err());
        assert!(parse_server_url("ws://127.0.0.1:5060").is_err());
        assert!(parse_server_url("").is_err());
        assert!(parse_server_url("tls://").is_err());
        assert!(parse_server_url("tls://pbx.example.com:notaport").is_err());
    }

    #[test]
    fn sip_uri_shapes() {
        assert_eq!(
            parse_sip_uri("sip:2001@pbx.example.com").unwrap(),
            ("2001".into(), "pbx.example.com".into())
        );
        assert_eq!(
            parse_sip_uri("sip:2001@pbx.example.com;transport=tls").unwrap(),
            ("2001".into(), "pbx.example.com".into())
        );
        assert!(parse_sip_uri("2001@pbx.example.com").is_err());
        assert!(parse_sip_uri("sip:2001").is_err());
        assert!(parse_sip_uri("sip:@pbx.example.com").is_err());
        assert!(parse_sip_uri("sip:2001@").is_err());
    }

}
