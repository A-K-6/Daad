//! Sans-io SIP dialog state machine.
//!
//! Covers the native INVITE lifecycle: INVITE -> 100 Trying -> 180/183 ->
//! 200 OK -> ACK, plus CANCEL (pre-200), BYE (post-ACK), 486 busy, 603
//! decline, 487 cancelled, and 488 for SRTP/codec mismatch. No sockets here:
//! the transport delivers messages and this module decides state + response.

use std::collections::HashMap;

#[derive(Debug, thiserror::Error)]
pub enum DialogError {
    #[error("unexpected message in state {0:?}")]
    BadState(DialogState),
    #[error("CANCEL is only valid before a final response")]
    CancelTooLate,
    #[error("BYE is only valid for an established dialog")]
    ByeTooEarly,
}

/// Stable dialog states (RFC 3261 §12 + INVITE client/server transactions).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DialogState {
    /// INVITE sent/received, no provisional yet.
    Calling,
    /// 100 Trying seen/sent.
    Proceeding,
    /// 180 Ringing or 183 Session Progress.
    Ringing,
    /// 200 OK + ACK exchanged.
    Active,
    /// Active but media on hold (re-INVITE direction attrs).
    Held,
    /// Local CANCEL sent, awaiting 487.
    Cancelling,
    /// Local BYE sent.
    ByeSent,
    /// Dialog finished with a reason.
    Terminated(TerminationReason),
    /// Dialog failed with a final non-2xx code.
    Failed(u16),
}

/// Why a dialog ended. Used for history + `ended` events.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminationReason {
    LocalBye,
    RemoteBye,
    LocalCancel,
    RemoteCancel,
    Busy,
    Declined,
    Missed,
    Failed(u16),
    Replaced,
    Transferred,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DialogRole {
    Caller,
    Callee,
}

/// What the local teardown path must send on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TeardownAction {
    SendCancel,
    SendBye,
    /// Already terminated/failed: emit nothing (CANCEL/BYE race loser).
    NoOp,
}

/// Disposition of an inbound INVITE after dedup + busy checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InviteDisposition {
    /// Fresh transaction: create dialog, send 100, ring.
    New,
    /// Retransmission of a known transaction: resend last response code.
    DuplicateRetransmit(u16),
    /// Already in a call: answer 486 Busy Here.
    BusyHere,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct InviteKey {
    call_id: String,
    cseq: u32,
    branch: String,
}

/// Duplicate-INVITE protection: remembers the last response sent per
/// (Call-ID, CSeq, Via-branch) so retransmitted INVITEs never create a
/// second dialog and instead get the stored response re-emitted.
#[derive(Debug, Default)]
pub struct InviteDedupCache {
    last_response: HashMap<InviteKey, u16>,
}

impl InviteDedupCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record an inbound INVITE. Returns the disposition; `busy` should be
    /// true when the endpoint already owns an active dialog.
    pub fn note_invite(
        &mut self,
        call_id: &str,
        cseq: u32,
        branch: &str,
        busy: bool,
    ) -> InviteDisposition {
        let key = InviteKey {
            call_id: call_id.to_string(),
            cseq,
            branch: branch.to_string(),
        };
        if let Some(code) = self.last_response.get(&key) {
            return InviteDisposition::DuplicateRetransmit(*code);
        }
        if busy {
            self.last_response.insert(key, 486);
            return InviteDisposition::BusyHere;
        }
        InviteDisposition::New
    }

    /// Remember the last response emitted for a transaction so duplicates
    /// can be answered without new state.
    pub fn store_response(&mut self, call_id: &str, cseq: u32, branch: &str, code: u16) {
        self.last_response.insert(
            InviteKey {
                call_id: call_id.to_string(),
                cseq,
                branch: branch.to_string(),
            },
            code,
        );
    }

    pub fn forget(&mut self, call_id: &str, cseq: u32, branch: &str) {
        self.last_response.remove(&InviteKey {
            call_id: call_id.to_string(),
            cseq,
            branch: branch.to_string(),
        });
    }
}

/// One SIP dialog (one call leg).
#[derive(Debug)]
pub struct SipDialog {
    pub call_id: String,
    pub role: DialogRole,
    pub state: DialogState,
    pub remote_tag: Option<String>,
    pub cseq: u32,
    /// Last provisional/final code emitted (for retransmit + tests).
    pub last_response_code: Option<u16>,
}

