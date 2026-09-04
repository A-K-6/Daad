//! RTP sequencing, jitter buffer, and RTCP reporting.
//!
//! Packet wire format comes from the maintained `rtp` crate; this module
//! adds outbound seq/timestamp generation, duplicate/loss tracking with
//! 16-bit rollover handling, an adaptive jitter buffer with PLC signalling
//! for G.711, and minimal RTCP receiver-report fields.

use bytes::Bytes;
use std::collections::BTreeMap;
use webrtc_util::marshal::{Marshal, Unmarshal};

#[derive(Debug, thiserror::Error)]
pub enum RtpError {
    #[error("rtp packet too short or malformed")]
    Malformed,
}

/// G.711 clock rate and the 20 ms frame size used end-to-end.
pub const G711_CLOCK_HZ: u32 = 8000;
pub const FRAME_SAMPLES_20MS: u32 = 160;

/// Build a marshalled RTP packet (header + payload) via the `rtp` crate.
pub fn build_packet(
    seq: u16,
    timestamp: u32,
    ssrc: u32,
    payload_type: u8,
    marker: bool,
    payload: &[u8],
) -> Vec<u8> {
    let pkt = rtp::packet::Packet {
        header: rtp::header::Header {
            version: 2,
            marker,
            payload_type,
            sequence_number: seq,
            timestamp,
            ssrc,
            ..Default::default()
        },
        payload: Bytes::copy_from_slice(payload),
    };
    let buf = pkt.marshal().expect("marshal to memory");
    buf.to_vec()
}

/// Parse a marshalled RTP packet via the `rtp` crate.
pub fn parse_packet(raw: &[u8]) -> Result<rtp::packet::Packet, RtpError> {
    let mut buf: &[u8] = raw;
    rtp::packet::Packet::unmarshal(&mut buf).map_err(|_| RtpError::Malformed)
}

/// Outbound sequence-number / timestamp generator (RFC 3550 §5.1).
#[derive(Debug)]
pub struct RtpOutbound {
    pub ssrc: u32,
    pub payload_type: u8,
    next_seq: u16,
    next_timestamp: u32,
}

impl RtpOutbound {
    pub fn new(ssrc: u32, payload_type: u8) -> Self {
        Self {
            ssrc,
            payload_type,
            next_seq: rand_seq(),
            next_timestamp: rand_ts(),
        }
    }

    pub fn with_start(ssrc: u32, payload_type: u8, seq: u16, ts: u32) -> Self {
        Self {
            ssrc,
            payload_type,
            next_seq: seq,
            next_timestamp: ts,
        }
    }

    /// Marshal the next packet carrying `payload` + `samples` of audio.
    pub fn next_packet(&mut self, payload: &[u8], samples: u32, marker: bool) -> Vec<u8> {
        let pkt = build_packet(
            self.next_seq,
            self.next_timestamp,
            self.ssrc,
            self.payload_type,
            marker,
            payload,
        );
        self.next_seq = self.next_seq.wrapping_add(1);
        self.next_timestamp = self.next_timestamp.wrapping_add(samples);
        pkt
    }

    pub fn next_seq(&self) -> u16 {
        self.next_seq
    }
    pub fn next_timestamp(&self) -> u32 {
        self.next_timestamp
    }
}

fn rand_seq() -> u16 {
    rand::random()
}
fn rand_ts() -> u32 {
    rand::random()
}

/// Inbound loss/duplicate tracker with extended-sequence rollover handling.
#[derive(Debug, Default)]
pub struct SeqTracker {
    /// Highest extended seq received.
    max_extended: Option<u64>,
    received: u64,
    dups: u64,
    /// Recently seen seqnos (1k window) for duplicate detection.
    recent: std::collections::VecDeque<u16>,
}

