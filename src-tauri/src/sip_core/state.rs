//! Account and call state machines, driven by real transactions.
//!
//! Every transition is an explicit `(state, event) -> state` edge. Anything
//! not listed is rejected — the UI can never observe an impossible state
//! (e.g. `Registered` without a prior `200 OK`).

/// Account lifecycle.
///
/// ```text
/// Disabled → Connecting → Registering → Registered ⇄ Refreshing
///     ↑           ↓             ↓             ↓
///     └── Reconnecting ←── NetUnavailable / CertFailed / AuthFailed
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountState {
    Disabled,
    Connecting,
    Registering,
    Registered,
    Refreshing,
    Reconnecting,
    AuthFailed,
    CertFailed,
    NetUnavailable,
}

/// Events produced by real transport / registrar transactions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountEvent {
    EnableRequested,
    TcpConnected,
    RegisterSent,
    /// Registrar `200 OK` to REGISTER.
    RegisterAccepted,
    /// Refresh re-REGISTER sent before expiry.
    RefreshDue,
    /// Registrar `200 OK` to the refresh.
    RefreshAccepted,
    /// Registrar `401/407` challenge answered and accepted path continues;
    /// repeated failures surface as `AuthRejected`.
    AuthRejected,
    /// TLS verification failure (fail-closed, never retried silently).
    CertError,
    /// Socket/connect failure.
    NetError,
    /// `Expires: 0` unregister accepted, or local disable.
    Unregistered,
    DisableRequested,
    /// Backoff elapsed, retry the transport.
    RetryTimerFired,
}

impl AccountState {
    pub fn transition(self, ev: AccountEvent) -> Result<Self, String> {
        use AccountEvent as E;
        use AccountState as S;
        let next = match (self, ev) {
            (S::Disabled, E::EnableRequested) => S::Connecting,
            (S::Connecting, E::TcpConnected) => S::Registering,
            (S::Connecting, E::NetError) => S::NetUnavailable,
            (S::Connecting, E::CertError) => S::CertFailed,
            (S::Connecting, E::DisableRequested) => S::Disabled,
            (S::Registering, E::RegisterSent) => S::Registering,
            (S::Registering, E::RegisterAccepted) => S::Registered,
            (S::Registering, E::AuthRejected) => S::AuthFailed,
            (S::Registering, E::CertError) => S::CertFailed,
            (S::Registering, E::NetError) => S::NetUnavailable,
            (S::Registering, E::DisableRequested) => S::Disabled,
            (S::Registered, E::RefreshDue) => S::Refreshing,
            (S::Registered, E::Unregistered) => S::Disabled,
            (S::Registered, E::NetError) => S::Reconnecting,
            (S::Registered, E::DisableRequested) => S::Disabled,
            (S::Refreshing, E::RefreshAccepted) => S::Registered,
            (S::Refreshing, E::RegisterSent) => S::Refreshing,
            (S::Refreshing, E::AuthRejected) => S::AuthFailed,
            (S::Refreshing, E::NetError) => S::Reconnecting,
            (S::Refreshing, E::DisableRequested) => S::Disabled,
            (S::Reconnecting, E::RetryTimerFired) => S::Connecting,
            (S::Reconnecting, E::DisableRequested) => S::Disabled,
            (S::NetUnavailable, E::RetryTimerFired) => S::Connecting,
            (S::NetUnavailable, E::DisableRequested) => S::Disabled,
            (S::AuthFailed, E::EnableRequested) => S::Connecting,
            (S::AuthFailed, E::DisableRequested) => S::Disabled,
            (S::CertFailed, E::EnableRequested) => S::Connecting,
            (S::CertFailed, E::DisableRequested) => S::Disabled,
            _ => {
                return Err(format!("invalid account transition: {self:?} + {ev:?}"));
            }
        };
        Ok(next)
    }

    /// `true` once the registrar has accepted us (steady-state or refresh).
    pub fn is_registered(self) -> bool {
        matches!(self, Self::Registered | Self::Refreshing)
    }
}