impl SipDialog {
    pub fn new_outgoing(call_id: String) -> Self {
        Self {
            call_id,
            role: DialogRole::Caller,
            state: DialogState::Calling,
            remote_tag: None,
            cseq: 1,
            last_response_code: None,
        }
    }

    pub fn new_incoming(call_id: String) -> Self {
        Self {
            call_id,
            role: DialogRole::Callee,
            state: DialogState::Calling,
            remote_tag: None,
            cseq: 1,
            last_response_code: Some(100),
        }
    }

    fn ensure(&self, allowed: &[DialogState]) -> Result<(), DialogError> {
        if allowed.contains(&self.state) {
            Ok(())
        } else {
            Err(DialogError::BadState(self.state))
        }
    }

    /// Provisional from peer (caller) or emit (callee): 100/180/183.
    pub fn note_provisional(&mut self, code: u16) -> Result<(), DialogError> {
        match code {
            100 => {
                self.ensure(&[DialogState::Calling])?;
                self.state = DialogState::Proceeding;
            }
            180 | 183 => {
                self.ensure(&[DialogState::Calling, DialogState::Proceeding])?;
                self.state = DialogState::Ringing;
            }
            _ => return Err(DialogError::BadState(self.state)),
        }
        self.last_response_code = Some(code);
        Ok(())
    }

    /// Final 2xx: dialog becomes Active once ACK is exchanged.
    pub fn note_success(&mut self) -> Result<(), DialogError> {
        self.ensure(&[
            DialogState::Calling,
            DialogState::Proceeding,
            DialogState::Ringing,
        ])?;
        self.state = DialogState::Active;
        self.last_response_code = Some(200);
        Ok(())
    }

    /// Final non-2xx (486/603/487/488/...).
    pub fn note_failure(&mut self, code: u16) -> Result<(), DialogError> {
        self.ensure(&[
            DialogState::Calling,
            DialogState::Proceeding,
            DialogState::Ringing,
            DialogState::Cancelling,
        ])?;
        if code == 487
            && matches!(
                self.state,
                DialogState::Cancelling | DialogState::Calling | DialogState::Proceeding
            )
        {
            self.state = DialogState::Terminated(TerminationReason::LocalCancel);
        } else if code == 486 {
            self.state = DialogState::Failed(486);
        } else {
            self.state = DialogState::Failed(code);
        }
        self.last_response_code = Some(code);
        Ok(())
    }

    /// Local user hangs up: CANCEL before 200, BYE after ACK, NoOp when done.
    /// This is where CANCEL/BYE races are serialized: the first teardown
    /// wins and moves state; the second sees a terminal state and is a NoOp.
    pub fn local_teardown(&mut self) -> TeardownAction {
        match self.state {
            DialogState::Calling | DialogState::Proceeding | DialogState::Ringing => {
                self.state = DialogState::Cancelling;
                TeardownAction::SendCancel
            }
            DialogState::Active | DialogState::Held => {
                self.state = DialogState::ByeSent;
                TeardownAction::SendBye
            }
            _ => TeardownAction::NoOp,
        }
    }

    /// Peer CANCEL arrived (valid only pre-200). Returns true if it
    /// terminated the dialog (485...487 path); false if too late.
    pub fn remote_cancel(&mut self) -> bool {
        match self.state {
            DialogState::Calling | DialogState::Proceeding | DialogState::Ringing => {
                self.state = DialogState::Terminated(TerminationReason::RemoteCancel);
                self.last_response_code = Some(487);
                true
            }
            _ => false,
        }
    }

    /// Peer BYE arrived (valid only for established dialogs).
    pub fn remote_bye(&mut self) -> bool {
        match self.state {
            DialogState::Active | DialogState::Held => {
                self.state = DialogState::Terminated(TerminationReason::RemoteBye);
                true
            }
            _ => false,
        }
    }

    /// Incoming INVITE rang but the caller gave up before answer: missed.
    pub fn note_missed(&mut self) {
        if matches!(
            self.state,
            DialogState::Calling | DialogState::Proceeding | DialogState::Ringing
        ) {
            self.state = DialogState::Terminated(TerminationReason::Missed);
        }
    }

