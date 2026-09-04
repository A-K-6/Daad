//! DTMF telephone-events per RFC 4733.
//!
//! Digits travel as RTP telephone-event payloads (dynamic PT, negotiated
//! out-of-band; 101 by convention) alongside — never instead of — the local
//! UI feedback tone. Payload: event(1) | E+volume(1) | duration(2).

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DtmfError {
    #[error("invalid DTMF digit: {0:?} (allowed 0-9 * # A-D)")]
    InvalidDigit(String),
    #[error("malformed telephone-event payload")]
    Malformed,
}

/// Conventional dynamic payload type for telephone-event.
pub const TELEPHONE_EVENT_PT: u8 = 101;
/// RFC 4733 recommends ~50 ms tone with end packets at 20 ms spacing.
pub const DEFAULT_DURATION_TS: u16 = 400; // 50 ms @ 8 kHz

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DtmfDigit(char);

impl DtmfDigit {
    pub fn parse(c: char) -> Result<Self, DtmfError> {
        let up = c.to_ascii_uppercase();
        if matches!(up, '0'..='9' | '*' | '#' | 'A'..='D') {
            Ok(Self(up))
        } else {
            Err(DtmfError::InvalidDigit(c.to_string()))
        }
    }

    /// RFC 4733 event code: 0-9, `*`=10, `#`=11, A-D=12-15.
    pub fn event_code(self) -> u8 {
        match self.0 {
            '0'..='9' => (self.0 as u8) - b'0',
            '*' => 10,
            '#' => 11,
            'A'..='D' => 12 + (self.0 as u8 - b'A'),
            _ => unreachable!("validated at parse"),
        }
    }

    pub fn from_event_code(code: u8) -> Option<Self> {
        let c = match code {
            0..=9 => (b'0' + code) as char,
            10 => '*',
            11 => '#',
            12..=15 => (b'A' + (code - 12)) as char,
            _ => return None,
        };
        Some(Self(c))
    }

    pub fn char(self) -> char {
        self.0
    }
}

/// One RFC 4733 event packet payload (4 bytes).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DtmfEvent {
    pub digit: DtmfDigit,
    pub end: bool,
    /// Volume 0-63 per RFC 4733 §2.3 (0 = default/loudest convention).
    pub volume: u8,
    /// Duration in timestamp units (8 kHz clock).
    pub duration: u16,
}

impl DtmfEvent {
    pub fn start(digit: DtmfDigit) -> Self {
        Self {
            digit,
            end: false,
            volume: 10,
            duration: 160,
        }
    }

    pub fn end(digit: DtmfDigit, duration: u16) -> Self {
        Self {
            digit,
            end: true,
            volume: 10,
            duration,
        }
    }

    pub fn encode(self) -> [u8; 4] {
        let volume = self.volume.min(63);
        [
            self.digit.event_code(),
            (u8::from(self.end) << 7) | volume,
            (self.duration >> 8) as u8,
            self.duration as u8,
        ]
    }

    pub fn decode(raw: &[u8]) -> Result<Self, DtmfError> {
        if raw.len() < 4 {
            return Err(DtmfError::Malformed);
        }
        let digit = DtmfDigit::from_event_code(raw[0]).ok_or(DtmfError::Malformed)?;
        Ok(Self {
            digit,
            end: raw[1] & 0x80 != 0,
            volume: raw[1] & 0x3F,
            duration: u16::from_be_bytes([raw[2], raw[3]]),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digit_codes_match_rfc4733_table() {
        assert_eq!(DtmfDigit::parse('0').unwrap().event_code(), 0);
        assert_eq!(DtmfDigit::parse('9').unwrap().event_code(), 9);
        assert_eq!(DtmfDigit::parse('*').unwrap().event_code(), 10);
        assert_eq!(DtmfDigit::parse('#').unwrap().event_code(), 11);
        assert_eq!(DtmfDigit::parse('d').unwrap().event_code(), 15);
        assert!(DtmfDigit::parse('x').is_err());
        assert!(DtmfDigit::parse(' ').is_err());
    }

    #[test]
    fn event_encode_decode_roundtrip() {
        for c in ['1', '5', '*', '#', 'C'] {
            let d = DtmfDigit::parse(c).unwrap();
            for end in [false, true] {
                let ev = DtmfEvent {
                    digit: d,
                    end,
                    volume: 10,
                    duration: DEFAULT_DURATION_TS,
                };
                let back = DtmfEvent::decode(&ev.encode()).unwrap();
                assert_eq!(back, ev);
            }
        }
    }

    #[test]
    fn rejects_short_and_unknown_events() {
        assert_eq!(DtmfEvent::decode(&[1, 2, 3]).unwrap_err(), DtmfError::Malformed);
        assert_eq!(
            DtmfEvent::decode(&[16, 0, 0, 0]).unwrap_err(),
            DtmfError::Malformed
        );
    }
}