/// Call lifecycle. Outgoing and incoming legs are explicit states so
/// CANCEL/BYE races resolve deterministically (see [`CallEvent`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallStateNative {
    Idle,
    /// INVITE sent, waiting for provisional.
    OutgoingStarting,
    /// `180 Ringing` received (or `183` early media).
    Ringing,
    IncomingRinging,
    /// `200 OK` to incoming INVITE sent, waiting for ACK.
    Answering,
    Active,
    Ending,
    Ended,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallEvent {
    InviteSent,
    /// `180`/`183` provisional.
    Provisional,
    /// `200 OK` (outgoing answered) / ACK received (incoming).
    Success,
    /// Remote `486 Busy` / `603 Decline` / `487` etc.
    RemoteReject,
    /// Local user hangs up / declines.
    LocalEnd,
    /// INVITE arrived from the network.
    IncomingInvite,
    /// Local user accepts the incoming call.
    Answer,
    /// CANCEL wins the race (no `200 OK` seen yet).
    CancelRaceWon,
    /// `200 OK` arrived before our CANCEL hit the wire — CANCEL is void;
    /// the leg must end with BYE instead.
    CancelRaceLost,
    ByeSent,
    ByeReceived,
    TransportLost,
}

impl CallStateNative {
    pub fn transition(self, ev: CallEvent) -> Result<Self, String> {
        use CallEvent as E;
        use CallStateNative as S;
        let next = match (self, ev) {
            (S::Idle, E::InviteSent) => S::OutgoingStarting,
            (S::Idle, E::IncomingInvite) => S::IncomingRinging,
            (S::OutgoingStarting, E::Provisional) => S::Ringing,
            (S::OutgoingStarting, E::Success) => S::Active,
            (S::OutgoingStarting, E::RemoteReject) => S::Ended,
            (S::OutgoingStarting, E::LocalEnd) => S::Ending,
            (S::OutgoingStarting, E::CancelRaceLost) => S::Active,
            (S::Ringing, E::Success) => S::Active,
            (S::Ringing, E::RemoteReject) => S::Ended,
            (S::Ringing, E::LocalEnd) => S::Ending,
            (S::Ringing, E::CancelRaceLost) => S::Active,
            (S::IncomingRinging, E::Answer) => S::Answering,
            (S::IncomingRinging, E::LocalEnd) => S::Ended,
            (S::IncomingRinging, E::RemoteReject) => S::Ended,
            (S::IncomingRinging, E::TransportLost) => S::Ended,
            (S::Answering, E::Success) => S::Active,
            (S::Answering, E::RemoteReject) => S::Ended,
            (S::Answering, E::TransportLost) => S::Ended,
            (S::Active, E::LocalEnd) => S::Ending,
            (S::Active, E::ByeReceived) => S::Ended,
            (S::Active, E::TransportLost) => S::Ended,
            (S::Ending, E::ByeSent) => S::Ended,
            (S::Ending, E::ByeReceived) => S::Ended,
            (S::Ending, E::CancelRaceWon) => S::Ended,
            (S::Ending, E::CancelRaceLost) => S::Ending,
            (S::Ended, E::InviteSent) => S::OutgoingStarting,
            (S::Ended, E::IncomingInvite) => S::IncomingRinging,
            _ => return Err(format!("invalid call transition: {self:?} + {ev:?}")),
        };
        Ok(next)
    }

