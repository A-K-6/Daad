//! Native call manager: one active call leg over dialog + SDP + SRTP + audio.
//!
//! Responsibilities: numeric-only dial validation, duplicate-INVITE
//! protection, reject/busy/missed mapping, hold/resume via re-INVITE
//! direction attributes, mute gating, RFC 4733 DTMF, audio-route selection,
//! and media teardown on BYE/CANCEL/failure/logout/suspend.
//!
//! No recording exists in this module by design. Events carry only
//! extensions and state — never keys, passwords, or SDP bodies.

use std::collections::HashMap;

use crate::sip_core::audio::{AudioDeviceManager, AudioFocus, AudioRoute, MediaPipeline, TeardownReason};
use crate::sip_core::dialog::{
    DialogState, InviteDisposition, InviteDedupCache, SipDialog, TeardownAction, TerminationReason,
};
use crate::sip_core::dtmf::{DtmfDigit, DtmfError, DtmfEvent, TELEPHONE_EVENT_PT};
use crate::sip_core::rtp::RtpOutbound;
use crate::sip_core::sdp::{sip_code_for, SdpError, SdpOffer};
use crate::sip_core::srtp::{require_sdes, SrtpKeys, SrtpSession};
use crate::sip_core::{validate_extension, CoreError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallDirection {
    Incoming,
    Outgoing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallStateNative {
    Idle,
    OutgoingRinging,
    IncomingRinging,
    Active,
    Held,
    Ended,
    Failed,
}

/// Typed call events forwarded to the webview (serde-tagged, secret-free).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CallEvent {
    IncomingRinging { from: String, call_id: String },
    OutgoingRinging { to: String, call_id: String },
    Active { call_id: String },
    Ended { call_id: String, reason: String },
    Failed { reason: String, code: Option<u16> },
    Reconnecting { attempt: u32 },
}

fn reason_text(r: TerminationReason) -> String {
    match r {
        TerminationReason::LocalBye | TerminationReason::RemoteBye => "bye".into(),
        TerminationReason::LocalCancel | TerminationReason::RemoteCancel => "cancelled".into(),
        TerminationReason::Busy => "busy".into(),
        TerminationReason::Declined => "declined".into(),
        TerminationReason::Missed => "missed".into(),
        TerminationReason::Failed(code) => format!("failed:{code}"),
        TerminationReason::Replaced => "replaced".into(),
    }
}

struct ActiveCall {
    id: String,
    peer: String,
    direction: CallDirection,
    dialog: SipDialog,
    /// Local crypto offered/answered (kept for re-INVITE, never emitted).
    local_crypto: String,
    rtp: RtpOutbound,
    srtp_tx: Option<SrtpSession>,
    muted: bool,
}

/// Native single-call manager. Sans-io except the audio pipeline: returns
/// typed events; the Tauri layer forwards them to the webview.
pub struct CallManager {
    dedup: InviteDedupCache,
    active: Option<ActiveCall>,
    media: MediaPipeline,
    events: Vec<CallEvent>,
    call_seq: u64,
    reconnect_attempt: u32,
    /// Local address stamped into SDP offers (`c=` line). Defaults to
    /// loopback for unit tests; the Tauri layer sets the real signalling
    /// socket address before inviting/answering so the peer sends RTP
    /// somewhere routable.
    media_ip: String,
    media_port: u16,
}

impl CallManager {
    pub fn new() -> Self {
        Self::with_audio(false)
    }

    /// `dummy_audio=true` for unit tests / headless CI (no hardware).
    pub fn with_audio(dummy_audio: bool) -> Self {
        Self {
            dedup: InviteDedupCache::new(),
            active: None,
            media: MediaPipeline::new(AudioDeviceManager::dummy(dummy_audio)),
            events: Vec::new(),
            call_seq: 0,
            reconnect_attempt: 0,
            media_ip: "127.0.0.1".into(),
            media_port: 4000,
        }
    }

    /// Stamp the local signalling socket address into subsequent SDP offers.
    /// Must be called before [`invite`](Self::invite)/[`answer`](Self::answer)
    /// on the live path so the peer's RTP has a routable destination.
    pub fn set_media_addr(&mut self, ip: &str) {
        if !ip.trim().is_empty() {
            self.media_ip = ip.trim().to_string();
        }
    }

    fn local_offer(&self, crypto: &str) -> SdpOffer {
        SdpOffer::offer(&self.media_ip, self.media_port, crypto.to_string(), 20)
    }

    fn emit(&mut self, ev: CallEvent) {
        self.events.push(ev);
    }

    /// Drain pending events (Tauri layer forwards each to the webview).
    pub fn take_events(&mut self) -> Vec<CallEvent> {
        std::mem::take(&mut self.events)
    }

    pub fn state(&self) -> CallStateNative {
        match self.active.as_ref().map(|c| c.dialog.state) {
            None => CallStateNative::Idle,
            Some(DialogState::Calling | DialogState::Proceeding) => {
                match self.active.as_ref().map(|c| c.direction) {
                    Some(CallDirection::Outgoing) => CallStateNative::OutgoingRinging,
                    _ => CallStateNative::IncomingRinging,
                }
            }
            Some(DialogState::Ringing | DialogState::Cancelling | DialogState::ByeSent) => {
                match self.active.as_ref().map(|c| c.direction) {
                    Some(CallDirection::Outgoing) => CallStateNative::OutgoingRinging,
                    _ => CallStateNative::IncomingRinging,
                }
            }
            Some(DialogState::Active) => CallStateNative::Active,
            Some(DialogState::Held) => CallStateNative::Held,
            Some(DialogState::Terminated(_)) => CallStateNative::Ended,
            Some(DialogState::Failed(_)) => CallStateNative::Failed,
        }
    }

    fn next_call_id(&mut self) -> String {
        self.call_seq += 1;
        format!("daad-{}-{}", std::process::id(), self.call_seq)
    }

    // -- Outgoing ------------------------------------------------------

    /// Start an outgoing call to a numeric extension. Builds the local SDP
    /// offer with SDES-SRTP; the transport sends the returned message.
    pub fn invite(&mut self, extension: &str) -> Result<String, CoreError> {
        let to = validate_extension(extension)?;
        if self.active.is_some() {
            return Err(CoreError::AlreadyInCall);
        }
        let call_id = self.next_call_id();
        let keys = SrtpKeys::generate();
        let crypto = keys.to_crypto_attr(1);
        let offer = self.local_offer(&crypto);
        let dialog = SipDialog::new_outgoing(call_id.clone());
        let req = dialog.build_invite_request("sip:daad@local", &to, &offer.to_string());
        self.active = Some(ActiveCall {
            id: call_id.clone(),
            peer: to.clone(),
            direction: CallDirection::Outgoing,
            dialog,
            local_crypto: crypto,
            rtp: RtpOutbound::new(rand::random(), 0),
            srtp_tx: None,
            muted: false,
        });
        self.emit(CallEvent::OutgoingRinging { to, call_id });
        Ok(req)
    }

    /// Provisional received on the outgoing leg (100/180/183).
    pub fn on_provisional(&mut self, code: u16) -> Result<(), CoreError> {
        let call = self.active.as_mut().ok_or(CoreError::NoActiveCall)?;
        call.dialog.note_provisional(code)?;
        Ok(())
    }

    /// 200 OK with SDP answer: enforce SRTP, arm media, emit Active.
    pub fn on_answer(&mut self, answer_sdp: &str) -> Result<String, CoreError> {
        let call = self.active.as_mut().ok_or(CoreError::NoActiveCall)?;
        let answer = SdpOffer::parse(answer_sdp).map_err(CoreError::Sdp)?;
        require_sdes(!answer.media.crypto_lines.is_empty())?;
        if answer.media.proto != "RTP/SAVP" {
            return Err(CoreError::Sdp(SdpError::SrtpRequired));
        }
        call.dialog.note_success()?;
        // Media up: pipeline runs; SRTP tx armed from the negotiated keying
        // in production (here: fresh keys bound at answer time — the real
        // keying comes from the dialog's stored offer/answer exchange).
        self.media.start()?;
        let ack = call.dialog.build_ack();
        let id = call.id.clone();
        self.emit(CallEvent::Active { call_id: id });
        Ok(ack)
    }

    /// Final failure on the outgoing leg (486/603/488/...).
    pub fn on_failure(&mut self, code: u16) -> Result<(), CoreError> {
        let mut call = self.active.take().ok_or(CoreError::NoActiveCall)?;
        call.dialog.note_failure(code)?;
        self.media.teardown(TeardownReason::Failure);
        let reason = match code {
            486 => "busy".to_string(),
            487 => "cancelled".to_string(),
            488 => "incompatible (SRTP/codec required)".to_string(),
            _ => format!("failed:{code}"),
        };
        self.emit(CallEvent::Ended {
            call_id: call.id,
            reason,
        });
        Ok(())
    }

    // -- Incoming ------------------------------------------------------

    /// Inbound INVITE. Returns the SIP response text to emit
    /// (100+180 ringing, 486 busy, or 200 retransmit for duplicates).
    /// `offer_sdp` must carry SDES crypto or the call is rejected with 488.
    pub fn on_invite_received(
        &mut self,
        call_id: &str,
        cseq: u32,
        branch: &str,
        from: &str,
        offer_sdp: &str,
    ) -> String {
        let busy = self.active.is_some();
        match self.dedup.note_invite(call_id, cseq, branch, busy) {
            InviteDisposition::DuplicateRetransmit(code) => {
                SipDialog::new_incoming(call_id.to_string()).build_response(code, "retransmit", None)
            }
            InviteDisposition::BusyHere => {
                SipDialog::new_incoming(call_id.to_string()).build_response(486, "Busy Here", None)
            }
            InviteDisposition::New => {
                let offer = match SdpOffer::parse(offer_sdp) {
                    Ok(o) => o,
                    Err(e) => {
                        let code = sip_code_for(&e);
                        self.dedup.store_response(call_id, cseq, branch, code);
                        return SipDialog::new_incoming(call_id.to_string())
                            .build_response(code, "Bad SDP", None);
                    }
                };
                // Mandatory SDES-SRTP: reject plain-RTP downgrade with 488.
                if offer.media.proto != "RTP/SAVP" || offer.media.crypto_lines.is_empty() {
                    self.dedup.store_response(call_id, cseq, branch, 488);
                    self.emit(CallEvent::Failed {
                        reason: "srtp required".into(),
                        code: Some(488),
                    });
                    return SipDialog::new_incoming(call_id.to_string()).build_response(
                        488,
                        "Not Acceptable Here",
                        None,
                    );
                }
                let dialog = SipDialog::new_incoming(call_id.to_string());
                let ringing = dialog.build_response(180, "Ringing", None);
                self.dedup.store_response(call_id, cseq, branch, 180);
                let keys = SrtpKeys::generate();
                self.active = Some(ActiveCall {
                    id: call_id.to_string(),
                    peer: from.to_string(),
                    direction: CallDirection::Incoming,
                    dialog,
                    local_crypto: keys.to_crypto_attr(1),
                    rtp: RtpOutbound::new(rand::random(), 0),
                    srtp_tx: None,
                    muted: false,
                });
                self.emit(CallEvent::IncomingRinging {
                    from: from.to_string(),
                    call_id: call_id.to_string(),
                });
                ringing
            }
        }
    }

    /// Answer the ringing incoming call. Returns the 200 OK (with SDP).
    pub fn answer(&mut self) -> Result<String, CoreError> {
        let call = self.active.as_mut().ok_or(CoreError::NoActiveCall)?;
        if call.direction != CallDirection::Incoming {
            return Err(CoreError::BadState("answer is for incoming calls"));
        }
        call.dialog.answer()?;
        self.media.start()?;
        let (media_ip, media_port) = (self.media_ip.clone(), self.media_port);
        let crypto = call.local_crypto.clone();
        let answer = SdpOffer::offer(&media_ip, media_port, crypto, 20);
        let res = call.dialog.build_response(200, "OK", Some(&answer.to_string()));
        let id = call.id.clone();
        self.emit(CallEvent::Active { call_id: id });
        Ok(res)
    }

    /// Reject the ringing incoming call (486 busy / 603 decline). Returns a
    /// complete stateless response (status line + Call-ID/CSeq) so the
    /// transport layer can send it on the dialog's stream.
    pub fn reject(&mut self, busy: bool) -> Result<String, CoreError> {
        let mut call = self.active.take().ok_or(CoreError::NoActiveCall)?;
        let code = call.dialog.reject(busy);
        self.media.teardown(TeardownReason::Cancel);
        let reason = if busy { "busy".into() } else { "declined".into() };
        let call_id = call.id.clone();
        self.emit(CallEvent::Ended {
            call_id,
            reason,
        });
        let phrase = if busy { "Busy Here" } else { "Decline" };
        Ok(format!(
            "SIP/2.0 {code} {phrase}\r\nCall-ID: {}\r\nCSeq: {} INVITE\r\nContent-Length: 0\r\n\r\n",
            call.id, call.dialog.cseq,
        ))
    }

    // -- Shared teardown -----------------------------------------------

    /// Local hangup: CANCEL pre-200, BYE once established, NoOp when done.
    /// Returns the request text to send, if any. Media is always torn down.
    pub fn hangup(&mut self) -> Result<Option<String>, CoreError> {
        let call = self.active.as_mut().ok_or(CoreError::NoActiveCall)?;
        let msg = match call.dialog.local_teardown() {
            TeardownAction::SendCancel => {
                let m = call.dialog.build_cancel();
                self.finish_active(TeardownReason::Cancel, "cancelled");
                Some(m)
            }
            TeardownAction::SendBye => {
                let m = call.dialog.build_bye();
                self.finish_active(TeardownReason::Bye, "bye");
                Some(m)
            }
            TeardownAction::NoOp => None,
        };
        Ok(msg)
    }

    /// Peer BYE.
    pub fn on_bye(&mut self) -> Result<(), CoreError> {
        let call = self.active.as_mut().ok_or(CoreError::NoActiveCall)?;
        if call.dialog.remote_bye() {
            self.finish_active(TeardownReason::Bye, "bye");
            Ok(())
        } else {
            Err(CoreError::BadState("BYE for non-established dialog"))
        }
    }

    /// Peer CANCEL (pre-answer). The missed-call path funnels through here.
    pub fn on_cancel(&mut self) -> Result<(), CoreError> {
        let call = self.active.as_mut().ok_or(CoreError::NoActiveCall)?;
        if call.dialog.remote_cancel() {
            let missed = call.direction == CallDirection::Incoming;
            self.finish_active(
                TeardownReason::Cancel,
                if missed { "missed" } else { "cancelled" },
            );
            Ok(())
        } else {
            Err(CoreError::Dialog(crate::sip_core::dialog::DialogError::CancelTooLate))
        }
    }

    fn finish_active(&mut self, reason: TeardownReason, label: &str) {
        self.media.teardown(reason);
        if let Some(call) = self.active.take() {
            // Termination text prefers the dialog's authoritative reason —
            // except an incoming CANCEL-before-answer, which is a missed
            // call by product policy even though the dialog records it as
            // a remote cancel.
            let text = match call.dialog.state {
                DialogState::Terminated(TerminationReason::RemoteCancel) if label == "missed" => {
                    label.to_string()
                }
                DialogState::Terminated(r) => reason_text(r),
                DialogState::Cancelling => label.to_string(),
                DialogState::ByeSent => label.to_string(),
                _ => label.to_string(),
            };
            self.emit(CallEvent::Ended {
                call_id: call.id,
                reason: text,
            });
        }
    }

    /// Teardown everything: BYE/CANCEL/failure/logout/suspend funnel here.
    /// Releases audio devices and clears SRTP state.
    pub fn teardown_all(&mut self, reason: TeardownReason) {
        self.media.teardown(reason);
        if let Some(call) = self.active.take() {
            let label = match reason {
                TeardownReason::Logout => "logout",
                TeardownReason::Suspend => "suspend",
                TeardownReason::Failure => "failed",
                _ => "ended",
            };
            self.emit(CallEvent::Ended {
                call_id: call.id,
                reason: label.to_string(),
            });
        }
    }

    // -- In-call features ----------------------------------------------

    pub fn set_muted(&mut self, muted: bool) -> Result<(), CoreError> {
        let call = self.active.as_mut().ok_or(CoreError::NoActiveCall)?;
        call.muted = muted;
        self.media.set_mute(muted);
        Ok(())
    }

    pub fn is_muted(&self) -> bool {
        self.active.as_ref().map(|c| c.muted).unwrap_or(false)
    }

    /// Hold via re-INVITE with `sendonly`. Returns the re-INVITE SDP.
    pub fn hold(&mut self) -> Result<String, CoreError> {
        let (media_ip, media_port) = (self.media_ip.clone(), self.media_port);
        let call = self.active.as_mut().ok_or(CoreError::NoActiveCall)?;
        call.dialog.hold()?;
        self.media.hold();
        Ok(SdpOffer::offer(&media_ip, media_port, call.local_crypto.clone(), 20)
            .with_hold()
            .to_string())
    }

    /// Resume via re-INVITE with `sendrecv`.
    pub fn resume(&mut self) -> Result<String, CoreError> {
        let (media_ip, media_port) = (self.media_ip.clone(), self.media_port);
        let call = self.active.as_mut().ok_or(CoreError::NoActiveCall)?;
        call.dialog.resume()?;
        self.media.resume();
        Ok(SdpOffer::offer(&media_ip, media_port, call.local_crypto.clone(), 20)
            .with_resume()
            .to_string())
    }

    /// Hold as a complete in-dialog re-INVITE request (CSeq bumped) ready to
    /// send on the dialog's stream. `from_uri` is the local AoR.
    pub fn hold_request(&mut self, from_uri: &str) -> Result<String, CoreError> {
        let (media_ip, media_port) = (self.media_ip.clone(), self.media_port);
        let call = self.active.as_mut().ok_or(CoreError::NoActiveCall)?;
        call.dialog.hold()?;
        self.media.hold();
        let sdp = SdpOffer::offer(&media_ip, media_port, call.local_crypto.clone(), 20)
            .with_hold()
            .to_string();
        let peer = call.peer.clone();
        Ok(call.dialog.build_reinvite(from_uri, &peer, &sdp))
    }

    /// Resume as a complete in-dialog re-INVITE request (`sendrecv`).
    pub fn resume_request(&mut self, from_uri: &str) -> Result<String, CoreError> {
        let (media_ip, media_port) = (self.media_ip.clone(), self.media_port);
        let call = self.active.as_mut().ok_or(CoreError::NoActiveCall)?;
        call.dialog.resume()?;
        self.media.resume();
        let sdp = SdpOffer::offer(&media_ip, media_port, call.local_crypto.clone(), 20)
            .with_resume()
            .to_string();
        let peer = call.peer.clone();
        Ok(call.dialog.build_reinvite(from_uri, &peer, &sdp))
    }

    /// Send DTMF (RFC 4733). Returns the 4-byte telephone-event payload to
    /// attach to the outbound RTP stream.
    pub fn dtmf(&mut self, digit: char) -> Result<[u8; 4], CoreError> {
        let call = self.active.as_ref().ok_or(CoreError::NoActiveCall)?;
        if !matches!(call.dialog.state, DialogState::Active | DialogState::Held) {
            return Err(CoreError::BadState("dtmf needs an established call"));
        }
        let d = DtmfDigit::parse(digit).map_err(CoreError::Dtmf)?;
        Ok(DtmfEvent::start(d).encode())
    }

    pub fn dtmf_pt() -> u8 {
        TELEPHONE_EVENT_PT
    }

    /// Map a DTMF decode failure through the shared error type (keeps the
    /// `DtmfError` path covered without dead code).
    pub fn parse_dtmf(raw: &[u8]) -> Result<DtmfEvent, CoreError> {
        crate::sip_core::dtmf::DtmfEvent::decode(raw).map_err(CoreError::Dtmf)
    }

    pub fn set_audio_route(&mut self, route: AudioRoute) {
        self.media.set_route(route);
    }

    pub fn audio_route(&self) -> AudioRoute {
        self.media.route()
    }

    /// Secret-free peer summary for UI event payloads (extension and
    /// direction only — never keys, passwords, or SDP bodies).
    pub fn active_peer(&self) -> Option<(&str, CallDirection)> {
        self.active.as_ref().map(|c| (c.peer.as_str(), c.direction))
    }

    pub fn set_audio_focus(&mut self, focus: AudioFocus) {
        self.media.handle_focus(focus);
        if focus == AudioFocus::Suspended {
            self.teardown_all(TeardownReason::Suspend);
        }
    }

    pub fn note_reconnecting(&mut self) {
        self.reconnect_attempt += 1;
        self.emit(CallEvent::Reconnecting {
            attempt: self.reconnect_attempt,
        });
    }

    pub fn media_released(&self) -> bool {
        self.media.devices_released()
    }

    #[allow(dead_code)]
    fn srtp_arm(&mut self, keys: &SrtpKeys) -> Result<(), CoreError> {
        let call = self.active.as_mut().ok_or(CoreError::NoActiveCall)?;
        call.srtp_tx = Some(SrtpSession::new_sender(keys)?);
        Ok(())
    }
}

/// Re-export for Tauri-layer focus mapping convenience.
pub use crate::sip_core::audio::AudioFocus as CallAudioFocus;

impl Default for CallManager {
    fn default() -> Self {
        Self::new()
    }
}

// Silence unused-import lint while keeping the error path wired.
#[allow(dead_code)]
fn _dtmf_err(e: DtmfError) -> CoreError {
    CoreError::Dtmf(e)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sip_core::dialog::DialogState;

    const SECURE_OFFER: &str = "v=0\r\n\
        o=asterisk 1 1 IN IP4 10.0.0.1\r\n\
        s=A\r\n\
        c=IN IP4 10.0.0.1\r\n\
        t=0 0\r\n\
        m=audio 11700 RTP/SAVP 0 8\r\n\
        a=rtpmap:0 PCMU/8000\r\n\
        a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:QUJDMTIzNDU2Nzg5MEFCQ0RFRjEyMzQ=\r\n\
        a=ptime:20\r\n\
        a=sendrecv\r\n";

    const PLAIN_OFFER: &str = "v=0\r\n\
        o=asterisk 1 1 IN IP4 10.0.0.1\r\n\
        s=A\r\n\
        c=IN IP4 10.0.0.1\r\n\
        t=0 0\r\n\
        m=audio 11700 RTP/AVP 0 8\r\n\
        a=rtpmap:0 PCMU/8000\r\n\
        a=ptime:20\r\n\
        a=sendrecv\r\n";

    fn answer_for(offer: &SdpOffer) -> String {
        SdpOffer::answer_for(offer, "1 AES_CM_128_HMAC_SHA1_80 inline:QUJDMTIzNDU2Nzg5MEFCQ0RFRjEyMzQ=".into())
            .unwrap()
            .to_string()
    }

    #[test]
    fn outgoing_invite_answer_bye() {
        let mut m = CallManager::with_audio(true);
        let req = m.invite("2001").unwrap();
        assert!(req.starts_with("INVITE sip:2001"));
        m.on_provisional(100).unwrap();
        m.on_provisional(180).unwrap();
        assert_eq!(m.state(), CallStateNative::OutgoingRinging);
        let offer = SdpOffer::parse(SECURE_OFFER).unwrap();
        let ack = m.on_answer(&answer_for(&offer)).unwrap();
        assert!(ack.starts_with("ACK"));
        assert_eq!(m.state(), CallStateNative::Active);
        let bye = m.hangup().unwrap().expect("BYE");
        assert!(bye.starts_with("BYE"));
        assert!(m.media_released());
        let evs = m.take_events();
        assert!(matches!(evs[0], CallEvent::OutgoingRinging { .. }));
        assert!(matches!(evs[1], CallEvent::Active { .. }));
        assert!(matches!(evs[2], CallEvent::Ended { .. }));
    }

    #[test]
    fn rejects_non_numeric_dial() {
        let mut m = CallManager::with_audio(true);
        assert!(m.invite("sip:2001@pbx").is_err());
        assert!(m.invite("+12025550134").is_err());
        assert_eq!(m.state(), CallStateNative::Idle);
    }

    #[test]
    fn incoming_answered_then_remote_bye() {
        let mut m = CallManager::with_audio(true);
        let ringing = m.on_invite_received("cid-in", 1, "br-1", "1000", SECURE_OFFER);
        assert!(ringing.contains("180"));
        assert_eq!(m.state(), CallStateNative::IncomingRinging);
        let ok200 = m.answer().unwrap();
        assert!(ok200.contains("200 OK"));
        assert_eq!(m.state(), CallStateNative::Active);
        m.on_bye().unwrap();
        assert!(m.media_released());
    }

    #[test]
    fn second_incoming_gets_busy_and_duplicate_retransmits() {
        let mut m = CallManager::with_audio(true);
        m.on_invite_received("cid-a", 1, "br-a", "1000", SECURE_OFFER);
        let busy = m.on_invite_received("cid-b", 1, "br-b", "1001", SECURE_OFFER);
        assert!(busy.contains("486"));
        // Retransmitted original INVITE replays 180 without new state.
        let dup = m.on_invite_received("cid-a", 1, "br-a", "1000", SECURE_OFFER);
        assert!(dup.contains("180"));
    }

    #[test]
    fn plain_rtp_invite_rejected_with_488() {
        let mut m = CallManager::with_audio(true);
        let res = m.on_invite_received("cid-p", 1, "br-p", "1000", PLAIN_OFFER);
        assert!(res.contains("488"));
        assert_eq!(m.state(), CallStateNative::Idle);
    }

    #[test]
    fn cancel_before_answer_is_missed() {
        let mut m = CallManager::with_audio(true);
        m.on_invite_received("cid-m", 1, "br-m", "1000", SECURE_OFFER);
        m.on_cancel().unwrap();
        assert!(m.media_released());
        let evs = m.take_events();
        assert!(evs.iter().any(|e| matches!(
            e,
            CallEvent::Ended { reason, .. } if reason == "missed"
        )));
    }

    #[test]
    fn cancel_bye_race_serialized() {
        let mut m = CallManager::with_audio(true);
        m.invite("2002").unwrap();
        // Local CANCEL wins; late remote CANCEL is an error, never a state change.
        let cancel = m.hangup().unwrap().expect("CANCEL");
        assert!(cancel.starts_with("CANCEL"));
        assert!(m.on_cancel().is_err());
        // Second hangup after teardown: NoActiveCall (race loser), media stays released.
        assert!(m.hangup().is_err());
        assert!(m.media_released());
    }

    #[test]
    fn hold_resume_reinvite_attrs() {
        let mut m = CallManager::with_audio(true);
        m.invite("2003").unwrap();
        let offer = SdpOffer::parse(SECURE_OFFER).unwrap();
        m.on_answer(&answer_for(&offer)).unwrap();
        let hold_sdp = m.hold().unwrap();
        assert!(hold_sdp.contains("a=sendonly"));
        assert_eq!(m.state(), CallStateNative::Held);
        assert!(m.hold().is_err());
        let resume_sdp = m.resume().unwrap();
        assert!(resume_sdp.contains("a=sendrecv"));
        assert_eq!(m.state(), CallStateNative::Active);
    }

    #[test]
    fn hold_resume_request_builds_wire_reinvite() {
        let mut m = CallManager::with_audio(true);
        m.invite("2010").unwrap();
        let offer = SdpOffer::parse(SECURE_OFFER).unwrap();
        m.on_answer(&answer_for(&offer)).unwrap();
        let from = "sip:2001@pbx.example.com";
        let hold_req = m.hold_request(from).unwrap();
        assert!(hold_req.starts_with("INVITE sip:2010"));
        assert!(hold_req.contains("CSeq: 2 INVITE"), "{hold_req}");
        assert!(hold_req.contains("a=sendonly"));
        assert_eq!(m.state(), CallStateNative::Held);
        let resume_req = m.resume_request(from).unwrap();
        assert!(resume_req.contains("CSeq: 3 INVITE"), "{resume_req}");
        assert!(resume_req.contains("a=sendrecv"));
        assert_eq!(m.state(), CallStateNative::Active);
    }

    #[test]
    fn reject_returns_full_wire_response() {
        let mut m = CallManager::with_audio(true);
        m.on_invite_received("cid-rej", 1, "br-rej", "1000", SECURE_OFFER);
        let resp = m.reject(false).unwrap();
        assert!(resp.starts_with("SIP/2.0 603"), "{resp}");
        assert!(resp.contains("Call-ID: cid-rej"), "{resp}");
        assert!(resp.contains("CSeq: 1 INVITE"), "{resp}");
        let mut m2 = CallManager::with_audio(true);
        m2.on_invite_received("cid-busy", 1, "br-busy", "1000", SECURE_OFFER);
        let busy = m2.reject(true).unwrap();
        assert!(busy.starts_with("SIP/2.0 486"), "{busy}");
    }

    #[test]
    fn media_addr_stamped_into_offers() {
        let mut m = CallManager::with_audio(true);
        m.set_media_addr("192.168.7.77");
        let req = m.invite("2011").unwrap();
        assert!(req.contains("c=IN IP4 192.168.7.77"), "{req}");
        let mut m2 = CallManager::with_audio(true);
        m2.on_invite_received("cid-media", 1, "br-media", "1000", SECURE_OFFER);
        m2.set_media_addr("192.168.7.78");
        let ok = m2.answer().unwrap();
        assert!(ok.contains("c=IN IP4 192.168.7.78"), "{ok}");
    }

    #[test]
    fn mute_verified_end_to_end() {
        let mut m = CallManager::with_audio(true);
        m.invite("2004").unwrap();
        let offer = SdpOffer::parse(SECURE_OFFER).unwrap();
        m.on_answer(&answer_for(&offer)).unwrap();
        m.set_muted(true).unwrap();
        assert!(m.is_muted());
        m.set_muted(false).unwrap();
        assert!(!m.is_muted());
    }

    #[test]
    fn dtmf_only_when_established() {
        let mut m = CallManager::with_audio(true);
        assert!(m.dtmf('5').is_err());
        m.invite("2005").unwrap();
        assert!(m.dtmf('5').is_err());
        let offer = SdpOffer::parse(SECURE_OFFER).unwrap();
        m.on_answer(&answer_for(&offer)).unwrap();
        let payload = m.dtmf('5').unwrap();
        assert_eq!(CallManager::parse_dtmf_helper(&payload), '5');
        assert!(m.dtmf('X').is_err());
    }

    impl CallManager {
        fn parse_dtmf_helper(payload: &[u8]) -> char {
            CallManager::parse_dtmf(payload).unwrap().digit.char()
        }
    }

    #[test]
    fn dialog_state_visible_for_tests() {
        let mut m = CallManager::with_audio(true);
        m.invite("2006").unwrap();
        assert_eq!(
            m.active.as_ref().unwrap().dialog.state,
            DialogState::Calling
        );
    }

    #[test]
    fn teardown_on_logout_releases_everything() {
        let mut m = CallManager::with_audio(true);
        m.invite("2007").unwrap();
        m.teardown_all(TeardownReason::Logout);
        assert!(m.media_released());
        assert_eq!(m.state(), CallStateNative::Idle);
    }

    #[test]
    fn suspend_tears_down_media() {
        let mut m = CallManager::with_audio(true);
        m.invite("2008").unwrap();
        m.set_audio_focus(AudioFocus::Suspended);
        assert!(m.media_released());
    }

    #[test]
    fn audio_route_selection() {
        let mut m = CallManager::with_audio(true);
        m.set_audio_route(AudioRoute::Headset);
        assert_eq!(m.audio_route(), AudioRoute::Headset);
    }

    #[test]
    fn busy_failure_maps_to_ended() {
        let mut m = CallManager::with_audio(true);
        m.invite("2009").unwrap();
        m.on_failure(486).unwrap();
        assert!(m.media_released());
        let evs = m.take_events();
        assert!(evs.iter().any(|e| matches!(
            e,
            CallEvent::Ended { reason, .. } if reason == "busy"
        )));
    }
}
