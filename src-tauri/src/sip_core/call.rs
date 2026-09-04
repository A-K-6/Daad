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
    TransferProgress,
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
    /// Second inbound INVITE while a leg is up (max two dialogs): parked as
    /// the waiting leg, never auto-answered. The UI answers via
    /// `answer_waiting` (hold active + answer waiting) or swaps explicitly.
    CallWaiting { from: String, call_id: String },
    /// Media focus moved between the two legs (swap / answer-waiting /
    /// consult-answer). Exactly one leg owns the single RTP stream.
    Swapped { active_call_id: String },
    /// A peer asked us to transfer this leg (inbound REFER). Answered 202;
    /// the actual transfer-out is driven by the peer/PBX.
    TransferRequested { call_id: String, refer_to: String },
    /// Our REFER was finally rejected at the target (NOTIFY sipfrag 3xx–6xx
    /// or non-202 to REFER): our leg stays up, media untouched.
    TransferFailed { call_id: String, code: u16 },
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
        TerminationReason::Transferred => "transferred".into(),
    }
}

/// Map one leg slot to the product call state (shared by `state()` and
/// `leg_state()` so single-leg behaviour never drifts from two-leg).
fn dialog_state_of(leg: Option<&ActiveCall>) -> CallStateNative {
    match leg.map(|c| c.dialog.state) {
        None => CallStateNative::Idle,
        Some(DialogState::Calling | DialogState::Proceeding) => {
            match leg.map(|c| c.direction) {
                Some(CallDirection::Outgoing) => CallStateNative::OutgoingRinging,
                _ => CallStateNative::IncomingRinging,
            }
        }
        Some(DialogState::Ringing | DialogState::Cancelling | DialogState::ByeSent) => {
            match leg.map(|c| c.direction) {
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

/// Which of the at-most-two dialogs an operation targets. `Primary` is the
/// first leg (all single-call behaviour is primary behaviour); `Second` is
/// the waiting incoming leg or the outgoing consultation leg.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WhichLeg {
    Primary,
    Second,
}

impl WhichLeg {
    /// The other dialog slot.
    pub fn other(self) -> Self {
        match self {
            WhichLeg::Primary => WhichLeg::Second,
            WhichLeg::Second => WhichLeg::Primary,
        }
    }
}

/// In-flight transfer (RFC 3515 REFER + NOTIFY sipfrag outcome).
#[derive(Debug, Clone, PartialEq, Eq)]
struct TransferState {
    /// Leg being transferred (blind: foreground leg; attended: primary).
    leg: WhichLeg,
    /// Numeric transfer target (validated extension, never a URI).
    target: String,
    /// REFER accepted with 202; awaiting final NOTIFY sipfrag.
    accepted: bool,
    /// Attended transfer: retire both legs on completion (consult joins).
    attended: bool,
}

/// Native single-call manager. Sans-io except the audio pipeline: returns
/// typed events; the Tauri layer forwards them to the webview.
///
/// Two-dialog ceiling: at most `active` (primary) + `second` (waiting
/// incoming or consultation outgoing) ever exist — a third INVITE gets 486.
/// Exactly one leg owns the single [`MediaPipeline`]/RTP stream at a time
/// (tracked by `foreground`); the parked leg is always held (`sendonly`) or
/// not yet established. Media is torn down only when the last leg goes.
pub struct CallManager {
    dedup: InviteDedupCache,
    active: Option<ActiveCall>,
    /// Second dialog: waiting incoming INVITE or outgoing consult leg.
    second: Option<ActiveCall>,
    /// Which leg owns the single media stream.
    foreground: WhichLeg,
    /// In-flight REFER transfer, if any.
    transfer: Option<TransferState>,
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
            second: None,
            foreground: WhichLeg::Primary,
            transfer: None,
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

    /// Foreground (media-owning) leg state. Single-leg behaviour is
    /// unchanged: with no second leg this is exactly the old `state()`.
    pub fn state(&self) -> CallStateNative {
        dialog_state_of(self.leg_ref(self.foreground))
    }

    /// Dialog state of one leg (`Idle` when the slot is empty).
    pub fn leg_state(&self, leg: WhichLeg) -> CallStateNative {
        dialog_state_of(self.leg_ref(leg))
    }

    /// Direction of one leg (`None` when the slot is empty).
    pub fn leg_direction(&self, leg: WhichLeg) -> Option<CallDirection> {
        self.leg_ref(leg).map(|c| c.direction)
    }

    /// Peer extension of one leg (`None` when the slot is empty).
    pub fn leg_peer(&self, leg: WhichLeg) -> Option<&str> {
        self.leg_ref(leg).map(|c| c.peer.as_str())
    }

    /// Call id of one leg (`None` when the slot is empty).
    pub fn leg_call_id(&self, leg: WhichLeg) -> Option<&str> {
        self.leg_ref(leg).map(|c| c.id.as_str())
    }

    /// Which leg currently owns the single media stream.
    pub fn foreground(&self) -> WhichLeg {
        self.foreground
    }

    /// `true` while a second dialog is parked (waiting or consult).
    pub fn has_second(&self) -> bool {
        self.second.is_some()
    }

    /// Find the slot holding `call_id` (wire dispatch correlates BYE/CANCEL/
    /// REFER/NOTIFY by Call-ID across the at-most-two dialogs).
    pub fn find_leg(&self, call_id: &str) -> Option<WhichLeg> {
        if self.active.as_ref().is_some_and(|c| c.id == call_id) {
            Some(WhichLeg::Primary)
        } else if self.second.as_ref().is_some_and(|c| c.id == call_id) {
            Some(WhichLeg::Second)
        } else {
            None
        }
    }

    /// Number of legs in `DialogState::Active` (media-flowing). The call
    /// power invariant is `<= 1`: held/waiting legs are `Held`/`Ringing`,
    /// never second active RTP streams.
    pub fn rtp_active_legs(&self) -> usize {
        [WhichLeg::Primary, WhichLeg::Second]
            .into_iter()
            .filter(|&l| self.leg_state(l) == CallStateNative::Active)
            .count()
    }

    fn leg_ref(&self, leg: WhichLeg) -> Option<&ActiveCall> {
        match leg {
            WhichLeg::Primary => self.active.as_ref(),
            WhichLeg::Second => self.second.as_ref(),
        }
    }

    fn leg_mut(&mut self, leg: WhichLeg) -> Option<&mut ActiveCall> {
        match leg {
            WhichLeg::Primary => self.active.as_mut(),
            WhichLeg::Second => self.second.as_mut(),
        }
    }

    fn next_call_id(&mut self) -> String {
        self.call_seq += 1;
        format!("daad-{}-{}", std::process::id(), self.call_seq)
    }

    // -- Outgoing ------------------------------------------------------

    /// Start an outgoing call to a numeric extension. Builds the local SDP
    /// offer with SDES-SRTP; the transport sends the returned message.
    /// Refused while any leg exists (use [`consult`](Self::consult) for a
    /// second outgoing dialog).
    pub fn invite(&mut self, extension: &str) -> Result<String, CoreError> {
        let to = validate_extension(extension)?;
        if self.active.is_some() || self.second.is_some() {
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

    /// Provisional received on the foreground outgoing leg (100/180/183).
    pub fn on_provisional(&mut self, code: u16) -> Result<(), CoreError> {
        self.on_provisional_for(self.foreground, code)
    }

    /// Provisional received on one outgoing leg (consult 100/180/183).
    pub fn on_provisional_for(&mut self, leg: WhichLeg, code: u16) -> Result<(), CoreError> {
        let call = self.leg_mut(leg).ok_or(CoreError::NoActiveCall)?;
        call.dialog.note_provisional(code)?;
        Ok(())
    }

    /// 200 OK with SDP answer on the foreground outgoing leg: enforce SRTP,
    /// arm media, emit Active.
    pub fn on_answer(&mut self, answer_sdp: &str) -> Result<String, CoreError> {
        self.on_answer_for(self.foreground, answer_sdp)
    }

    /// 200 OK with SDP answer on one outgoing leg (primary or consult).
    /// The answering leg takes media focus; the parked leg stays held.
    pub fn on_answer_for(&mut self, leg: WhichLeg, answer_sdp: &str) -> Result<String, CoreError> {
        let answer = SdpOffer::parse(answer_sdp).map_err(CoreError::Sdp)?;
        require_sdes(!answer.media.crypto_lines.is_empty())?;
        if answer.media.proto != "RTP/SAVP" {
            return Err(CoreError::Sdp(SdpError::SrtpRequired));
        }
        let (ack, id) = match self.leg_mut(leg).ok_or(CoreError::NoActiveCall)? {
            call => {
                call.dialog.note_success()?;
                let ack = call.dialog.build_ack();
                (ack, call.id.clone())
            }
        };
        // Media up: pipeline runs; SRTP tx armed from the negotiated keying
        // in production (here: fresh keys bound at answer time — the real
        // keying comes from the dialog's stored offer/answer exchange).
        self.media.start()?;
        self.foreground = leg;
        self.emit(CallEvent::Active { call_id: id });
        Ok(ack)
    }

    /// Final failure on the foreground outgoing leg (486/603/488/...).
    pub fn on_failure(&mut self, code: u16) -> Result<(), CoreError> {
        self.on_failure_for(self.foreground, code)
    }

    /// Final failure on one outgoing leg. A failed consult leg retires
    /// alone: the parked primary resumes as foreground (media never drops
    /// while a leg survives).
    pub fn on_failure_for(&mut self, leg: WhichLeg, code: u16) -> Result<(), CoreError> {
        let other = leg.other();
        {
            let call = self.leg_mut(leg).ok_or(CoreError::NoActiveCall)?;
            call.dialog.note_failure(code)?;
        }
        let reason = match code {
            486 => "busy".to_string(),
            487 => "cancelled".to_string(),
            488 => "incompatible (SRTP/codec required)".to_string(),
            _ => format!("failed:{code}"),
        };
        self.finish_leg(leg, TeardownReason::Failure, &reason);
        // A surviving parked leg takes focus back (it was held for consult).
        if self.leg_ref(other).is_some() {
            self.foreground = other;
            if self.leg_state(other) == CallStateNative::Held {
                if let Some(call) = self.leg_mut(other) {
                    let _ = call.dialog.resume();
                }
                self.media.resume();
            }
            if let Some(id) = self.leg_call_id(other).map(str::to_string) {
                self.emit(CallEvent::Active { call_id: id });
            }
        }
        Ok(())
    }

    // -- Incoming ------------------------------------------------------

    /// Inbound INVITE. Returns the SIP response text to emit
    /// (100+180 ringing, 486 busy, or 200 retransmit for duplicates).
    /// `offer_sdp` must carry SDES crypto or the call is rejected with 488.
    ///
    /// Call-waiting policy (max two dialogs): the first INVITE owns the
    /// primary leg; a second INVITE while any leg is up is parked as the
    /// waiting leg (180 + [`CallEvent::CallWaiting`], never auto-answered);
    /// a third concurrent INVITE gets 486.
    pub fn on_invite_received(
        &mut self,
        call_id: &str,
        cseq: u32,
        branch: &str,
        from: &str,
        offer_sdp: &str,
    ) -> String {
        let busy = self.active.is_some() && self.second.is_some();
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
                let leg = ActiveCall {
                    id: call_id.to_string(),
                    peer: from.to_string(),
                    direction: CallDirection::Incoming,
                    dialog,
                    local_crypto: keys.to_crypto_attr(1),
                    rtp: RtpOutbound::new(rand::random(), 0),
                    srtp_tx: None,
                    muted: false,
                };
                if self.active.is_none() {
                    self.active = Some(leg);
                    self.foreground = WhichLeg::Primary;
                    self.emit(CallEvent::IncomingRinging {
                        from: from.to_string(),
                        call_id: call_id.to_string(),
                    });
                } else if self.second.is_none() {
                    // Waiting leg: parked ringing, media stays with primary.
                    self.second = Some(leg);
                    self.emit(CallEvent::CallWaiting {
                        from: from.to_string(),
                        call_id: call_id.to_string(),
                    });
                } else {
                    // Unreachable: `busy` was true so dedup returned BusyHere.
                    // Fail closed with 486 rather than a third dialog.
                    return SipDialog::new_incoming(call_id.to_string())
                        .build_response(486, "Busy Here", None);
                }
                ringing
            }
        }
    }

    /// Answer the ringing primary incoming call. Returns the 200 OK (with SDP).
    pub fn answer(&mut self) -> Result<String, CoreError> {
        self.answer_leg(WhichLeg::Primary)
    }

    /// Answer one ringing incoming leg (shared by [`answer`](Self::answer)
    /// and [`answer_waiting`](Self::answer_waiting)). The answered leg takes
    /// media focus.
    fn answer_leg(&mut self, leg: WhichLeg) -> Result<String, CoreError> {
        let (media_ip, media_port) = (self.media_ip.clone(), self.media_port);
        let (res, id) = {
            let call = self.leg_mut(leg).ok_or(CoreError::NoActiveCall)?;
            if call.direction != CallDirection::Incoming {
                return Err(CoreError::BadState("answer is for incoming calls"));
            }
            call.dialog.answer()?;
            let crypto = call.local_crypto.clone();
            let answer = SdpOffer::offer(&media_ip, media_port, crypto, 20);
            let res = call.dialog.build_response(200, "OK", Some(&answer.to_string()));
            (res, call.id.clone())
        };
        self.media.start()?;
        self.foreground = leg;
        self.emit(CallEvent::Active { call_id: id });
        Ok(res)
    }

    /// Answer the waiting second leg: hold the active leg first (its
    /// `sendonly` re-INVITE is returned for the wire), then answer waiting.
    /// Returns `(hold_reinvite_for_active, ok_200_for_waiting)`. Media focus
    /// moves to the waiting leg; exactly one RTP stream stays up.
    pub fn answer_waiting(&mut self, from_uri: &str) -> Result<(String, String), CoreError> {
        if self.second.is_none() {
            return Err(CoreError::NoActiveCall);
        }
        if self.leg_state(WhichLeg::Second) != CallStateNative::IncomingRinging {
            return Err(CoreError::BadState("waiting leg is not ringing"));
        }
        let hold_req = self.hold_request_for(self.foreground, from_uri)?;
        let ok200 = self.answer_leg(WhichLeg::Second)?;
        if let Some(id) = self.leg_call_id(WhichLeg::Second).map(str::to_string) {
            self.emit(CallEvent::Swapped { active_call_id: id });
        }
        Ok((hold_req, ok200))
    }

    /// Explicit swap: hold the foreground leg, resume the parked leg.
    /// Returns `(hold_reinvite_for_old, resume_reinvite_for_new)` for the
    /// wire. Media focus moves; the stream count stays exactly one.
    pub fn swap(&mut self, from_uri: &str) -> Result<(String, String), CoreError> {
        let old = self.foreground;
        let new = old.other();
        if self.leg_ref(new).is_none() {
            return Err(CoreError::NoActiveCall);
        }
        let old_state = self.leg_state(old);
        let new_state = self.leg_state(new);
        if !matches!(old_state, CallStateNative::Active | CallStateNative::Held) {
            return Err(CoreError::BadState("swap needs an established foreground leg"));
        }
        if !matches!(new_state, CallStateNative::Active | CallStateNative::Held) {
            return Err(CoreError::BadState("swap needs an established parked leg"));
        }
        // Hold the old leg unless already held (idempotent resume path
        // tolerates Active->Held only, so skip the dialog transition then).
        let hold_req = if old_state == CallStateNative::Active {
            self.hold_request_for(old, from_uri)?
        } else {
            String::new()
        };
        let resume_req = if new_state == CallStateNative::Held {
            self.resume_request_for(new, from_uri)?
        } else {
            // Parked but Active (should not happen with correct focus, but
            // tolerate): just move focus without wire churn.
            String::new()
        };
        self.foreground = new;
        self.media.resume();
        if let Some(id) = self.leg_call_id(new).map(str::to_string) {
            self.emit(CallEvent::Swapped { active_call_id: id });
        }
        Ok((hold_req, resume_req))
    }

    /// Reject the ringing incoming call (486 busy / 603 decline). Targets the
    /// ringing leg (the waiting leg when one is parked, else primary).
    /// Returns a complete stateless response (status line + Call-ID/CSeq) so
    /// the transport layer can send it on the dialog's stream.
    pub fn reject(&mut self, busy: bool) -> Result<String, CoreError> {
        let leg = if self.leg_state(WhichLeg::Second) == CallStateNative::IncomingRinging {
            WhichLeg::Second
        } else {
            WhichLeg::Primary
        };
        let mut call = match leg {
            WhichLeg::Primary => self.active.take().ok_or(CoreError::NoActiveCall)?,
            WhichLeg::Second => self.second.take().ok_or(CoreError::NoActiveCall)?,
        };
        let code = call.dialog.reject(busy);
        // Media drops only with the last leg; rejecting waiting must not
        // mute the surviving active call.
        if self.active.is_none() && self.second.is_none() {
            self.media.teardown(TeardownReason::Cancel);
            self.transfer = None;
        } else if self.leg_ref(self.foreground).is_none() {
            self.foreground = leg.other();
        }
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

    /// Local hangup on the foreground (media) leg: CANCEL pre-200, BYE once
    /// established, NoOp when done. Returns the request text to send, if any.
    /// Media is torn down only when no leg remains; a parked second leg is
    /// promoted to foreground (resumed when held) instead of orphaned.
    pub fn hangup(&mut self) -> Result<Option<String>, CoreError> {
        self.hangup_leg(self.foreground)
    }

    /// Local hangup on one leg (wire dispatch / tests). Promotion rules are
    /// the same as [`hangup`](Self::hangup).
    pub fn hangup_leg(&mut self, leg: WhichLeg) -> Result<Option<String>, CoreError> {
        let other = leg.other();
        let msg = match self.leg_mut(leg).ok_or(CoreError::NoActiveCall)? {
            call => match call.dialog.local_teardown() {
                TeardownAction::SendCancel => {
                    let m = call.dialog.build_cancel();
                    Some((m, TeardownReason::Cancel, "cancelled"))
                }
                TeardownAction::SendBye => {
                    let m = call.dialog.build_bye();
                    Some((m, TeardownReason::Bye, "bye"))
                }
                TeardownAction::NoOp => None,
            },
        };
        match msg {
            Some((text, reason, label)) => {
                self.finish_leg(leg, reason, label);
                self.promote_other_after_hangup(other);
                Ok(Some(text))
            }
            None => Ok(None),
        }
    }

    /// Promote the surviving leg to foreground after a hangup: a held leg
    /// resumes (media moves to it), a ringing leg stays ringing as the new
    /// foreground. Single media stream is preserved throughout.
    fn promote_other_after_hangup(&mut self, other: WhichLeg) {
        if self.leg_ref(other).is_none() {
            return;
        }
        self.foreground = other;
        if self.leg_state(other) == CallStateNative::Held {
            if let Some(call) = self.leg_mut(other) {
                let _ = call.dialog.resume();
            }
            self.media.resume();
            if let Some(id) = self.leg_call_id(other).map(str::to_string) {
                self.emit(CallEvent::Active { call_id: id });
            }
        }
    }

    /// Peer BYE on the foreground leg.
    pub fn on_bye(&mut self) -> Result<(), CoreError> {
        self.on_bye_for_leg(self.foreground)
    }

    /// Peer BYE correlated by Call-ID (wire dispatch with two dialogs).
    /// Unknown Call-IDs are rejected (fail-closed 481 at the wire layer),
    /// never applied to the wrong leg.
    pub fn on_bye_for(&mut self, call_id: &str) -> Result<(), CoreError> {
        match self.find_leg(call_id) {
            Some(leg) => self.on_bye_for_leg(leg),
            None => Err(CoreError::BadState("BYE for unknown dialog")),
        }
    }

    fn on_bye_for_leg(&mut self, leg: WhichLeg) -> Result<(), CoreError> {
        let other = leg.other();
        let established = match self.leg_mut(leg).ok_or(CoreError::NoActiveCall)? {
            call => call.dialog.remote_bye(),
        };
        if established {
            self.finish_leg(leg, TeardownReason::Bye, "bye");
            // A parked leg survives a peer BYE on the other leg.
            if self.leg_ref(other).is_some() {
                self.foreground = other;
                if self.leg_state(other) == CallStateNative::Held {
                    if let Some(call) = self.leg_mut(other) {
                        let _ = call.dialog.resume();
                    }
                    self.media.resume();
                    if let Some(id) = self.leg_call_id(other).map(str::to_string) {
                        self.emit(CallEvent::Active { call_id: id });
                    }
                }
            }
            Ok(())
        } else {
            Err(CoreError::BadState("BYE for non-established dialog"))
        }
    }

    /// Signalling transport lost under an established leg: fail only the
    /// driven leg (the parked leg is promoted, never orphaned). Media is
    /// released only when the last leg goes — no silent zombie Active.
    pub fn on_transport_lost_for(&mut self, leg: WhichLeg) -> Result<(), CoreError> {
        if self.leg_ref(leg).is_none() {
            return Err(CoreError::NoActiveCall);
        }
        let other = leg.other();
        self.finish_leg(leg, TeardownReason::Failure, "failed");
        if self.leg_ref(other).is_some() {
            self.foreground = other;
            if self.leg_state(other) == CallStateNative::Held {
                if let Some(call) = self.leg_mut(other) {
                    let _ = call.dialog.resume();
                }
                self.media.resume();
                if let Some(id) = self.leg_call_id(other).map(str::to_string) {
                    self.emit(CallEvent::Active { call_id: id });
                }
            }
        }
        Ok(())
    }

    /// Peer CANCEL (pre-answer) on the foreground leg. The missed-call path
    /// funnels through here.
    pub fn on_cancel(&mut self) -> Result<(), CoreError> {
        self.on_cancel_for_leg(self.foreground)
    }

    /// Peer CANCEL correlated by Call-ID (wire dispatch with two dialogs).
    pub fn on_cancel_for(&mut self, call_id: &str) -> Result<(), CoreError> {
        match self.find_leg(call_id) {
            Some(leg) => self.on_cancel_for_leg(leg),
            None => Err(CoreError::BadState("CANCEL for unknown dialog")),
        }
    }

    fn on_cancel_for_leg(&mut self, leg: WhichLeg) -> Result<(), CoreError> {
        let missed = match self.leg_ref(leg) {
            Some(call) => call.direction == CallDirection::Incoming,
            None => return Err(CoreError::NoActiveCall),
        };
        let accepted = match self.leg_mut(leg) {
            Some(call) => call.dialog.remote_cancel(),
            None => return Err(CoreError::NoActiveCall),
        };
        if accepted {
            self.finish_leg(
                leg,
                TeardownReason::Cancel,
                if missed { "missed" } else { "cancelled" },
            );
            if leg == self.foreground {
                if let Some(other) = [WhichLeg::Primary, WhichLeg::Second]
                    .into_iter()
                    .find(|&l| self.leg_ref(l).is_some())
                {
                    self.foreground = other;
                }
            }
            Ok(())
        } else {
            Err(CoreError::Dialog(crate::sip_core::dialog::DialogError::CancelTooLate))
        }
    }

    fn finish_active(&mut self, reason: TeardownReason, label: &str) {
        self.finish_leg(WhichLeg::Primary, reason, label);
    }

    /// Remove one leg, emitting `Ended` with the dialog's authoritative
    /// reason (except incoming CANCEL-before-answer, which is `missed` by
    /// product policy). Media is released only when the last leg goes, so a
    /// parked leg never loses its stream to the other leg's teardown.
    fn finish_leg(&mut self, leg: WhichLeg, reason: TeardownReason, label: &str) {
        let ended = match leg {
            WhichLeg::Primary => self.active.take(),
            WhichLeg::Second => self.second.take(),
        };
        if self.active.is_none() && self.second.is_none() {
            self.media.teardown(reason);
            self.transfer = None;
        }
        if let Some(call) = ended {
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
        if self.leg_ref(self.foreground).is_none() {
            if let Some(other) = [WhichLeg::Primary, WhichLeg::Second]
                .into_iter()
                .find(|&l| self.leg_ref(l).is_some())
            {
                self.foreground = other;
            }
        }
    }

    /// Teardown everything: BYE/CANCEL/failure/logout/suspend funnel here.
    /// Releases audio devices, clears both dialogs and any transfer.
    pub fn teardown_all(&mut self, reason: TeardownReason) {
        self.media.teardown(reason);
        self.transfer = None;
        let label = match reason {
            TeardownReason::Logout => "logout",
            TeardownReason::Suspend => "suspend",
            TeardownReason::Failure => "failed",
            _ => "ended",
        };
        for leg in self.active.take().into_iter().chain(self.second.take()) {
            self.emit(CallEvent::Ended {
                call_id: leg.id,
                reason: label.to_string(),
            });
        }
        self.foreground = WhichLeg::Primary;
    }

    // -- In-call features ----------------------------------------------

    pub fn set_muted(&mut self, muted: bool) -> Result<(), CoreError> {
        let fg = self.foreground;
        let call = self.leg_mut(fg).ok_or(CoreError::NoActiveCall)?;
        call.muted = muted;
        self.media.set_mute(muted);
        Ok(())
    }

    pub fn is_muted(&self) -> bool {
        self.leg_ref(self.foreground).map(|c| c.muted).unwrap_or(false)
    }

    /// Hold via re-INVITE with `sendonly`. Returns the re-INVITE SDP.
    pub fn hold(&mut self) -> Result<String, CoreError> {
        self.hold_leg(self.foreground)
    }

    fn hold_leg(&mut self, leg: WhichLeg) -> Result<String, CoreError> {
        let (media_ip, media_port) = (self.media_ip.clone(), self.media_port);
        let is_fg = leg == self.foreground;
        let crypto = {
            let call = self.leg_mut(leg).ok_or(CoreError::NoActiveCall)?;
            call.dialog.hold()?;
            call.local_crypto.clone()
        };
        // Only the foreground leg's hold pauses the shared pipeline; parking
        // bookkeeping for the other leg is dialog-state only.
        if is_fg {
            self.media.hold();
        }
        Ok(SdpOffer::offer(&media_ip, media_port, crypto, 20)
            .with_hold()
            .to_string())
    }

    /// Resume via re-INVITE with `sendrecv`.
    pub fn resume(&mut self) -> Result<String, CoreError> {
        let (media_ip, media_port) = (self.media_ip.clone(), self.media_port);
        let fg = self.foreground;
        let crypto = {
            let call = self.leg_mut(fg).ok_or(CoreError::NoActiveCall)?;
            call.dialog.resume()?;
            call.local_crypto.clone()
        };
        self.media.resume();
        Ok(SdpOffer::offer(&media_ip, media_port, crypto, 20)
            .with_resume()
            .to_string())
    }

    /// Hold as a complete in-dialog re-INVITE request (CSeq bumped) ready to
    /// send on the dialog's stream. `from_uri` is the local AoR.
    pub fn hold_request(&mut self, from_uri: &str) -> Result<String, CoreError> {
        let fg = self.foreground;
        self.hold_request_for(fg, from_uri)
    }

    /// Hold one leg as a complete in-dialog re-INVITE (`sendonly`).
    pub fn hold_request_for(&mut self, leg: WhichLeg, from_uri: &str) -> Result<String, CoreError> {
        let (media_ip, media_port) = (self.media_ip.clone(), self.media_port);
        let is_fg = leg == self.foreground;
        let (sdp, peer) = {
            let call = self.leg_mut(leg).ok_or(CoreError::NoActiveCall)?;
            call.dialog.hold()?;
            let sdp = SdpOffer::offer(&media_ip, media_port, call.local_crypto.clone(), 20)
                .with_hold()
                .to_string();
            (sdp, call.peer.clone())
        };
        if is_fg {
            self.media.hold();
        }
        let req = self
            .leg_mut(leg)
            .ok_or(CoreError::NoActiveCall)?
            .dialog
            .build_reinvite(from_uri, &peer, &sdp);
        Ok(req)
    }

    /// Resume as a complete in-dialog re-INVITE request (`sendrecv`).
    pub fn resume_request(&mut self, from_uri: &str) -> Result<String, CoreError> {
        let fg = self.foreground;
        self.resume_request_for(fg, from_uri)
    }

    /// Resume one leg as a complete in-dialog re-INVITE (`sendrecv`).
    pub fn resume_request_for(&mut self, leg: WhichLeg, from_uri: &str) -> Result<String, CoreError> {
        let (media_ip, media_port) = (self.media_ip.clone(), self.media_port);
        let is_fg = leg == self.foreground;
        let (sdp, peer) = {
            let call = self.leg_mut(leg).ok_or(CoreError::NoActiveCall)?;
            call.dialog.resume()?;
            let sdp = SdpOffer::offer(&media_ip, media_port, call.local_crypto.clone(), 20)
                .with_resume()
                .to_string();
            (sdp, call.peer.clone())
        };
        if is_fg {
            self.media.resume();
        }
        let req = self
            .leg_mut(leg)
            .ok_or(CoreError::NoActiveCall)?
            .dialog
            .build_reinvite(from_uri, &peer, &sdp);
        Ok(req)
    }

    /// Send DTMF (RFC 4733) on the foreground leg. Returns the 4-byte
    /// telephone-event payload to attach to the outbound RTP stream.
    pub fn dtmf(&mut self, digit: char) -> Result<[u8; 4], CoreError> {
        let fg = self.foreground;
        let call = self.leg_ref(fg).ok_or(CoreError::NoActiveCall)?;
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
    /// direction only — never keys, passwords, or SDP bodies). Reports the
    /// foreground (media) leg.
    pub fn active_peer(&self) -> Option<(&str, CallDirection)> {
        let fg = self.foreground;
        self.leg_ref(fg).map(|c| (c.peer.as_str(), c.direction))
    }

    /// Secret-free peer summary for the parked leg, if any.
    pub fn waiting_peer(&self) -> Option<(&str, CallDirection)> {
        let fg = self.foreground;
        self.leg_ref(fg.other()).map(|c| (c.peer.as_str(), c.direction))
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
        let fg = self.foreground;
        let call = self.leg_mut(fg).ok_or(CoreError::NoActiveCall)?;
        call.srtp_tx = Some(SrtpSession::new_sender(keys)?);
        Ok(())
    }

    // -- Call power: consultation, swap, transfer ------------------------

    /// Start a consultation leg for attended transfer: hold the established
    /// foreground leg (`sendonly` re-INVITE returned for the wire) and dial
    /// the numeric consult target as the second dialog. Returns
    /// `(hold_reinvite_for_primary, invite_for_consult)`. The consult INVITE
    /// travels on its own signalling stream (own CSeq space); media focus
    /// stays with the primary until the consult answers.
    pub fn consult(&mut self, target: &str, from_uri: &str) -> Result<(String, String), CoreError> {
        let to = validate_extension(target)?;
        if self.second.is_some() {
            return Err(CoreError::AlreadyInCall);
        }
        let fg_state = self.leg_state(self.foreground);
        if !matches!(fg_state, CallStateNative::Active | CallStateNative::Held) {
            return Err(CoreError::BadState("consult needs an established call"));
        }
        if self.transfer.is_some() {
            return Err(CoreError::BadState("transfer already in progress"));
        }
        let hold_req = if fg_state == CallStateNative::Active {
            let fg = self.foreground;
            self.hold_request_for(fg, from_uri)?
        } else {
            String::new()
        };
        let call_id = self.next_call_id();
        let keys = SrtpKeys::generate();
        let crypto = keys.to_crypto_attr(1);
        let offer = self.local_offer(&crypto);
        let dialog = SipDialog::new_outgoing(call_id.clone());
        let req = dialog.build_invite_request("sip:daad@local", &to, &offer.to_string());
        self.second = Some(ActiveCall {
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
        Ok((hold_req, req))
    }

    /// 200 OK answer on the consult leg (SDP enforced like any outgoing
    /// answer). Media focus moves to the consult leg; the primary stays
    /// held (`sendonly`) — exactly one active RTP stream.
    pub fn on_consult_answer(&mut self, answer_sdp: &str) -> Result<String, CoreError> {
        if self.second.is_none() {
            return Err(CoreError::NoActiveCall);
        }
        let ack = self.on_answer_for(WhichLeg::Second, answer_sdp)?;
        if let Some(id) = self.leg_call_id(WhichLeg::Second).map(str::to_string) {
            self.emit(CallEvent::Swapped { active_call_id: id });
        }
        Ok(ack)
    }

    /// Blind transfer (RFC 3515): REFER the foreground leg to a numeric
    /// target. Returns the REFER request text for the wire (`Refer-To` +
    /// `Referred-By`, CSeq bumped). The 202/NOTIFY outcome arrives via
    /// [`on_refer_accepted`](Self::on_refer_accepted) /
    /// [`on_transfer_notify`](Self::on_transfer_notify).
    pub fn blind_transfer_request(
        &mut self,
        target: &str,
        from_uri: &str,
        refer_to_uri: &str,
    ) -> Result<String, CoreError> {
        let to = validate_extension(target)?;
        if self.transfer.is_some() {
            return Err(CoreError::BadState("transfer already in progress"));
        }
        let leg = self.foreground;
        match self.leg_state(leg) {
            CallStateNative::Active | CallStateNative::Held => {}
            _ => return Err(CoreError::BadState("transfer needs an established call")),
        }
        let refer = self
            .leg_mut(leg)
            .ok_or(CoreError::NoActiveCall)?
            .dialog
            .build_refer(refer_to_uri, from_uri, None);
        self.transfer = Some(TransferState {
            leg,
            target: to,
            accepted: false,
            attended: false,
        });
        Ok(refer)
    }

    /// Attended transfer: REFER the held primary leg to the consult target,
    /// joining via `Replaces` (RFC 3891) pointing at the answered consult
    /// dialog. Requires primary held + consult active. Returns the REFER
    /// text for the primary leg's stream.
    pub fn attended_transfer_request(
        &mut self,
        from_uri: &str,
        refer_to_uri: &str,
    ) -> Result<String, CoreError> {
        if self.transfer.is_some() {
            return Err(CoreError::BadState("transfer already in progress"));
        }
        if self.leg_state(WhichLeg::Primary) != CallStateNative::Held {
            return Err(CoreError::BadState("attended transfer needs the primary held"));
        }
        if self.leg_state(WhichLeg::Second) != CallStateNative::Active {
            return Err(CoreError::BadState("attended transfer needs an answered consult leg"));
        }
        let replaces = {
            let consult = self.second.as_ref().ok_or(CoreError::NoActiveCall)?;
            // Tags are synthetic (first 8 of each call id): sufficient for
            // the PBX to correlate the two dialogs we own, and they
            // round-trip through `Replaces::parse`.
            let from_tag = consult.id.chars().take(8).collect::<String>();
            let primary_id = self.active.as_ref().ok_or(CoreError::NoActiveCall)?.id.clone();
            let to_tag = primary_id.chars().take(8).collect::<String>();
            consult.dialog.replaces_for(&from_tag, &to_tag)
        };
        let target = self
            .second
            .as_ref()
            .map(|c| c.peer.clone())
            .unwrap_or_default();
        let refer = self
            .active
            .as_mut()
            .ok_or(CoreError::NoActiveCall)?
            .dialog
            .build_refer(refer_to_uri, from_uri, Some(&replaces));
        self.transfer = Some(TransferState {
            leg: WhichLeg::Primary,
            target,
            accepted: false,
            attended: true,
        });
        Ok(refer)
    }

    /// 202 (or failure) to our REFER. `202 Accepted` arms the transfer;
    /// any other final code fails it (leg stays up, media untouched).
    pub fn on_refer_accepted(&mut self, code: u16) -> Result<(), CoreError> {
        let leg = self.transfer.as_ref().ok_or(CoreError::NoActiveCall)?.leg;
        if code == 202 {
            if let Some(t) = self.transfer.as_mut() {
                t.accepted = true;
            }
            Ok(())
        } else {
            let call_id = self.leg_call_id(leg).unwrap_or_default().to_string();
            self.transfer = None;
            self.emit(CallEvent::TransferFailed { call_id, code });
            Ok(())
        }
    }

    /// Inbound REFER on one of our dialogs (peer-initiated transfer). The
    /// stack accepts with 202 and reports the target; completing the
    /// transfer-out is the peer/PBX's job. Returns the `202 Accepted`
    /// response text for the wire. `refer_to` is echoed secret-free (it is
    /// a dialled extension/URI the peer supplied, never key material).
    pub fn on_refer_received(&mut self, call_id: &str, refer_to: &str) -> String {
        let leg = self.find_leg(call_id).unwrap_or(self.foreground);
        let cid = self
            .leg_call_id(leg)
            .unwrap_or(call_id)
            .to_string();
        // Only established legs can be transferred; early dialogs get 488
        // (fail-closed, never a phantom transfer).
        match self.leg_state(leg) {
            CallStateNative::Active | CallStateNative::Held => {}
            _ => {
                return SipDialog::new_incoming(cid).build_response(488, "Not Acceptable Here", None)
            }
        }
        self.emit(CallEvent::TransferRequested {
            call_id: cid.clone(),
            refer_to: refer_to.trim().to_string(),
        });
        SipDialog::new_incoming(cid).build_response(202, "Accepted", None)
    }

    /// Transfer-progress NOTIFY body (`message/sipfrag`, RFC 3515 §2.4.2).
    /// Provisional sipfrag (100/180) keeps waiting; final 2xx retires the
    /// transferred leg(s) as `transferred` (media released only when no leg
    /// remains — zero orphans); final 3xx–6xx fails the transfer and the
    /// leg stays up. Returns the parsed progress.
    pub fn on_transfer_notify(&mut self, body: &str) -> Result<TransferProgress, CoreError> {
        use crate::sip_core::dialog::parse_transfer_notify;
        let t = self.transfer.clone().ok_or(CoreError::BadState("no transfer in progress"))?;
        let progress = parse_transfer_notify(body)
            .ok_or(CoreError::BadState("unparsable transfer NOTIFY"))?;
        match progress {
            TransferProgress::Trying(_) => Ok(progress),
            TransferProgress::Completed(_) => {
                let attended = t.attended;
                // Retire the transferred leg as Transferred (Ended reason
                // "transferred"); attended also retires the consult leg.
                self.retire_leg_as_transferred(t.leg);
                if attended {
                    let other = t.leg.other();
                    if self.leg_ref(other).is_some() {
                        self.retire_leg_as_transferred(other);
                    }
                }
                self.transfer = None;
                Ok(progress)
            }
            TransferProgress::Failed(code) => {
                let call_id = self
                    .leg_call_id(t.leg)
                    .unwrap_or_default()
                    .to_string();
                self.transfer = None;
                self.emit(CallEvent::TransferFailed { call_id, code });
                Ok(progress)
            }
        }
    }

    /// Mark one leg's dialog transferred and remove it, emitting
    /// `Ended { reason: "transferred" }`. Media is released only when the
    /// last leg goes (attended completion retires both, releasing media).
    fn retire_leg_as_transferred(&mut self, leg: WhichLeg) {
        if let Some(call) = self.leg_mut(leg) {
            call.dialog.note_transferred();
        }
        self.finish_leg(leg, TeardownReason::Bye, "transferred");
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
    fn second_incoming_parks_as_waiting_third_gets_busy() {
        let mut m = CallManager::with_audio(true);
        m.on_invite_received("cid-a", 1, "br-a", "1000", SECURE_OFFER);
        // Second INVITE while a leg is up: parked waiting (180, no auto-answer).
        let waiting = m.on_invite_received("cid-b", 1, "br-b", "1001", SECURE_OFFER);
        assert!(waiting.contains("180"), "{waiting}");
        assert_eq!(m.leg_state(WhichLeg::Second), CallStateNative::IncomingRinging);
        assert!(m.take_events().iter().any(|e| matches!(
            e,
            CallEvent::CallWaiting { call_id, .. } if call_id == "cid-b"
        )));
        // Never auto-answered: primary still owns media.
        assert_eq!(m.foreground(), WhichLeg::Primary);
        // Retransmitted original INVITE still replays 180 without new state.
        let dup = m.on_invite_received("cid-a", 1, "br-a", "1000", SECURE_OFFER);
        assert!(dup.contains("180"));
        // Third concurrent INVITE: 486, never a third dialog.
        let busy = m.on_invite_received("cid-c", 1, "br-c", "1002", SECURE_OFFER);
        assert!(busy.contains("486"), "{busy}");
        assert!(m.has_second(), "waiting leg still parked");
        assert!(m.find_leg("cid-c").is_none());
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

    // -- Call power: waiting / swap / transfer ---------------------------

    fn active_manager_with_peer(peer: &str) -> CallManager {
        let mut m = CallManager::with_audio(true);
        m.on_invite_received("cid-primary", 1, "br-primary", peer, SECURE_OFFER);
        m.answer().unwrap();
        m.take_events();
        assert_eq!(m.state(), CallStateNative::Active);
        m
    }

    #[test]
    fn answer_waiting_holds_active_and_moves_media() {
        let mut m = active_manager_with_peer("1000");
        m.on_invite_received("cid-wait", 1, "br-wait", "1001", SECURE_OFFER);
        let from = "sip:2001@pbx.example.com";
        let (hold_req, ok200) = m.answer_waiting(from).unwrap();
        // Hold re-INVITE for the previous active leg (sendonly, CSeq bumped).
        assert!(hold_req.starts_with("INVITE"), "{hold_req}");
        assert!(hold_req.contains("a=sendonly"), "{hold_req}");
        assert!(hold_req.contains("CSeq: 2 INVITE"), "{hold_req}");
        // 200 OK answers the waiting leg.
        assert!(ok200.contains("200 OK"), "{ok200}");
        assert_eq!(m.leg_state(WhichLeg::Primary), CallStateNative::Held);
        assert_eq!(m.leg_state(WhichLeg::Second), CallStateNative::Active);
        assert_eq!(m.foreground(), WhichLeg::Second);
        assert_eq!(m.rtp_active_legs(), 1, "exactly one active RTP stream");
        assert!(!m.media_released());
    }

    #[test]
    fn swap_exchanges_hold_and_resume_with_single_stream() {
        let mut m = active_manager_with_peer("1000");
        m.on_invite_received("cid-wait", 1, "br-wait", "1001", SECURE_OFFER);
        let from = "sip:2001@pbx.example.com";
        let (_, ok200) = m.answer_waiting(from).unwrap();
        assert!(ok200.contains("200 OK"));
        m.take_events();
        // Explicit swap back to the primary.
        let (hold_req, resume_req) = m.swap(from).unwrap();
        assert!(hold_req.contains("a=sendonly"), "{hold_req}");
        assert!(resume_req.contains("a=sendrecv"), "{resume_req}");
        assert_eq!(m.foreground(), WhichLeg::Primary);
        assert_eq!(m.leg_state(WhichLeg::Primary), CallStateNative::Active);
        assert_eq!(m.leg_state(WhichLeg::Second), CallStateNative::Held);
        assert_eq!(m.rtp_active_legs(), 1, "exactly one active RTP stream");
        // Swap without a second leg fails closed.
        let mut solo = active_manager_with_peer("1000");
        assert!(solo.swap(from).is_err());
    }

    #[test]
    fn hangup_promotes_parked_leg_without_dropping_media() {
        let mut m = active_manager_with_peer("1000");
        m.on_invite_received("cid-wait", 1, "br-wait", "1001", SECURE_OFFER);
        let from = "sip:2001@pbx.example.com";
        m.answer_waiting(from).unwrap();
        m.take_events();
        // Hang up the foreground (waiting-turned-active) leg: BYE goes out,
        // the held primary is promoted and resumed.
        let bye = m.hangup().unwrap().expect("BYE");
        assert!(bye.starts_with("BYE"), "{bye}");
        assert_eq!(m.foreground(), WhichLeg::Primary);
        assert_eq!(m.leg_state(WhichLeg::Primary), CallStateNative::Active);
        assert!(!m.media_released(), "media survives for the promoted leg");
        assert_eq!(m.rtp_active_legs(), 1);
        // Hanging up the last leg releases everything (zero orphans).
        let bye2 = m.hangup().unwrap().expect("BYE");
        assert!(bye2.starts_with("BYE"));
        assert!(m.media_released());
        assert_eq!(m.state(), CallStateNative::Idle);
    }

    #[test]
    fn reject_waiting_keeps_active_leg_up() {
        let mut m = active_manager_with_peer("1000");
        m.on_invite_received("cid-wait", 1, "br-wait", "1001", SECURE_OFFER);
        let resp = m.reject(false).unwrap();
        assert!(resp.starts_with("SIP/2.0 603"), "{resp}");
        assert!(resp.contains("Call-ID: cid-wait"), "{resp}");
        assert_eq!(m.leg_state(WhichLeg::Primary), CallStateNative::Active);
        assert!(!m.media_released());
    }

    #[test]
    fn blind_transfer_refer_202_notify_completes() {
        let mut m = active_manager_with_peer("1000");
        let from = "sip:2001@pbx.example.com";
        // Duplex fake dialog: our REFER goes out on the primary leg.
        let refer = m.blind_transfer_request("2002", from, "sip:2002@pbx.example.com").unwrap();
        assert!(refer.starts_with("REFER"), "{refer}");
        assert!(refer.contains("Refer-To: <sip:2002@pbx.example.com>"), "{refer}");
        assert!(refer.contains("Referred-By: <sip:2001@pbx.example.com>"), "{refer}");
        assert!(!refer.contains("Replaces:"), "{refer}");
        // Target rings: provisional sipfrag keeps our leg up.
        m.on_refer_accepted(202).unwrap();
        let progress = m.on_transfer_notify("SIP/2.0 180 Ringing\r\n\r\n").unwrap();
        assert_eq!(progress, crate::sip_core::dialog::TransferProgress::Trying(180));
        assert_eq!(m.state(), CallStateNative::Active);
        // Target answers: final 2xx retires our leg as transferred.
        let progress = m.on_transfer_notify("SIP/2.0 200 OK\r\n\r\n").unwrap();
        assert_eq!(progress, crate::sip_core::dialog::TransferProgress::Completed(200));
        assert!(m.media_released(), "zero orphans after transfer");
        assert_eq!(m.state(), CallStateNative::Idle);
        let evs = m.take_events();
        assert!(evs.iter().any(|e| matches!(
            e,
            CallEvent::Ended { reason, .. } if reason == "transferred"
        )));
    }

    #[test]
    fn blind_transfer_target_failure_keeps_leg_up() {
        let mut m = active_manager_with_peer("1000");
        let from = "sip:2001@pbx.example.com";
        m.blind_transfer_request("2002", from, "sip:2002@pbx.example.com").unwrap();
        m.on_refer_accepted(202).unwrap();
        let progress = m.on_transfer_notify("SIP/2.0 603 Decline\r\n\r\n").unwrap();
        assert_eq!(progress, crate::sip_core::dialog::TransferProgress::Failed(603));
        // Our leg survives a failed transfer, media untouched.
        assert_eq!(m.state(), CallStateNative::Active);
        assert!(!m.media_released());
        let evs = m.take_events();
        assert!(evs.iter().any(|e| matches!(
            e,
            CallEvent::TransferFailed { code: 603, .. }
        )));
        // Non-202 to REFER fails fast too.
        m.blind_transfer_request("2003", from, "sip:2003@pbx.example.com").unwrap();
        m.on_refer_accepted(486).unwrap();
        assert_eq!(m.state(), CallStateNative::Active);
    }

    #[test]
    fn transfer_rejects_bad_targets_and_idle() {
        let mut m = CallManager::with_audio(true);
        let from = "sip:2001@pbx.example.com";
        assert!(m.blind_transfer_request("2002", from, "sip:2002@pbx").is_err());
        let mut m = active_manager_with_peer("1000");
        assert!(m.blind_transfer_request("sip:2002@pbx", from, "sip:2002@pbx").is_err());
        assert!(m.blind_transfer_request("12", from, "sip:12@pbx").is_err());
        // Double REFER while one is in flight is rejected.
        m.blind_transfer_request("2002", from, "sip:2002@pbx.example.com").unwrap();
        assert!(m.blind_transfer_request("2003", from, "sip:2003@pbx.example.com").is_err());
    }

    #[test]
    fn attended_transfer_consult_hold_refer_replaces_both_retire() {
        let mut m = active_manager_with_peer("1000");
        let from = "sip:2001@pbx.example.com";
        // Consultation: primary held (sendonly), second dialog dials.
        let (hold_req, consult_inv) = m.consult("2002", from).unwrap();
        assert!(hold_req.contains("a=sendonly"), "{hold_req}");
        assert!(consult_inv.starts_with("INVITE sip:2002"), "{consult_inv}");
        assert_eq!(m.leg_state(WhichLeg::Primary), CallStateNative::Held);
        assert_eq!(m.leg_state(WhichLeg::Second), CallStateNative::OutgoingRinging);
        // Consult answers: media moves, still exactly one active stream.
        let offer = SdpOffer::parse(SECURE_OFFER).unwrap();
        let answer = SdpOffer::answer_for(&offer, "1 AES_CM_128_HMAC_SHA1_80 inline:QUJDMTIzNDU2Nzg5MEFCQ0RFRjEyMzQ=".into()).unwrap();
        let ack = m.on_consult_answer(&answer.to_string()).unwrap();
        assert!(ack.starts_with("ACK"), "{ack}");
        assert_eq!(m.foreground(), WhichLeg::Second);
        assert_eq!(m.rtp_active_legs(), 1, "held primary + active consult = one stream");
        // REFER with Replaces joins the consult dialog at the target.
        let refer = m.attended_transfer_request(from, "sip:2002@pbx.example.com").unwrap();
        assert!(refer.starts_with("REFER"), "{refer}");
        assert!(refer.contains("Referred-By:"), "{refer}");
        assert!(refer.contains("Replaces:"), "{refer}");
        let replaces_value = refer
            .lines()
            .find_map(|l| l.strip_prefix("Replaces:"))
            .unwrap()
            .trim();
        assert!(
            crate::sip_core::dialog::Replaces::parse(replaces_value).is_some(),
            "{refer}"
        );
        // Duplex completion: 202 + final NOTIFY retires BOTH legs.
        m.on_refer_accepted(202).unwrap();
        m.on_transfer_notify("SIP/2.0 200 OK\r\n\r\n").unwrap();
        assert!(m.media_released(), "zero orphans after attended transfer");
        assert_eq!(m.state(), CallStateNative::Idle);
        assert!(!m.has_second());
        let evs = m.take_events();
        assert_eq!(
            evs.iter()
                .filter(|e| matches!(e, CallEvent::Ended { reason, .. } if reason == "transferred"))
                .count(),
            2,
            "both legs retire as transferred: {evs:?}"
        );
    }

    #[test]
    fn attended_transfer_requires_held_primary_and_answered_consult() {
        let mut m = active_manager_with_peer("1000");
        let from = "sip:2001@pbx.example.com";
        m.consult("2002", from).unwrap();
        // Consult not answered yet: REFER refused.
        assert!(m.attended_transfer_request(from, "sip:2002@pbx.example.com").is_err());
        // Consult fails: primary resumes as foreground, no orphans.
        m.on_failure_for(WhichLeg::Second, 486).unwrap();
        assert_eq!(m.foreground(), WhichLeg::Primary);
        assert_eq!(m.state(), CallStateNative::Active);
        assert!(!m.has_second());
    }

    #[test]
    fn inbound_refer_accepted_with_202_and_event() {
        let mut m = active_manager_with_peer("1000");
        let resp = m.on_refer_received("cid-primary", "sip:2002@pbx.example.com");
        assert!(resp.starts_with("SIP/2.0 202"), "{resp}");
        let evs = m.take_events();
        assert!(evs.iter().any(|e| matches!(
            e,
            CallEvent::TransferRequested { refer_to, .. } if refer_to == "sip:2002@pbx.example.com"
        )));
        // Early (non-established) dialogs cannot be transferred: 488.
        let mut m2 = CallManager::with_audio(true);
        m2.on_invite_received("cid-early", 1, "br-early", "1000", SECURE_OFFER);
        let resp2 = m2.on_refer_received("cid-early", "sip:2002@pbx.example.com");
        assert!(resp2.contains("488"), "{resp2}");
    }

    #[test]
    fn bye_routed_by_call_id_with_two_dialogs() {
        let mut m = active_manager_with_peer("1000");
        m.on_invite_received("cid-wait", 1, "br-wait", "1001", SECURE_OFFER);
        let from = "sip:2001@pbx.example.com";
        m.answer_waiting(from).unwrap();
        m.take_events();
        // Peer BYE on the primary (held) leg: only that leg ends.
        m.on_bye_for("cid-primary").unwrap();
        assert!(m.find_leg("cid-primary").is_none());
        assert_eq!(m.leg_state(WhichLeg::Second), CallStateNative::Active);
        assert!(!m.media_released());
        // Unknown Call-ID fails closed, never touches a leg.
        assert!(m.on_bye_for("cid-ghost").is_err());
        assert!(m.on_cancel_for("cid-ghost").is_err());
    }
}