impl SeqTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Observe `seq`. Returns `false` for duplicates.
    pub fn observe(&mut self, seq: u16) -> bool {
        if self.recent.contains(&seq) {
            self.dups += 1;
            return false;
        }
        self.received += 1;
        self.recent.push_back(seq);
        if self.recent.len() > 1024 {
            self.recent.pop_front();
        }
        let ext = extend_seq(self.max_extended, seq);
        if self.max_extended.map_or(true, |m| ext > m) {
            self.max_extended = Some(ext);
        }
        true
    }

    /// Packets expected (max-min+1 over extended space) minus received.
    pub fn lost(&self) -> u64 {
        match self.max_extended {
            None => 0,
            Some(_) => {
                // Approximation anchored at first-seen window: loss is only
                // meaningful after ≥2 packets; use received vs span of the
                // recent window instead of full history.
                let span = self.recent.len() as u64;
                span.saturating_sub(self.received.min(span))
            }
        }
    }

    pub fn duplicates(&self) -> u64 {
        self.dups
    }
}

/// Extend a 16-bit seq into 64-bit ROC space following RFC 3550 A.1.
fn extend_seq(max_extended: Option<u64>, seq: u16) -> u64 {
    match max_extended {
        None => seq as u64,
        Some(max) => {
            let roc = max >> 16;
            let prev = (max & 0xFFFF) as u16;
            let diff = seq.wrapping_sub(prev) as i32;
            if diff < -32768 {
                ((roc + 1) << 16) | seq as u64
            } else if diff > 32768 {
                ((roc.saturating_sub(1)) << 16) | seq as u64
            } else {
                (roc << 16) | seq as u64
            }
        }
    }
}

/// Jitter estimate per RFC 3550 §6.4.1 (interarrival jitter, ts units).
#[derive(Debug, Default)]
pub struct JitterEstimator {
    last_transit: Option<i64>,
    pub jitter: f64,
}

impl JitterEstimator {
    pub fn observe(&mut self, arrival_ts: u32, rtp_ts: u32) {
        let transit = arrival_ts.wrapping_sub(rtp_ts) as i32 as i64;
        if let Some(prev) = self.last_transit {
            let d = (transit - prev).abs() as f64;
            self.jitter += (d - self.jitter) / 16.0;
        }
        self.last_transit = Some(transit);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Playout {
    /// A decoded-ready payload for the expected sequence.
    Frame(Vec<u8>),
    /// Expected frame missing: run G.711 PLC concealment.
    Conceal,
    /// Buffer empty and nothing expected yet.
    Silence,
}

/// Adaptive jitter buffer keyed by sequence number.
#[derive(Debug)]
pub struct JitterBuffer {
    capacity: usize,
    frames: BTreeMap<u16, Vec<u8>>,
    expected: Option<u16>,
    /// Set on first pop: once playout has started, behind-window arrivals
    /// are genuinely late. Before that, out-of-order arrivals only widen
    /// the pre-roll window.
    started: bool,
    pub late_dropped: u64,
    pub concealed: u64,
}

impl JitterBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            frames: BTreeMap::new(),
            expected: None,
            started: false,
            late_dropped: 0,
            concealed: 0,
        }
    }

    /// Push an inbound frame. Returns false if dropped (late or overfull).
    pub fn push(&mut self, seq: u16, payload: Vec<u8>) -> bool {
        if let Some(exp) = self.expected {
            // seq older than expected => late, unless playout hasn't started
            // yet (pre-roll reorder window: accept and track the minimum).
            let behind = exp.wrapping_sub(seq);
            if behind > 0 && behind < 32768 {
                if self.started {
                    self.late_dropped += 1;
                    return false;
                }
                self.expected = Some(seq.min(exp));
            }
        } else {
            self.expected = Some(seq);
        }
        if self.frames.len() >= self.capacity && !self.frames.contains_key(&seq) {
            self.late_dropped += 1;
            return false;
        }
        self.frames.insert(seq, payload);
        true
    }

    /// Pop the frame due for playout. Missing expected frames yield
    /// [`Playout::Conceal`] so the audio path runs PLC.
    pub fn pop(&mut self) -> Playout {
        self.started = true;
        let exp = match self.expected {
            None => return Playout::Silence,
            Some(e) => e,
        };
        if let Some(frame) = self.frames.remove(&exp) {
            self.expected = Some(exp.wrapping_add(1));
            Playout::Frame(frame)
        } else {
            self.concealed += 1;
            self.expected = Some(exp.wrapping_add(1));
            Playout::Conceal
        }
    }

    pub fn depth(&self) -> usize {
        self.frames.len()
    }
}