    /// Resolve a CANCEL-vs-200 race: `saw_200_ok == true` means the UAS
    /// already accepted, so CANCEL is void and BYE is required.
    pub fn resolve_cancel_race(saw_200_ok: bool) -> CallEvent {
        if saw_200_ok {
            CallEvent::CancelRaceLost
        } else {
            CallEvent::CancelRaceWon
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_happy_path() {
        let s = AccountState::Disabled
            .transition(AccountEvent::EnableRequested).unwrap()
            .transition(AccountEvent::TcpConnected).unwrap()
            .transition(AccountEvent::RegisterSent).unwrap()
            .transition(AccountEvent::RegisterAccepted).unwrap();
        assert_eq!(s, AccountState::Registered);
        assert!(s.is_registered());
        // Refresh cycle stays registered.
        let s = s.transition(AccountEvent::RefreshDue).unwrap();
        assert_eq!(s, AccountState::Refreshing);
        assert!(s.is_registered());
        let s = s.transition(AccountEvent::RefreshAccepted).unwrap();
        assert_eq!(s, AccountState::Registered);
    }

    #[test]
    fn account_distinguishes_connected_from_accepted() {
        // TCP-connected is Registering, NOT Registered.
        let s = AccountState::Disabled
            .transition(AccountEvent::EnableRequested).unwrap()
            .transition(AccountEvent::TcpConnected).unwrap();
        assert_eq!(s, AccountState::Registering);
        assert!(!s.is_registered());
    }

    #[test]
    fn account_failure_paths() {
        assert_eq!(
            AccountState::Registering.transition(AccountEvent::AuthRejected).unwrap(),
            AccountState::AuthFailed
        );
        assert_eq!(
            AccountState::Connecting.transition(AccountEvent::CertError).unwrap(),
            AccountState::CertFailed
        );
        assert_eq!(
            AccountState::Connecting.transition(AccountEvent::NetError).unwrap(),
            AccountState::NetUnavailable
        );
        // Reconnect loop.
        let s = AccountState::NetUnavailable.transition(AccountEvent::RetryTimerFired).unwrap();
        assert_eq!(s, AccountState::Connecting);
        // Cert failure never auto-retries: requires explicit re-enable.
        assert!(AccountState::CertFailed.transition(AccountEvent::RetryTimerFired).is_err());
    }

    #[test]
    fn account_unregister_and_disable() {
        let s = AccountState::Registered.transition(AccountEvent::Unregistered).unwrap();
        assert_eq!(s, AccountState::Disabled);
        assert!(!s.is_registered());
    }

    #[test]
    fn account_rejects_impossible_transitions() {
        assert!(AccountState::Disabled.transition(AccountEvent::RegisterAccepted).is_err());
        assert!(AccountState::Registered.transition(AccountEvent::RegisterAccepted).is_err());
        assert!(AccountState::Disabled.transition(AccountEvent::RefreshDue).is_err());
    }

    #[test]
    fn outgoing_call_happy_path() {
        let s = CallStateNative::Idle
            .transition(CallEvent::InviteSent).unwrap()
            .transition(CallEvent::Provisional).unwrap();
        assert_eq!(s, CallStateNative::Ringing);
        let s = s.transition(CallEvent::Success).unwrap();
        assert_eq!(s, CallStateNative::Active);
        let s = s.transition(CallEvent::LocalEnd).unwrap();
        assert_eq!(s, CallStateNative::Ending);
        assert_eq!(s.transition(CallEvent::ByeSent).unwrap(), CallStateNative::Ended);
    }

    #[test]
    fn incoming_call_happy_path() {
        let s = CallStateNative::Idle
            .transition(CallEvent::IncomingInvite).unwrap();
        assert_eq!(s, CallStateNative::IncomingRinging);
        let s = s.transition(CallEvent::Answer).unwrap();
        assert_eq!(s, CallStateNative::Answering);
        assert_eq!(s.transition(CallEvent::Success).unwrap(), CallStateNative::Active);
    }

    #[test]
    fn cancel_wins_before_200() {
        let s = CallStateNative::OutgoingStarting
            .transition(CallEvent::LocalEnd).unwrap();
        assert_eq!(s, CallStateNative::Ending);
        let race = CallStateNative::resolve_cancel_race(false);
        assert_eq!(race, CallEvent::CancelRaceWon);
        assert_eq!(s.transition(race).unwrap(), CallStateNative::Ended);
    }

    #[test]
    fn cancel_loses_after_200_must_bye() {
        // 200 arrived first: leg is Active, CANCEL void → BYE required.
        let race = CallStateNative::resolve_cancel_race(true);
        assert_eq!(race, CallEvent::CancelRaceLost);
        let s = CallStateNative::Ringing.transition(race).unwrap();
        assert_eq!(s, CallStateNative::Active, "race lost → stay Active, end via BYE");
        assert_eq!(
            s.transition(CallEvent::LocalEnd).unwrap()
                .transition(CallEvent::ByeSent).unwrap(),
            CallStateNative::Ended
        );
    }

    #[test]
    fn bye_received_ends_active_call() {
        assert_eq!(
            CallStateNative::Active.transition(CallEvent::ByeReceived).unwrap(),
            CallStateNative::Ended
        );
    }

    #[test]
    fn call_rejects_impossible_transitions() {
        assert!(CallStateNative::Idle.transition(CallEvent::Success).is_err());
        assert!(CallStateNative::Active.transition(CallEvent::Answer).is_err());
        assert!(CallStateNative::Ended.transition(CallEvent::ByeReceived).is_err());
    }
}