    /// Callee answered: send 200 (dialog active after ACK).
    pub fn answer(&mut self) -> Result<(), DialogError> {
        self.ensure(&[
            DialogState::Calling,
            DialogState::Proceeding,
            DialogState::Ringing,
        ])?;
        self.note_success()
    }

    /// Callee rejected: 486 busy or 603 decline.
    pub fn reject(&mut self, busy: bool) -> u16 {
        let code = if busy { 486 } else { 603 };
        self.state = if busy {
            DialogState::Terminated(TerminationReason::Busy)
        } else {
            DialogState::Terminated(TerminationReason::Declined)
        };
        self.last_response_code = Some(code);
        code
    }

    /// Re-INVITE hold accepted.
    pub fn hold(&mut self) -> Result<(), DialogError> {
        self.ensure(&[DialogState::Active])?;
        self.state = DialogState::Held;
        Ok(())
    }

    /// Re-INVITE resume accepted.
    pub fn resume(&mut self) -> Result<(), DialogError> {
        self.ensure(&[DialogState::Held])?;
        self.state = DialogState::Active;
        Ok(())
    }

    /// Transfer completed (final 2xx NOTIFY sipfrag on our REFER): the leg
    /// retires as transferred; the peer owns the new dialog from here.
    pub fn note_transferred(&mut self) {
        if matches!(self.state, DialogState::Active | DialogState::Held) {
            self.state = DialogState::Terminated(TerminationReason::Transferred);
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self.state,
            DialogState::Terminated(_) | DialogState::Failed(_)
        )
    }

    // -- Minimal message builders (sans-io; transport-agnostic) ----------

    pub fn build_invite_request(&self, from_uri: &str, to_ext: &str, sdp: &str) -> String {
        format!(
            "INVITE sip:{to} SIP/2.0\r\n\
             Via: SIP/2.0/TLS local;branch={branch}\r\n\
             From: <{from}>;tag={ltag}\r\n\
             To: <sip:{to}>\r\n\
             Call-ID: {cid}\r\n\
             CSeq: {cseq} INVITE\r\n\
             Contact: <{from}>\r\n\
             Content-Type: application/sdp\r\n\
             Content-Length: {len}\r\n\
             \r\n\
             {sdp}",
            to = to_ext,
            branch = branch_for(&self.call_id, self.cseq),
            from = from_uri,
            ltag = local_tag(&self.call_id),
            cid = self.call_id,
            cseq = self.cseq,
            len = sdp.len(),
        )
    }

    pub fn build_response(&self, code: u16, reason: &str, sdp: Option<&str>) -> String {
        let body = sdp.unwrap_or("");
        format!(
            "SIP/2.0 {code} {reason}\r\n\
             Call-ID: {cid}\r\n\
             CSeq: {cseq} INVITE\r\n\
             Content-Type: application/sdp\r\n\
             Content-Length: {len}\r\n\
             \r\n\
             {body}",
            cid = self.call_id,
            cseq = self.cseq,
            len = body.len(),
        )
    }

    pub fn build_ack(&self) -> String {
        format!(
            "ACK sip:peer SIP/2.0\r\nCall-ID: {cid}\r\nCSeq: {cseq} ACK\r\nContent-Length: 0\r\n\r\n",
            cid = self.call_id,
            cseq = self.cseq,
        )
    }

    pub fn build_bye(&self) -> String {
        format!(
            "BYE sip:peer SIP/2.0\r\nCall-ID: {cid}\r\nCSeq: {cseq} BYE\r\nContent-Length: 0\r\n\r\n",
            cid = self.call_id,
            cseq = self.cseq + 1,
        )
    }

    pub fn build_cancel(&self) -> String {
        format!(
            "CANCEL sip:peer SIP/2.0\r\nCall-ID: {cid}\r\nCSeq: {cseq} CANCEL\r\nContent-Length: 0\r\n\r\n",
            cid = self.call_id,
            cseq = self.cseq,
        )
    }