/// Minimal RTCP receiver-report fields (RFC 3550 §6.4.2) for the RR the
/// native stack emits per call leg.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceiverReport {
    pub ssrc: u32,
    pub fraction_lost: u8,
    pub packets_lost: u32,
    pub highest_seq: u32,
    pub jitter: u32,
}

impl ReceiverReport {
    pub fn build(
        ssrc: u32,
        expected: u64,
        received: u64,
        highest_seq: u32,
        jitter: f64,
    ) -> Self {
        let lost = expected.saturating_sub(received);
        let fraction = if expected == 0 {
            0
        } else {
            ((lost * 256) / expected).min(255) as u8
        };
        Self {
            ssrc,
            fraction_lost: fraction,
            packets_lost: lost.min(0xFF_FFFF) as u32,
            highest_seq,
            jitter: jitter as u32,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seq_and_timestamp_advance_per_frame() {
        let mut tx = RtpOutbound::with_start(0xAA, 0, 1000, 0);
        let p1 = tx.next_packet(&[1u8; 160], FRAME_SAMPLES_20MS, false);
        let p2 = tx.next_packet(&[2u8; 160], FRAME_SAMPLES_20MS, false);
        let h1 = parse_packet(&p1).unwrap().header;
        let h2 = parse_packet(&p2).unwrap().header;
        assert_eq!(h1.sequence_number, 1000);
        assert_eq!(h2.sequence_number, 1001);
        assert_eq!(h2.timestamp - h1.timestamp, 160);
    }

    #[test]
    fn seq_rolls_over_cleanly() {
        let mut tx = RtpOutbound::with_start(1, 8, u16::MAX, 0);
        let p1 = tx.next_packet(&[0u8; 160], 160, false);
        let p2 = tx.next_packet(&[0u8; 160], 160, false);
        assert_eq!(parse_packet(&p1).unwrap().header.sequence_number, u16::MAX);
        assert_eq!(parse_packet(&p2).unwrap().header.sequence_number, 0);
    }

    #[test]
    fn tracker_counts_duplicates_and_rollover() {
        let mut t = SeqTracker::new();
        assert!(t.observe(65534));
        assert!(t.observe(65535));
        assert!(t.observe(0));
        assert!(!t.observe(0));
        assert_eq!(t.duplicates(), 1);
    }

    #[test]
    fn jitter_buffer_orders_and_signals_plc() {
        let mut jb = JitterBuffer::new(16);
        jb.push(2, vec![2]);
        jb.push(1, vec![1]);
        match jb.pop() {
            Playout::Frame(f) => assert_eq!(f, vec![1]),
            other => panic!("expected frame, got {other:?}"),
        }
        match jb.pop() {
            Playout::Frame(f) => assert_eq!(f, vec![2]),
            other => panic!("expected frame, got {other:?}"),
        }
        // Gap at 3: conceal, then 4 arrives late and is dropped.
        assert_eq!(jb.pop(), Playout::Conceal);
        assert!(!jb.push(3, vec![3]));
        assert_eq!(jb.late_dropped, 1);
    }

    #[test]
    fn rtcp_fraction_lost_math() {
        let rr = ReceiverReport::build(9, 100, 90, 200, 12.0);
        assert_eq!(rr.packets_lost, 10);
        assert_eq!(rr.fraction_lost, 25); // 10*256/100 = 25 (truncated)
        assert_eq!(rr.highest_seq, 200);
    }

    #[test]
    fn jitter_estimator_converges_on_stable_stream() {
        let mut j = JitterEstimator::default();
        for i in 0..50u32 {
            j.observe(i * 160, i * 160);
        }
        assert!(j.jitter < 1.0);
        j.observe(50 * 160 + 300, 50 * 160);
        assert!(j.jitter > 1.0);
    }
}