    /// In-dialog re-INVITE (hold/resume): CSeq is bumped so the UAS treats
    /// it as a fresh offer, never a retransmission of the original INVITE.
    pub fn build_reinvite(&mut self, from_uri: &str, to_ext: &str, sdp: &str) -> String {
        self.cseq += 1;
        self.build_invite_request(from_uri, to_ext, sdp)
    }

    /// In-dialog REFER for call transfer (RFC 3515). `refer_to` is the
    /// transfer target (`sip:<ext>` short form accepted), `referred_by` is
    /// the local AoR, and `replaces` carries the consult dialog for
    /// attended transfer (RFC 3891). CSeq is bumped like a re-INVITE.
    pub fn build_refer(
        &mut self,
        refer_to: &str,
        referred_by: &str,
        replaces: Option<&Replaces>,
    ) -> String {
        self.cseq += 1;
        let mut req = format!(
            "REFER sip:peer SIP/2.0\r\n\
             Call-ID: {cid}\r\n\
             CSeq: {cseq} REFER\r\n\
             Refer-To: <{to}>\r\n\
             Referred-By: <{by}>\r\n",
            cid = self.call_id,
            cseq = self.cseq,
            to = refer_to,
            by = referred_by,
        );
        if let Some(r) = replaces {
            req.push_str(&format!("Replaces: {}\r\n", r.encode()));
        }
        req.push_str("Content-Length: 0\r\n\r\n");
        req
    }

    /// Dialog identifiers for the consult leg in an attended-transfer
    /// `Replaces` header (RFC 3891 §3): `call-id;from-tag=..;to-tag=..`.
    /// Percent-escapes `;`/`?` inside values so parsing round-trips.
    pub fn replaces_for(&self, from_tag: &str, to_tag: &str) -> Replaces {
        Replaces {
            call_id: self.call_id.clone(),
            from_tag: from_tag.to_string(),
            to_tag: to_tag.to_string(),
        }
    }
}

/// RFC 3891 `Replaces` header value (attended transfer join).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Replaces {
    pub call_id: String,
    pub from_tag: String,
    pub to_tag: String,
}

impl Replaces {
    fn escape(s: &str) -> String {
        s.replace('%', "%25").replace(';', "%3B").replace('?', "%3F")
    }

    fn unescape(s: &str) -> String {
        s.replace("%3B", ";")
            .replace("%3b", ";")
            .replace("%3F", "?")
            .replace("%3f", "?")
            .replace("%25", "%")
    }

    pub fn encode(&self) -> String {
        format!(
            "{};from-tag={};to-tag={}",
            Self::escape(&self.call_id),
            Self::escape(&self.from_tag),
            Self::escape(&self.to_tag),
        )
    }

    /// Parse a `Replaces` value; `None` on malformed input (fail-closed —
    /// the transfer is aborted, never attempted with half identifiers).
    pub fn parse(raw: &str) -> Option<Self> {
        let raw = raw.trim();
        let (call_id, params) = raw.split_once(';')?;
        let call_id = call_id.trim();
        if call_id.is_empty() {
            return None;
        }
        let mut from_tag = None;
        let mut to_tag = None;
        for p in params.split(';') {
            let (k, v) = p.split_once('=')?;
            match k.trim().to_ascii_lowercase().as_str() {
                "from-tag" => from_tag = Some(Self::unescape(v.trim())),
                "to-tag" => to_tag = Some(Self::unescape(v.trim())),
                _ => {}
            }
        }
        Some(Self {
            call_id: call_id.to_string(),
            from_tag: from_tag.filter(|s| !s.is_empty())?,
            to_tag: to_tag.filter(|s| !s.is_empty())?,
        })
    }
}

/// Outcome of a transfer-progress NOTIFY with a `message/sipfrag` body
/// (RFC 3515 §2.4.2): the status line of the transfer-target dialog.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferProgress {
    /// Provisional at the target (e.g. 100 Trying, 180 Ringing): keep waiting.
    Trying(u16),
    /// Final success (2xx): the target answered, our legs may retire.
    Completed(u16),
    /// Final failure (3xx–6xx): the transfer failed, our leg stays up.
    Failed(u16),
}

/// Parse the first `SIP/2.0 <code>` line of a NOTIFY sipfrag body.
/// `None` when absent (fail-closed: treated as no progress, never success).
pub fn parse_transfer_notify(body: &str) -> Option<TransferProgress> {
    for line in body.lines() {
        let t = line.trim();
        if let Some(rest) = t
            .strip_prefix("SIP/2.0")
            .or_else(|| t.strip_prefix("SIP/2.0 "))
        {
            let rest = rest.trim();
            if let Ok(code) = rest.split_whitespace().next().unwrap_or("").parse::<u16>() {
                if (100..200).contains(&code) {
                    return Some(TransferProgress::Trying(code));
                } else if (200..300).contains(&code) {
                    return Some(TransferProgress::Completed(code));
                } else if code >= 300 {
                    return Some(TransferProgress::Failed(code));
                }
            }
            return None;
        }
    }
    None
}

fn branch_for(call_id: &str, cseq: u32) -> String {
    let n: u32 = call_id
        .bytes()
        .fold(0u32, |a, b| a.wrapping_add(b as u32))
        .wrapping_add(cseq);
    format!("z9hG4bK{n:08x}")
}

fn local_tag(call_id: &str) -> &str {
    &call_id[..call_id.len().min(8)]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outgoing_full_lifecycle() {
        let mut d = SipDialog::new_outgoing("abc12345".into());
        d.note_provisional(100).unwrap();
        assert_eq!(d.state, DialogState::Proceeding);
        d.note_provisional(180).unwrap();
        assert_eq!(d.state, DialogState::Ringing);
        d.note_success().unwrap();
        assert_eq!(d.state, DialogState::Active);
        assert_eq!(d.local_teardown(), TeardownAction::SendBye);
    }

    #[test]
    fn early_hangup_sends_cancel() {
        let mut d = SipDialog::new_outgoing("call-1".into());
        assert_eq!(d.local_teardown(), TeardownAction::SendCancel);
        assert_eq!(d.state, DialogState::Cancelling);
        d.note_failure(487).unwrap();
        assert_eq!(
            d.state,
            DialogState::Terminated(TerminationReason::LocalCancel)
        );
    }

    #[test]
    fn duplicate_invite_retransmits_without_new_dialog() {
        let mut cache = InviteDedupCache::new();
        assert_eq!(
            cache.note_invite("cid-1", 1, "br-1", false),
            InviteDisposition::New
        );
        cache.store_response("cid-1", 1, "br-1", 180);
        assert_eq!(
            cache.note_invite("cid-1", 1, "br-1", false),
            InviteDisposition::DuplicateRetransmit(180)
        );
    }

    #[test]
    fn busy_when_already_in_call() {
        let mut cache = InviteDedupCache::new();
        assert_eq!(
            cache.note_invite("cid-2", 1, "br-9", true),
            InviteDisposition::BusyHere
        );
        // Retransmit of the busy transaction replays 486, not a new dialog.
        assert_eq!(
            cache.note_invite("cid-2", 1, "br-9", true),
            InviteDisposition::DuplicateRetransmit(486)
        );
    }

    #[test]
    fn cancel_bye_race_first_wins() {
        // Local CANCEL sent; a late peer BYE must not resurrect the dialog.
        let mut d = SipDialog::new_outgoing("race-1".into());
        assert_eq!(d.local_teardown(), TeardownAction::SendCancel);
        assert!(!d.remote_bye());
        d.note_failure(487).unwrap();
        assert!(d.is_terminal());
        // Second teardown after terminal state is a NoOp (race loser).
        assert_eq!(d.local_teardown(), TeardownAction::NoOp);
    }

    #[test]
    fn bye_after_active_beats_late_cancel() {
        let mut d = SipDialog::new_outgoing("race-2".into());
        d.note_provisional(100).unwrap();
        d.note_success().unwrap();
        assert_eq!(d.local_teardown(), TeardownAction::SendBye);
        // CANCEL arriving after establishment is invalid: remote_cancel fails.
        assert!(!d.remote_cancel());
    }

    #[test]
    fn missed_call_when_caller_gives_up() {
        let mut d = SipDialog::new_incoming("miss-1".into());
        d.note_provisional(180).unwrap();
        d.note_missed();
        assert_eq!(
            d.state,
            DialogState::Terminated(TerminationReason::Missed)
        );
    }

    #[test]
    fn reject_codes() {
        let mut d = SipDialog::new_incoming("rej-1".into());
        assert_eq!(d.reject(true), 486);
        let mut d2 = SipDialog::new_incoming("rej-2".into());
        assert_eq!(d2.reject(false), 603);
    }

    #[test]
    fn message_builders_roundtrip_headers() {
        let d = SipDialog::new_outgoing("hdr-call".into());
        let inv = d.build_invite_request("sip:1000@pbx", "2001", "v=0");
        assert!(inv.starts_with("INVITE sip:2001"));
        assert!(inv.contains("Call-ID: hdr-call"));
        let bye = d.build_bye();
        assert!(bye.starts_with("BYE"));
        let cancel = d.build_cancel();
        assert!(cancel.starts_with("CANCEL"));
    }

    #[test]
    fn reinvite_bumps_cseq() {
        let mut d = SipDialog::new_outgoing("re-1".into());
        let first = d.build_invite_request("sip:1000@pbx", "2001", "v=0");
        assert!(first.contains("CSeq: 1 INVITE"));
        let re = d.build_reinvite("sip:1000@pbx", "2001", "v=0");
        assert!(re.starts_with("INVITE sip:2001"));
        assert!(re.contains("CSeq: 2 INVITE"));
        assert_ne!(first, re, "re-INVITE must not look like a retransmission");
    }

    #[test]
    fn refer_carries_referred_by_and_bumps_cseq() {
        let mut d = SipDialog::new_outgoing("refer-1".into());
        d.note_provisional(100).unwrap();
        d.note_success().unwrap();
        let refer = d.build_refer("sip:2002@pbx", "sip:1000@pbx", None);
        assert!(refer.starts_with("REFER"), "{refer}");
        assert!(refer.contains("Call-ID: refer-1"), "{refer}");
        assert!(refer.contains("CSeq: 2 REFER"), "{refer}");
        assert!(refer.contains("Refer-To: <sip:2002@pbx>"), "{refer}");
        assert!(refer.contains("Referred-By: <sip:1000@pbx>"), "{refer}");
        assert!(!refer.contains("Replaces:"), "{refer}");
    }

    #[test]
    fn refer_with_replaces_for_attended() {
        let consult = SipDialog::new_outgoing("consult-9".into());
        let replaces = consult.replaces_for("aaa111", "bbb222");
        let mut d = SipDialog::new_outgoing("primary-1".into());
        d.note_success().unwrap();
        let refer = d.build_refer("sip:2002@pbx", "sip:1000@pbx", Some(&replaces));
        assert!(refer.contains("Replaces: consult-9;from-tag=aaa111;to-tag=bbb222"), "{refer}");
        // Round-trip through the parser (what the PBX / target sees).
        let value = refer
            .lines()
            .find_map(|l| l.strip_prefix("Replaces:"))
            .unwrap()
            .trim();
        assert_eq!(Replaces::parse(value), Some(replaces));
    }

    #[test]
    fn replaces_parse_fails_closed() {
        assert!(Replaces::parse("").is_none());
        assert!(Replaces::parse("no-params-here").is_none());
        assert!(Replaces::parse("cid;from-tag=;to-tag=x").is_none());
        assert!(Replaces::parse("cid;from-tag=x").is_none());
        let r = Replaces::parse("cid-1;from-tag=a%3Bb;to-tag=c").unwrap();
        assert_eq!(r.from_tag, "a;b");
        assert_eq!(r.call_id, "cid-1");
    }

    #[test]
    fn transfer_notify_status_lines() {
        assert_eq!(
            parse_transfer_notify("SIP/2.0 100 Trying\r\n\r\n"),
            Some(TransferProgress::Trying(100))
        );
        assert_eq!(
            parse_transfer_notify("SIP/2.0 180 Ringing\r\n\r\n"),
            Some(TransferProgress::Trying(180))
        );
        assert_eq!(
            parse_transfer_notify("SIP/2.0 200 OK\r\n\r\n"),
            Some(TransferProgress::Completed(200))
        );
        assert_eq!(
            parse_transfer_notify("SIP/2.0 603 Decline\r\n\r\n"),
            Some(TransferProgress::Failed(603))
        );
        assert_eq!(parse_transfer_notify(""), None);
        assert_eq!(parse_transfer_notify("garbage"), None);
    }
}
