mod sip_bridge;
mod sip_core;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WindowEvent,
};
use sip_bridge::{BridgeInfo, SipBridgeManager};
use sip_core::account::{AudioCodec, MediaPolicy, SipProfile, SipTransport};
use sip_core::call::{CallDirection, CallManager, CallStateNative, WhichLeg};
use sip_core::diagnostics::{sanitize_log, SanitizedDiagnostics};
use sip_core::keystore::{CredentialStore, KeyringStore};
use sip_core::register::{self, CSeqGen, RegisterOutcome};
use sip_core::state::{AccountEvent, AccountState};
use sip_core::transport::{ReconnectPolicy, TransportSupervisor};

#[tauri::command]
async fn start_sip_bridge(
    manager: State<'_, Arc<SipBridgeManager>>,
    remote_host: String,
    remote_port: u16,
    transport: String,
    deprecated_allow_insecure: Option<bool>,
) -> Result<BridgeInfo, String> {
    // Fail-closed: the legacy insecure-skip flag is accepted for argument
    // compatibility but ALWAYS ignored — the bridge verifies TLS against
    // system roots on every connection. See `sip_bridge.rs`.
    if deprecated_allow_insecure == Some(true) {
        log::warn!("start_sip_bridge: insecure-skip requested but ignored (fail-closed TLS)");
    }
    manager.start(remote_host, remote_port, transport).await
}

#[tauri::command]
async fn stop_sip_bridge(
    manager: State<'_, Arc<SipBridgeManager>>,
) -> Result<(), String> {
    manager.stop().await;
    Ok(())
}

// ---------------------------------------------------------------------------
// Native SIP core (Phase 1): Rust owns credentials, TLS, SIP, registration.
// No password, Authorization header, SDP or key material ever crosses to the
// webview — commands exchange only validated profiles and redacted status.
// ---------------------------------------------------------------------------

/// Shared native-core state (Tauri-managed).
pub struct CoreState {
    profiles: Mutex<HashMap<String, SipProfile>>,
    account_states: Mutex<HashMap<String, AccountState>>,
    workers: Mutex<HashMap<String, tokio::task::JoinHandle<()>>>,
    supervisor: TransportSupervisor,
    reg_supervisor: register::RegistrationSupervisor,
    keystore: KeyringStore,
    cseq: CSeqGen,
    events_total: std::sync::atomic::AtomicU64,
    /// Webview handle for pushing `sip://*` events from background workers.
    /// `None` until `setup()` runs (and in unit tests). Cloned out before
    /// every emit; no guard is ever held across an await.
    app: Mutex<Option<AppHandle>>,
    /// Operator-visible failure text per account (redacted, secret-free).
    /// Set on terminal failures, cleared on enable/accept. Surfaced as
    /// `NativeSipStatus.message` so the webview shows real causes.
    status_message: Mutex<HashMap<String, String>>,
}

impl CoreState {
    fn new() -> Self {
        Self {
            profiles: Mutex::new(HashMap::new()),
            account_states: Mutex::new(HashMap::new()),
            workers: Mutex::new(HashMap::new()),
            supervisor: TransportSupervisor::new(),
            reg_supervisor: register::RegistrationSupervisor::new(),
            keystore: KeyringStore::new(),
            cseq: CSeqGen::new(),
            events_total: std::sync::atomic::AtomicU64::new(0),
            app: Mutex::new(None),
            status_message: Mutex::new(HashMap::new()),
        }
    }

    fn app_handle(&self) -> Option<AppHandle> {
        self.app.lock().unwrap().clone()
    }

    /// Record operator-visible failure text (must already be redacted).
    fn set_status_message(&self, account_id: &str, msg: impl Into<String>) {
        self.status_message.lock().unwrap().insert(account_id.to_string(), msg.into());
    }

    fn clear_status_message(&self, account_id: &str) {
        self.status_message.lock().unwrap().remove(account_id);
    }

    fn status_message_of(&self, account_id: &str) -> Option<String> {
        self.status_message.lock().unwrap().get(account_id).cloned()
    }

    fn set_app(&self, app: AppHandle) {
        *self.app.lock().unwrap() = Some(app);
    }

    /// Push the redacted single-account snapshot to webview listeners
    /// (`sip://connection-state` + `sip://cert-status`). Sync only.
    fn emit_native_status(&self) {
        let payload = native_status_of(self, NATIVE_ACCOUNT_ID);
        if let Some(app) = self.app.lock().unwrap().clone() {
            use tauri::Emitter;
            let _ = app.emit("sip://connection-state", &payload);
            let _ = app.emit("sip://cert-status", &payload.cert_status);
        }
    }

    fn apply(&self, account_id: &str, ev: AccountEvent) -> AccountState {
        self.events_total
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let next = {
            let mut states = self.account_states.lock().unwrap();
            let cur = states.get(account_id).copied().unwrap_or(AccountState::Disabled);
            match cur.transition(ev) {
                Ok(next) => {
                    states.insert(account_id.to_string(), next);
                    next
                }
                Err(e) => {
                    // Invalid edges are operator-visible but never panic the core.
                    log::warn!("core: {}", sanitize_log(&e));
                    cur
                }
            }
        };
        if account_id == NATIVE_ACCOUNT_ID {
            self.emit_native_status();
        }
        next
    }

    fn set_broken(&self, account_id: &str, state: AccountState) {
        // Terminal failure states unreachable via a valid edge (e.g. worker
        // abort) are assigned directly and logged redacted.
        self.events_total
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        self.account_states.lock().unwrap().insert(account_id.to_string(), state);
        if account_id == NATIVE_ACCOUNT_ID {
            self.emit_native_status();
        }
    }

    fn get_state(&self, account_id: &str) -> AccountState {
        self.account_states
            .lock()
            .unwrap()
            .get(account_id)
            .copied()
            .unwrap_or(AccountState::Disabled)
    }
}

/// Sanitised account summary returned to the webview (no secrets, no CA).
/// States are rendered as plain names (not serialized enums) so the
/// webview never depends on Rust enum shapes.
#[derive(Debug, Clone, serde::Serialize)]
struct AccountSummary {
    account_id: String,
    hostname: String,
    port: u16,
    transport: SipTransport,
    username_masked: String,
    expires_secs: u32,
    state: String,
}

impl AccountSummary {
    fn of(profile: &SipProfile, state: AccountState) -> Self {
        // Mask all but the last digit of the extension in UI-facing payloads.
        let masked = if profile.username.len() > 1 {
            format!(
                "{}…{}",
                "*".repeat(profile.username.len() - 1),
                &profile.username[profile.username.len() - 1..]
            )
        } else {
            "*".into()
        };
        Self {
            account_id: profile.account_id.clone(),
            hostname: profile.hostname.clone(),
            port: profile.port,
            transport: profile.transport,
            username_masked: masked,
            expires_secs: profile.expires_secs,
            state: format!("{state:?}"),
        }
    }
}

#[tauri::command]
async fn account_upsert(
    core: State<'_, Arc<CoreState>>,
    profile: SipProfile,
    password: Option<String>,
) -> Result<AccountSummary, String> {
    profile.validate()?;
    // Password goes straight to the OS keychain; it is never stored beside
    // the profile, never logged, never returned.
    if let Some(pw) = password {
        if !pw.is_empty() {
            core.keystore.store_password(&profile.account_id, &pw)?;
        }
    }
    let state = core.get_state(&profile.account_id);
    let summary = AccountSummary::of(&profile, state);
    core.profiles.lock().unwrap().insert(profile.account_id.clone(), profile);
    core.account_states.lock().unwrap().entry(summary.account_id.clone()).or_insert(AccountState::Disabled);
    Ok(summary)
}

#[tauri::command]
async fn account_remove(core: State<'_, Arc<CoreState>>, account_id: String) -> Result<(), String> {
    // Stop any running worker first (best-effort unregister happens inside).
    let _ = unregister_impl(core.inner(), &account_id).await;
    core.profiles.lock().unwrap().remove(&account_id);
    core.account_states.lock().unwrap().remove(&account_id);
    core.keystore.delete_password(&account_id)?;
    Ok(())
}

#[tauri::command]
async fn register(core: State<'_, Arc<CoreState>>, account_id: String) -> Result<AccountSummary, String> {
    register_account_impl(core.inner(), &account_id).await
}

/// Shared registration entrypoint (single-flight worker per account).
/// Used by both the multi-account `register` command and the single-account
/// `sip_register` façade. No MutexGuard is held across the spawn.
async fn register_account_impl(core: &Arc<CoreState>, account_id: &str) -> Result<AccountSummary, String> {
    let profile = core
        .profiles
        .lock()
        .unwrap()
        .get(account_id)
        .cloned()
        .ok_or_else(|| format!("unknown account '{account_id}'"))?;
    {
        let mut workers = core.workers.lock().unwrap();
        if workers.get(account_id).is_some_and(|h| !h.is_finished()) {
            return Err(format!("registration worker already running for '{account_id}'"));
        }
        workers.retain(|_, h| !h.is_finished());
    }
    let guard = core.reg_supervisor.try_acquire(account_id)?;
    core.clear_status_message(account_id);
    core.apply(account_id, AccountEvent::EnableRequested);

    // The worker owns the guard: dropping it (task end) frees the slot, so
    // exactly one registration loop ever runs per account.
    let handle = tokio::spawn(registration_worker(
        Arc::clone(core),
        profile,
        guard,
    ));
    core.workers.lock().unwrap().insert(account_id.to_string(), handle);
    let profile = core.profiles.lock().unwrap().get(account_id).cloned().unwrap();
    Ok(AccountSummary::of(&profile, core.get_state(account_id)))
}

#[tauri::command]
async fn unregister(core: State<'_, Arc<CoreState>>, account_id: String) -> Result<AccountSummary, String> {
    unregister_impl(core.inner(), &account_id).await;
    let state = core.get_state(&account_id);
    let summary = if let Some(p) = core.profiles.lock().unwrap().get(&account_id) {
        AccountSummary::of(p, state)
    } else {
        return Err(format!("unknown account '{account_id}'"));
    };
    Ok(summary)
}

async fn unregister_impl(core: &Arc<CoreState>, account_id: &str) {
    // Abort the worker (guard drop frees the single-flight slot).
    if let Some(handle) = core.workers.lock().unwrap().remove(account_id) {
        handle.abort();
    }
    // Best-effort Expires:0 over a fresh short-lived connection.
    // The profile is cloned out of the lock first: no MutexGuard is held
    // across the network await (Tauri commands must stay Send).
    let profile = {
        core.profiles.lock().unwrap().get(account_id).cloned()
    };
    if let Some(profile) = profile {
        let local = open_signalling(&profile).await;
        if let Ok((mut stream, ip, port)) = local {
            use sip_core::transport::CONNECT_TIMEOUT;
            let res: Result<(), String> = tokio::time::timeout(CONNECT_TIMEOUT, async {
                match &mut stream {
                    SignallingStream::Tcp(s) => register::unregister_once(&profile, s, &ip, port, &core.cseq).await,
                    SignallingStream::Tls(s) => register::unregister_once(&profile, s, &ip, port, &core.cseq).await,
                }
            })
            .await
            .unwrap_or(Err("unregister timed out".into()));
            if let Err(e) = res {
                log::warn!("core: {}", sanitize_log(&format!("unregister best-effort failed: {e}")));
            }
        }
        core.set_broken(account_id, AccountState::Disabled);
    }
}

#[tauri::command]
async fn registration_status(
    core: State<'_, Arc<CoreState>>,
    account_id: String,
) -> Result<AccountSummary, String> {
    let profiles = core.profiles.lock().unwrap();
    let profile = profiles
        .get(&account_id)
        .ok_or_else(|| format!("unknown account '{account_id}'"))?;
    Ok(AccountSummary::of(profile, core.get_state(&account_id)))
}

#[tauri::command]
async fn diagnostics_export_sanitized(
    core: State<'_, Arc<CoreState>>,
    account_id: Option<String>,
) -> Result<Vec<SanitizedDiagnostics>, String> {
    let profiles = core.profiles.lock().unwrap();
    let ids: Vec<String> = match account_id {
        Some(id) => {
            if !profiles.contains_key(&id) {
                return Err(format!("unknown account '{id}'"));
            }
            vec![id]
        }
        None => profiles.keys().cloned().collect(),
    };
    drop(profiles);
    Ok(ids
        .iter()
        .map(|id| {
            let state = core.get_state(id);
            let transport = core
                .profiles
                .lock()
                .unwrap()
                .get(id)
                .map(|p| format!("{:?}", p.transport).to_ascii_lowercase())
                .unwrap_or_else(|| "unknown".into());
            SanitizedDiagnostics {
                account_id: id.clone(),
                account_state: format!("{state:?}"),
                transport,
                registered: state.is_registered(),
                failed_attempts: 0,
                events_total: core.events_total.load(std::sync::atomic::Ordering::SeqCst),
            }
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Native single-account façade (`sip_*`): the `nativeSipClient.ts` contract.
//
// The product UI owns exactly one account (`"native"`). Profiles carry no
// secrets (passwords go straight to the OS keychain), statuses are redacted
// summaries, and events use the `sip://*` names the webview subscribes to.
// Every command is Send-safe: no MutexGuard is held across an await.
// ---------------------------------------------------------------------------

/// The single account id owned by the `sip_*` façade. The multi-account
/// Phase-1 commands above remain for ops tooling; the product UI uses this.
const NATIVE_ACCOUNT_ID: &str = "native";

/// Redacted status snapshot matching `NativeSipStatus` in `src/types/sip.ts`.
#[derive(Debug, Clone, serde::Serialize)]
struct NativeSipStatusPayload {
    #[serde(rename = "transportOpen")]
    transport_open: bool,
    #[serde(rename = "tlsVerified")]
    tls_verified: bool,
    registered: bool,
    registering: bool,
    reconnecting: bool,
    #[serde(rename = "failureKind")]
    failure_kind: &'static str,
    message: Option<String>,
    #[serde(rename = "certStatus")]
    cert_status: &'static str,
    #[serde(rename = "contactsReachable")]
    contacts_reachable: u32,
}

fn native_status_of(core: &CoreState, account_id: &str) -> NativeSipStatusPayload {
    let state = core.get_state(account_id);
    let transport = core
        .profiles
        .lock()
        .unwrap()
        .get(account_id)
        .map(|p| p.transport);
    // Transport-open means the socket is up (REGISTER sent or accepted) —
    // never confused with registered (registrar `200 OK`).
    let transport_open = matches!(
        state,
        AccountState::Registering | AccountState::Registered | AccountState::Refreshing
    );
    let tls = matches!(transport, Some(SipTransport::Tls));
    let registered = state.is_registered();
    NativeSipStatusPayload {
        transport_open,
        tls_verified: tls && transport_open,
        registered,
        registering: matches!(
            state,
            AccountState::Connecting | AccountState::Registering | AccountState::Refreshing
        ),
        reconnecting: matches!(state, AccountState::Reconnecting),
        failure_kind: match state {
            AccountState::AuthFailed => "auth",
            AccountState::CertFailed => "cert",
            AccountState::NetUnavailable => "unreachable",
            _ => "none",
        },
        // Per-failure text tracked in core state (redacted, secret-free);
        // cleared on enable/accept. `mic`/`generic` kinds remain
        // frontend-detected and are never set here.
        message: core.status_message_of(account_id),
        cert_status: match state {
            AccountState::CertFailed => "failed",
            _ if tls && transport_open => "verified",
            _ if tls => "unknown",
            _ => "not-applicable",
        },
        contacts_reachable: u32::from(registered),
    }
}

/// Secret-free call snapshot matching the `sip://call-state` listener
/// (`{ state: CallState, info: CallInfo | null }`).
#[derive(Debug, Clone, serde::Serialize)]
struct NativeCallInfo {
    #[serde(rename = "remoteIdentity")]
    remote_identity: String,
    #[serde(rename = "remoteUri")]
    remote_uri: String,
    direction: &'static str,
    #[serde(rename = "startTime")]
    start_time: Option<u64>,
    duration: u64,
    #[serde(rename = "isMuted")]
    is_muted: bool,
    #[serde(rename = "isHeld")]
    is_held: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
struct NativeCallStatePayload {
    state: &'static str,
    info: Option<NativeCallInfo>,
}

fn frontend_call_state(s: CallStateNative) -> &'static str {
    match s {
        CallStateNative::Idle | CallStateNative::Ended | CallStateNative::Failed => "Idle",
        CallStateNative::OutgoingRinging => "Calling",
        CallStateNative::IncomingRinging => "Ringing",
        CallStateNative::Active => "Active",
        CallStateNative::Held => "Holding",
    }
}

fn native_call_payload(core: &CoreState, calls: &CallCoreState, mgr: &CallManager) -> NativeCallStatePayload {
    let state = mgr.state();
    let (start_time, duration) = calls.call_timing();
    let info = mgr.active_peer().map(|(peer, dir)| {
        let domain = core
            .profiles
            .lock()
            .unwrap()
            .get(NATIVE_ACCOUNT_ID)
            .map(|p| p.effective_domain().to_string())
            .unwrap_or_else(|| "local".to_string());
        NativeCallInfo {
            remote_identity: peer.to_string(),
            remote_uri: format!("sip:{peer}@{domain}"),
            direction: match dir {
                CallDirection::Incoming => "incoming",
                CallDirection::Outgoing => "outgoing",
            },
            // Call timing is Rust-owned: stamped when the leg enters Active
            // (kept across hold), cleared when it ends.
            start_time,
            duration,
            is_muted: mgr.is_muted(),
            is_held: matches!(state, CallStateNative::Held),
        }
    });
    NativeCallStatePayload {
        state: frontend_call_state(state),
        info,
    }
}

/// Drain manager events (also re-emitted on the legacy `daad-call-event`
/// stream for compat) and publish the contract `sip://call-state` snapshot.
/// Also stamps Rust-owned call timing from the resulting state.
fn emit_native_call(app: &AppHandle, core: &CoreState, calls: &CallCoreState, mgr: &mut CallManager) {
    use tauri::Emitter;
    for ev in mgr.take_events() {
        let _ = app.emit("daad-call-event", &ev);
    }
    calls.note_call_state(mgr.state());
    let _ = app.emit("sip://call-state", &native_call_payload(core, calls, mgr));
}

/// Route a locally-built wire text to the connection task that owns the
/// dialog's stream: inbound legs live on the registration stream, the
/// primary outgoing leg on the outbound call stream, the consult leg on its
/// own consult stream (own CSeq space per dialog).
fn wire_target_for(mgr: &CallManager) -> WireTarget {
    wire_target_for_leg(mgr, mgr.foreground())
}

fn wire_target_for_leg(mgr: &CallManager, leg: WhichLeg) -> WireTarget {
    match (leg, mgr.leg_direction(leg)) {
        (WhichLeg::Second, Some(CallDirection::Outgoing)) => WireTarget::Consult,
        (_, Some(CallDirection::Incoming)) => WireTarget::Registration,
        _ => WireTarget::Call,
    }
}

/// Local AoR for re-INVITE `From` headers.
fn native_aor(core: &CoreState) -> String {
    core.profiles
        .lock()
        .unwrap()
        .get(NATIVE_ACCOUNT_ID)
        .map(|p| format!("sip:{}@{}", p.username, p.effective_domain()))
        .unwrap_or_else(|| "sip:daad@local".into())
}

/// Split `tls|tcp|udp://host[:port]`, `sip:host[;transport=..]` or bare
/// `host[:port]` (TLS default). `wss://` is rejected: the native core owns
/// TLS/TCP directly — WebSocket pinning belongs to the legacy sip.js bridge.
fn parse_server_url(server_url: &str) -> Result<(SipTransport, String, u16), String> {
    let raw = server_url.trim();
    if raw.is_empty() {
        return Err("serverUrl must not be empty".into());
    }
    let lower = raw.to_ascii_lowercase();
    if lower.starts_with("ws://") || lower.starts_with("wss://") {
        return Err("native core expects a tls://, tcp://, udp:// or sip: serverUrl (wss:// belongs to the legacy sip.js bridge)".into());
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
    if host.is_empty() {
        return Err("serverUrl must contain a host".into());
    }
    Ok((transport, host, port))
}

/// Split `sip:<user>@<domain>` (trailing `;params` dropped).
fn parse_sip_uri(sip_uri: &str) -> Result<(String, String), String> {
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
fn validate_custom_ca(input: Option<String>) -> Result<Option<String>, String> {
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

#[tauri::command]
async fn sip_account_upsert(
    core: State<'_, Arc<CoreState>>,
    server_url: String,
    sip_uri: String,
    username: String,
    password: String,
    display_name: Option<String>,
    register_expires: Option<u32>,
    custom_ca_pem: Option<String>,
    extension: Option<String>,
) -> Result<(), String> {
    if password.is_empty() {
        return Err("password is required for provisioning".into());
    }
    let username = username.trim().to_string();
    sip_core::account::validate_device_username(&username)
        .map_err(|e| format!("invalid device username: {e}"))?;
    let extension = match extension.map(|e| e.trim().to_string()).filter(|e| !e.is_empty()) {
        Some(ext) => {
            sip_core::account::validate_extension(&ext)
                .map_err(|e| format!("invalid extension: {e}"))?;
            Some(ext)
        }
        None => None,
    };
    let (transport, hostname, port) = parse_server_url(&server_url)?;
    let (uri_user, domain) = parse_sip_uri(&sip_uri)?;
    if uri_user != username {
        return Err(format!(
            "SIP URI user '{uri_user}' must match the provisioned device username '{username}'"
        ));
    }
    let profile = SipProfile {
        account_id: NATIVE_ACCOUNT_ID.to_string(),
        hostname,
        port,
        transport,
        username,
        extension,
        display_name: display_name
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty()),
        domain: Some(domain),
        // Deployment CA for private-IP PBX certificates (Dobson bundle or
        // equivalent); None means system roots only — always verified,
        // fail-closed either way.
        ca_pem: validate_custom_ca(custom_ca_pem)?,
        expires_secs: register_expires.unwrap_or(600),
        codecs: vec![AudioCodec::Pcmu, AudioCodec::Pcma],
        media: MediaPolicy::default(),
        interop_opus: false,
    };
    profile.validate()?;
    // Rotating provisioning while a worker runs: stop it first so the next
    // register() binds the new profile (best-effort Expires: 0 for the old).
    let had_worker = core
        .workers
        .lock()
        .unwrap()
        .get(NATIVE_ACCOUNT_ID)
        .is_some_and(|h| !h.is_finished());
    if had_worker {
        unregister_impl(core.inner(), NATIVE_ACCOUNT_ID).await;
    }
    // Password goes straight to the OS keychain — never stored beside the
    // profile, never logged, never returned.
    core.keystore.store_password(&profile.account_id, &password)?;
    core.profiles
        .lock()
        .unwrap()
        .insert(profile.account_id.clone(), profile);
    core.account_states
        .lock()
        .unwrap()
        .entry(NATIVE_ACCOUNT_ID.to_string())
        .or_insert(AccountState::Disabled);
    core.emit_native_status();
    Ok(())
}

#[tauri::command]
async fn sip_account_remove(
    app: AppHandle,
    core: State<'_, Arc<CoreState>>,
    callcore: State<'_, CallCoreState>,
) -> Result<(), String> {
    // End calls first (logout teardown releases media + devices), then
    // unregister, drop the profile, and delete the keychain entry.
    // The call driver task is aborted first so it can never dispatch into
    // cleared state; queued wire texts are dropped with it.
    callcore.abort_call_task();
    callcore.abort_consult_task();
    callcore.clear_wire();
    {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        mgr.teardown_all(sip_core::audio::TeardownReason::Logout);
        emit_native_call(&app, &core, &callcore, &mut mgr);
    }
    unregister_impl(core.inner(), NATIVE_ACCOUNT_ID).await;
    core.profiles.lock().unwrap().remove(NATIVE_ACCOUNT_ID);
    core.account_states
        .lock()
        .unwrap()
        .remove(NATIVE_ACCOUNT_ID);
    core.keystore.delete_password(NATIVE_ACCOUNT_ID)?;
    core.emit_native_status();
    Ok(())
}

#[tauri::command]
async fn sip_register(core: State<'_, Arc<CoreState>>) -> Result<(), String> {
    register_account_impl(core.inner(), NATIVE_ACCOUNT_ID).await?;
    core.emit_native_status();
    Ok(())
}

#[tauri::command]
async fn sip_unregister(
    app: AppHandle,
    core: State<'_, Arc<CoreState>>,
    callcore: State<'_, CallCoreState>,
) -> Result<(), String> {
    // Going offline ends signalling: stop the call driver, drop queued
    // wire, tear down media, then best-effort Expires:0.
    callcore.abort_call_task();
    callcore.abort_consult_task();
    callcore.clear_wire();
    {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        mgr.teardown_all(sip_core::audio::TeardownReason::Suspend);
        emit_native_call(&app, &core, &callcore, &mut mgr);
    }
    unregister_impl(core.inner(), NATIVE_ACCOUNT_ID).await;
    core.emit_native_status();
    Ok(())
}

#[tauri::command]
async fn sip_status(
    app: AppHandle,
    core: State<'_, Arc<CoreState>>,
) -> Result<NativeSipStatusPayload, String> {
    let payload = native_status_of(&core, NATIVE_ACCOUNT_ID);
    {
        use tauri::Emitter;
        let _ = app.emit("sip://connection-state", &payload);
        let _ = app.emit("sip://cert-status", &payload.cert_status);
    }
    Ok(payload)
}

#[tauri::command]
async fn sip_call_invite(
    app: AppHandle,
    core: State<'_, Arc<CoreState>>,
    callcore: State<'_, CallCoreState>,
    target: String,
) -> Result<(), String> {
    // MVP single JBM profile: verified TLS only, registered first.
    let profile = core
        .profiles
        .lock()
        .unwrap()
        .get(NATIVE_ACCOUNT_ID)
        .cloned()
        .ok_or_else(|| "no provisioned account: run sip_account_upsert first".to_string())?;
    if profile.transport != SipTransport::Tls {
        return Err("MVP requires the TLS profile (tls://host:5061)".into());
    }
    if !core.get_state(NATIVE_ACCOUNT_ID).is_registered() {
        return Err("not registered: run sip_register first".into());
    }
    // Single-call invariant: a stale driver task must never dispatch into
    // the new leg. A consult leg can never survive a fresh primary invite
    // (invite() refuses while any leg exists), so its driver goes too.
    callcore.abort_call_task();
    callcore.abort_consult_task();
    // Open the call stream first — no locks are held across this await.
    let (stream, local_ip, _local_port) = open_signalling(&profile).await?;
    let req = {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        // Stamp the routable socket address into the SDP offer so the peer's
        // RTP (and SDES-SRTP keys bound to it) has a real destination.
        mgr.set_media_addr(&local_ip);
        mgr.invite(&target)
            .map_err(|e| sanitize_log(&e.to_string()))?
    };
    {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        emit_native_call(&app, &core, &callcore, &mut mgr);
    }
    // The driver task owns the stream from here: it sends the INVITE, folds
    // 100/180/183, answers 200+SDP with ACK (SRTP negotiated, cpal audio
    // started by the manager), and relays the established leg.
    let app2 = app.clone();
    let handle = tokio::spawn(outbound_call_task(stream, req, app2, WhichLeg::Primary, WireTarget::Call));
    *callcore.call_task.lock().unwrap() = Some(handle);
    Ok(())
}

#[tauri::command]
async fn sip_call_answer(
    app: AppHandle,
    core: State<'_, Arc<CoreState>>,
    callcore: State<'_, CallCoreState>,
) -> Result<(), String> {
    let (resp, target) = {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        let target = wire_target_for(&mgr);
        let resp = mgr.answer().map_err(|e| sanitize_log(&e.to_string()))?;
        (resp, target)
    };
    // The 200 OK travels on the dialog's stream via the connection task;
    // state is already Active locally so the UI updates even if the wire
    // write lands a poll later.
    callcore.push_wire(target, resp);
    {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        emit_native_call(&app, &core, &callcore, &mut mgr);
    }
    Ok(())
}

#[tauri::command]
async fn sip_call_reject(
    app: AppHandle,
    core: State<'_, Arc<CoreState>>,
    callcore: State<'_, CallCoreState>,
) -> Result<(), String> {
    // Product reject is a decline (603); network-busy (486) is reserved for
    // the automatic second-incoming-while-busy path in the call manager.
    // The full response goes out on the dialog's stream.
    let (resp, target) = {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        let target = wire_target_for(&mgr);
        let resp = mgr
            .reject(false)
            .map_err(|e| sanitize_log(&e.to_string()))?;
        (resp, target)
    };
    callcore.push_wire(target, resp);
    {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        emit_native_call(&app, &core, &callcore, &mut mgr);
    }
    Ok(())
}

#[tauri::command]
async fn sip_call_hangup(
    app: AppHandle,
    core: State<'_, Arc<CoreState>>,
    callcore: State<'_, CallCoreState>,
) -> Result<(), String> {
    // Local hangup builds CANCEL (pre-200) or BYE (established); the text
    // goes out on the dialog's stream via the connection task.
    let pending = {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        let target = wire_target_for(&mgr);
        mgr.hangup()
            .map_err(|e| sanitize_log(&e.to_string()))?
            .map(|text| (target, text))
    };
    if let Some((target, text)) = pending {
        callcore.push_wire(target, text);
    }
    {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        emit_native_call(&app, &core, &callcore, &mut mgr);
    }
    Ok(())
}

#[tauri::command]
async fn sip_call_mute(
    app: AppHandle,
    core: State<'_, Arc<CoreState>>,
    callcore: State<'_, CallCoreState>,
    muted: bool,
) -> Result<(), String> {
    let mut mgr = callcore
        .mgr
        .lock()
        .map_err(|e| format!("call core poisoned: {e}"))?;
    mgr.set_muted(muted)
        .map_err(|e| sanitize_log(&e.to_string()))?;
    emit_native_call(&app, &core, &callcore, &mut mgr);
    Ok(())
}

#[tauri::command]
async fn sip_call_hold(
    app: AppHandle,
    core: State<'_, Arc<CoreState>>,
    callcore: State<'_, CallCoreState>,
    held: bool,
) -> Result<(), String> {
    // Hold/resume travel as in-dialog re-INVITEs (`sendonly`/`sendrecv`)
    // on the dialog's stream; mute stays local (capture gate).
    let from = native_aor(&core);
    let (req, target) = {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        let target = wire_target_for(&mgr);
        let req = if held {
            mgr.hold_request(&from)
        } else {
            mgr.resume_request(&from)
        }
        .map_err(|e| sanitize_log(&e.to_string()))?;
        (req, target)
    };
    callcore.push_wire(target, req);
    {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        emit_native_call(&app, &core, &callcore, &mut mgr);
    }
    Ok(())
}

/// Answer the waiting second leg: hold the active leg (its `sendonly`
/// re-INVITE goes out on its stream) and answer waiting with 200 OK on the
/// registration stream. Media focus moves; exactly one RTP stream stays up.
#[tauri::command]
async fn sip_call_answer_waiting(
    app: AppHandle,
    core: State<'_, Arc<CoreState>>,
    callcore: State<'_, CallCoreState>,
) -> Result<(), String> {
    let from = native_aor(&core);
    let (hold_target, hold_req, ok200) = {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        let hold_target = wire_target_for_leg(&mgr, mgr.foreground());
        let (hold_req, ok200) = mgr
            .answer_waiting(&from)
            .map_err(|e| sanitize_log(&e.to_string()))?;
        (hold_target, hold_req, ok200)
    };
    callcore.push_wire(hold_target, hold_req);
    callcore.push_wire(WireTarget::Registration, ok200);
    {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        emit_native_call(&app, &core, &callcore, &mut mgr);
    }
    Ok(())
}

/// Explicit swap: hold the foreground leg, resume the parked leg. Each
/// re-INVITE goes out on its own leg's stream; empty texts (already-held /
/// already-active legs) are skipped, never sent.
#[tauri::command]
async fn sip_call_swap(
    app: AppHandle,
    core: State<'_, Arc<CoreState>>,
    callcore: State<'_, CallCoreState>,
) -> Result<(), String> {
    let from = native_aor(&core);
    let (t_old, t_new, hold_req, resume_req) = {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        let fg = mgr.foreground();
        let t_old = wire_target_for_leg(&mgr, fg);
        let t_new = wire_target_for_leg(&mgr, fg.other());
        let (hold_req, resume_req) = mgr.swap(&from).map_err(|e| sanitize_log(&e.to_string()))?;
        (t_old, t_new, hold_req, resume_req)
    };
    if !hold_req.is_empty() {
        callcore.push_wire(t_old, hold_req);
    }
    if !resume_req.is_empty() {
        callcore.push_wire(t_new, resume_req);
    }
    {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        emit_native_call(&app, &core, &callcore, &mut mgr);
    }
    Ok(())
}

/// Start a consultation leg for attended transfer: hold the primary (its
/// `sendonly` re-INVITE goes on its stream) and dial the numeric consult
/// target on a fresh verified signalling stream (own CSeq space). The
/// consult INVITE travels via a dedicated driver task on the `Consult`
/// queue. Numeric dialing only; JBM media profile unchanged.
#[tauri::command]
async fn sip_call_consult(
    app: AppHandle,
    core: State<'_, Arc<CoreState>>,
    callcore: State<'_, CallCoreState>,
    target: String,
) -> Result<(), String> {
    sip_core::validate_extension(target.trim())
        .map_err(|e| sanitize_log(&e.to_string()))?;
    let profile = core
        .profiles
        .lock()
        .unwrap()
        .get(NATIVE_ACCOUNT_ID)
        .cloned()
        .ok_or_else(|| "no provisioned account: run sip_account_upsert first".to_string())?;
    if profile.transport != SipTransport::Tls {
        return Err("MVP requires the TLS profile (tls://host:5061)".into());
    }
    if !core.get_state(NATIVE_ACCOUNT_ID).is_registered() {
        return Err("not registered: run sip_register first".into());
    }
    // Stale consult driver must never dispatch into the new leg.
    callcore.abort_consult_task();
    // Open the consult stream first — no locks are held across this await.
    let (stream, local_ip, _local_port) = open_signalling(&profile).await?;
    let from = native_aor(&core);
    let (hold_req, hold_target, invite_req) = {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        mgr.set_media_addr(&local_ip);
        let hold_target = wire_target_for_leg(&mgr, WhichLeg::Primary);
        let (hold_req, invite_req) = mgr
            .consult(target.trim(), &from)
            .map_err(|e| sanitize_log(&e.to_string()))?;
        (hold_req, hold_target, invite_req)
    };
    if !hold_req.is_empty() {
        callcore.push_wire(hold_target, hold_req);
    }
    {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        emit_native_call(&app, &core, &callcore, &mut mgr);
    }
    let app2 = app.clone();
    let handle = tokio::spawn(outbound_call_task(
        stream,
        invite_req,
        app2,
        WhichLeg::Second,
        WireTarget::Consult,
    ));
    *callcore.consult_task.lock().unwrap() = Some(handle);
    Ok(())
}

/// Blind transfer (RFC 3515): REFER the foreground leg to a numeric
/// target (`Refer-To: sip:<target>@<domain>`, `Referred-By` = local AoR).
/// The 202/NOTIFY outcome arrives on the leg's stream and retires the leg
/// as `transferred` on final 2xx (zero orphans) or keeps it up on failure.
#[tauri::command]
async fn sip_call_transfer_blind(
    app: AppHandle,
    core: State<'_, Arc<CoreState>>,
    callcore: State<'_, CallCoreState>,
    target: String,
) -> Result<(), String> {
    sip_core::validate_extension(target.trim())
        .map_err(|e| sanitize_log(&e.to_string()))?;
    let from = native_aor(&core);
    let domain = core
        .profiles
        .lock()
        .unwrap()
        .get(NATIVE_ACCOUNT_ID)
        .map(|p| p.effective_domain().to_string())
        .unwrap_or_else(|| "local".to_string());
    let refer_to = format!("sip:{}@{domain}", target.trim());
    let (wire_target, refer) = {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        let wire_target = wire_target_for_leg(&mgr, mgr.foreground());
        let refer = mgr
            .blind_transfer_request(target.trim(), &from, &refer_to)
            .map_err(|e| sanitize_log(&e.to_string()))?;
        (wire_target, refer)
    };
    callcore.push_wire(wire_target, refer);
    {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        emit_native_call(&app, &core, &callcore, &mut mgr);
    }
    Ok(())
}

/// Attended transfer: REFER the held primary leg to the answered consult
/// target, joining via `Replaces` pointing at the consult dialog. Both
/// legs retire as `transferred` on final 2xx NOTIFY (media released only
/// when the last leg goes).
#[tauri::command]
async fn sip_call_transfer_attended(
    app: AppHandle,
    core: State<'_, Arc<CoreState>>,
    callcore: State<'_, CallCoreState>,
) -> Result<(), String> {
    let from = native_aor(&core);
    let domain = core
        .profiles
        .lock()
        .unwrap()
        .get(NATIVE_ACCOUNT_ID)
        .map(|p| p.effective_domain().to_string())
        .unwrap_or_else(|| "local".to_string());
    let (wire_target, refer) = {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        let peer = mgr
            .leg_peer(WhichLeg::Second)
            .ok_or_else(|| "no consult leg: run sip_call_consult first".to_string())?
            .to_string();
        let refer_to = format!("sip:{peer}@{domain}");
        let wire_target = wire_target_for_leg(&mgr, WhichLeg::Primary);
        let refer = mgr
            .attended_transfer_request(&from, &refer_to)
            .map_err(|e| sanitize_log(&e.to_string()))?;
        (wire_target, refer)
    };
    callcore.push_wire(wire_target, refer);
    {
        let mut mgr = callcore
            .mgr
            .lock()
            .map_err(|e| format!("call core poisoned: {e}"))?;
        emit_native_call(&app, &core, &callcore, &mut mgr);
    }
    Ok(())
}

#[tauri::command]
async fn sip_call_dtmf(callcore: State<'_, CallCoreState>, tone: String) -> Result<(), String> {
    let ch = tone.chars().next().ok_or_else(|| "empty tone".to_string())?;
    let mut mgr = callcore
        .mgr
        .lock()
        .map_err(|e| format!("call core poisoned: {e}"))?;
    mgr.dtmf(ch).map_err(|e| sanitize_log(&e.to_string()))?;
    Ok(())
}

#[tauri::command]
async fn sip_audio_route(callcore: State<'_, CallCoreState>, route: String) -> Result<(), String> {
    // Product routes are earpiece|speaker|bluetooth|system. There is no
    // distinct "system" output in the native manager — it maps to the
    // default route (Speaker) instead of failing the request.
    let native = match route.trim().to_ascii_lowercase().as_str() {
        "earpiece" => sip_core::audio::AudioRoute::Earpiece,
        "speaker" | "system" => sip_core::audio::AudioRoute::Speaker,
        "bluetooth" | "bt" => sip_core::audio::AudioRoute::Bluetooth,
        "headset" => sip_core::audio::AudioRoute::Headset,
        other => return Err(format!("unknown audio route '{other}'")),
    };
    let mut mgr = callcore
        .mgr
        .lock()
        .map_err(|e| format!("call core poisoned: {e}"))?;
    mgr.set_audio_route(native);
    Ok(())
}

/// Secret-free diagnostics snapshot. The webview contract re-sanitizes and
/// discards the body, but the shape stays honest: state names, capability
/// flags and counters only — never URIs, IPs, SDP, or key material.
#[derive(Debug, Clone, serde::Serialize)]
struct NativeDiagnostics {
    account_id: String,
    account_state: String,
    call_state: String,
    transport: String,
    registered: bool,
    muted: bool,
    audio_route: String,
    events_total: u64,
    /// Capability flags (secret-free): Opus interop gate, mandatory SRTP,
    /// and the two-dialog ceiling.
    opus_enabled: bool,
    srtp_required: bool,
    max_dialogs: u8,
}

#[tauri::command]
async fn sip_diagnostics_export(
    core: State<'_, Arc<CoreState>>,
    callcore: State<'_, CallCoreState>,
) -> Result<NativeDiagnostics, String> {
    let state = core.get_state(NATIVE_ACCOUNT_ID);
    let (transport, opus_enabled, srtp_required) = core
        .profiles
        .lock()
        .unwrap()
        .get(NATIVE_ACCOUNT_ID)
        .map(|p| {
            (
                format!("{:?}", p.transport).to_ascii_lowercase(),
                p.interop_opus,
                p.media.srtp_required,
            )
        })
        .unwrap_or_else(|| ("none".into(), false, true));
    let mgr = callcore
        .mgr
        .lock()
        .map_err(|e| format!("call core poisoned: {e}"))?;
    Ok(NativeDiagnostics {
        account_id: NATIVE_ACCOUNT_ID.to_string(),
        account_state: format!("{state:?}"),
        call_state: format!("{:?}", mgr.state()),
        transport,
        registered: state.is_registered(),
        muted: mgr.is_muted(),
        audio_route: mgr.audio_route().as_str().to_string(),
        events_total: core.events_total.load(std::sync::atomic::Ordering::SeqCst),
        opus_enabled,
        srtp_required,
        max_dialogs: 2,
    })
}

enum SignallingStream {
    Tcp(tokio::net::TcpStream),
    Tls(tokio_rustls::client::TlsStream<tokio::net::TcpStream>),
}

/// Open a verified signalling connection per the account's transport.
/// UDP is accepted as configuration but has no connected-stream REGISTER
/// path in Phase 1 (reported honestly instead of faked).
async fn open_signalling(profile: &SipProfile) -> Result<(SignallingStream, String, u16), String> {
    use sip_core::transport::{connect_tcp, connect_tls};
    match profile.transport {
        SipTransport::Tls => {
            let s = connect_tls(&profile.hostname, profile.port, profile.ca_pem.as_deref()).await?;
            let addr = s.get_ref().0.local_addr().map_err(|e| format!("local addr: {e}"))?;
            Ok((SignallingStream::Tls(s), addr.ip().to_string(), addr.port()))
        }
        SipTransport::Tcp => {
            let s = connect_tcp(&profile.hostname, profile.port).await?;
            let addr = s.local_addr().map_err(|e| format!("local addr: {e}"))?;
            Ok((SignallingStream::Tcp(s), addr.ip().to_string(), addr.port()))
        }
        SipTransport::Udp => Err("UDP signalling not implemented in Phase 1 (use tls|tcp)".into()),
    }
}

// ---------------------------------------------------------------------------
// Live call-signalling wire: dialog/SDP/SRTP/RTP messages on the Phase-1
// TLS/TCP streams. All manager locks are statement-scoped; no MutexGuard is
// ever held across an await (socket I/O always happens on owned streams or
// outside the lock).
// ---------------------------------------------------------------------------

/// How [`multiplex_until_refresh`] ended.
enum ListenEnd {
    /// Refresh deadline reached: run the re-REGISTER cycle.
    RefreshDue,
    /// Stream EOF/error: take the reconnect path.
    StreamBroken,
}

/// Read one framed SIP message from either signalling stream kind.
/// The framer MUST live as long as the stream (pipelined bytes survive
/// across reads); never use a fresh buffer per read on a live stream.
async fn sig_read_msg(
    s: &mut SignallingStream,
    framer: &mut sip_core::wire::SipFramer,
) -> Result<sip_core::wire::SipMessage, String> {
    match s {
        SignallingStream::Tcp(x) => sip_core::wire::read_framed(framer, x).await,
        SignallingStream::Tls(x) => sip_core::wire::read_framed(framer, x).await,
    }
}

/// Write one SIP text to either signalling stream kind.
async fn sig_write_msg(s: &mut SignallingStream, text: &str) -> Result<(), String> {
    match s {
        SignallingStream::Tcp(x) => sip_core::wire::write_sip_message(x, text).await,
        SignallingStream::Tls(x) => sip_core::wire::write_sip_message(x, text).await,
    }
}

/// Run `f` under a short manager lock, then emit the call snapshot.
/// No-op without a managed call core (unit tests). Never holds the lock
/// across an await (`f` is sync; emit is sync).
fn mutate_call(app: &AppHandle, f: impl FnOnce(&mut CallManager)) {
    if let Some(calls) = app.try_state::<CallCoreState>() {
        if let Ok(mut mgr) = calls.mgr.lock() {
            f(&mut mgr);
            if let Some(core) = app.try_state::<Arc<CoreState>>() {
                emit_native_call(app, &core, &calls, &mut mgr);
            }
        }
    }
}

/// Route one inbound response through the transfer state machine (final
/// responses to our REFER: 202 arms, 3xx–6xx fails). Returns `true` when
/// consumed. Sync; never holds a lock across an await.
fn route_response(app: &AppHandle, head: &str) -> bool {
    let consumed = match app.try_state::<CallCoreState>() {
        Some(calls) => match calls.mgr.lock() {
            Ok(mut mgr) => sip_core::wire::dispatch_response(&mut mgr, head),
            Err(_) => false,
        },
        None => false,
    };
    if consumed {
        mutate_call(app, |_| {});
    }
    consumed
}

/// Write all queued texts for `target`. `false` when the stream broke.
async fn flush_wire(stream: &mut SignallingStream, app: &AppHandle, target: WireTarget) -> bool {
    let pending: Vec<String> = app
        .try_state::<CallCoreState>()
        .map(|calls| calls.drain_wire(target))
        .unwrap_or_default();
    for text in pending {
        if sig_write_msg(stream, &text).await.is_err() {
            return false;
        }
    }
    true
}

/// Dispatch one inbound request: decide the response under a short lock,
/// send it with no locks held, re-lock to emit. Returns `false` when the
/// stream broke while responding.
async fn handle_inbound_request(
    app: &AppHandle,
    stream: &mut SignallingStream,
    msg: &sip_core::wire::SipMessage,
) -> bool {
    let resp = match app.try_state::<CallCoreState>() {
        None => return true,
        Some(calls) => match calls.mgr.lock() {
            Ok(mut mgr) => sip_core::wire::dispatch_request(&mut mgr, &msg.head, &msg.body),
            Err(_) => return true,
        },
    };
    if let Some(text) = resp {
        if sig_write_msg(stream, &text).await.is_err() {
            return false;
        }
    }
    mutate_call(app, |_| {});
    true
}

/// Inbound multiplex on the registered stream: until the refresh deadline,
/// drain queued command texts (200-to-INVITE, 603, BYE, re-INVITE for the
/// incoming leg — the `Registration` queue) and dispatch inbound
/// INVITE/CANCEL/BYE/ACK through the call manager, emitting
/// `sip://call-state` (`incoming_ringing` for fresh INVITEs). Without a
/// webview (unit tests) there is no call core, so just wait out the deadline.
async fn multiplex_until_refresh(
    core: &Arc<CoreState>,
    stream: &mut SignallingStream,
    expires: u32,
) -> ListenEnd {
    let deadline = tokio::time::Instant::now() + register::refresh_delay(expires);
    let app = match core.app_handle() {
        Some(a) => a,
        None => {
            tokio::time::sleep_until(deadline).await;
            return ListenEnd::RefreshDue;
        }
    };
    // One framer for the life of this stream: registrar/peer pipelining
    // must never lose bytes between polls.
    let mut framer = sip_core::wire::SipFramer::new();
    loop {
        // Command queue first: answer/reject/hangup/hold texts must not wait
        // behind a quiet socket.
        if !flush_wire(stream, &app, WireTarget::Registration).await {
            return ListenEnd::StreamBroken;
        }
        if tokio::time::Instant::now() >= deadline {
            return ListenEnd::RefreshDue;
        }
        // Short poll: keeps answer latency ~1 s and the deadline checked.
        match tokio::time::timeout(std::time::Duration::from_secs(1), sig_read_msg(stream, &mut framer)).await
        {
            Err(_) => continue,
            Ok(Err(_)) => return ListenEnd::StreamBroken,
            Ok(Ok(msg)) => {
                if msg.is_response {
                    // Final responses to our REFER (202/4xx-6xx) drive the
                    // transfer state machine; anything else on this stream
                    // (e.g. to re-INVITE/BYE) is logged redacted.
                    if !route_response(&app, &msg.head) {
                        log::debug!("core: registration stream stray response");
                    }
                    continue;
                }
                if !handle_inbound_request(&app, stream, &msg).await {
                    return ListenEnd::StreamBroken;
                }
            }
        }
    }
}

/// Establishing phase of one outgoing leg (primary or consult): fold
/// 100/180/183, answer a 200 OK (SDP body → PCMU/PCMA + mandatory SDES
/// negotiation → cpal audio start) with ACK, map 3xx–6xx (incl. 401/407:
/// INVITE Digest is Phase-2, surfaced as failure, never retried blind) into
/// teardown. Returns `true` when the leg reached Active. `target` is the
/// leg's wire queue (Call for primary, Consult for the consult dialog).
async fn drive_establishing_for(
    stream: &mut SignallingStream,
    app: &AppHandle,
    leg: WhichLeg,
    target: WireTarget,
) -> bool {
    use sip_core::call::CallStateNative as S;
    let mut framer = sip_core::wire::SipFramer::new();
    loop {
        // Queued CANCEL (concurrent hangup) goes first; a terminal leg
        // means the local side already decided — stop driving.
        if !flush_wire(stream, app, target).await {
            return false;
        }
        let state = app
            .try_state::<CallCoreState>()
            .and_then(|c| c.mgr.lock().map(|m| m.leg_state(leg)).ok())
            .unwrap_or(S::Idle);
        if state != S::OutgoingRinging {
            return false;
        }
        let msg = match sig_read_msg(stream, &mut framer).await {
            Ok(m) => m,
            Err(e) => {
                log::warn!("core: {}", sanitize_log(&format!("outbound invite read failed: {e}")));
                mutate_call(app, |mgr| {
                    let _ = mgr.on_failure_for(leg, 408);
                });
                return false;
            }
        };
        if msg.is_response {
            // Our REFER never flies pre-establishment, but a stray final
            // REFER response must not be mistaken for the INVITE outcome.
            if route_response(app, &msg.head) {
                continue;
            }
            match sip_core::wire::status_code(&msg.head) {
                None => {
                    log::warn!("core: {}", sanitize_log("outbound: malformed status line (fail-closed)"));
                    mutate_call(app, |mgr| {
                        let _ = mgr.on_failure_for(leg, 500);
                    });
                    return false;
                }
                Some((code, _)) if (100..200).contains(&code) => {
                    mutate_call(app, |mgr| {
                        let _ = mgr.on_provisional_for(leg, code);
                    });
                }
                Some((code, _)) if (200..300).contains(&code) => {
                    let ack = match app.try_state::<CallCoreState>() {
                        Some(calls) => match calls.mgr.lock() {
                            // The consult (second outgoing) leg answers via
                            // the consult path so media focus + Swapped emit
                            // stay consistent with the sans-io manager.
                            Ok(mut mgr) => match if leg == WhichLeg::Second {
                                mgr.on_consult_answer(&msg.body)
                            } else {
                                mgr.on_answer_for(leg, &msg.body)
                            } {
                                Ok(ack) => {
                                    if let Some(core) = app.try_state::<Arc<CoreState>>() {
                                        emit_native_call(app, &core, &calls, &mut mgr);
                                    }
                                    ack
                                }
                                Err(e) => {
                                    // Unusable answer (plain RTP / bad SDP):
                                    // never downgrade — end as incompatible.
                                    log::warn!(
                                        "core: {}",
                                        sanitize_log(&format!("unusable 200 OK SDP: {e}"))
                                    );
                                    let _ = mgr.on_failure_for(leg, 488);
                                    if let Some(core) = app.try_state::<Arc<CoreState>>() {
                                        emit_native_call(app, &core, &calls, &mut mgr);
                                    }
                                    return false;
                                }
                            },
                            Err(_) => return false,
                        },
                        None => return false,
                    };
                    if sig_write_msg(stream, &ack).await.is_err() {
                        return false;
                    }
                    return true;
                }
                Some((code, _)) => {
                    log::warn!("core: {}", sanitize_log(&format!("invite rejected: {code}")));
                    mutate_call(app, |mgr| {
                        let _ = mgr.on_failure_for(leg, code);
                    });
                    return false;
                }
            }
        } else if !handle_inbound_request(app, stream, &msg).await {
            return false;
        }
    }
}

/// Established-leg relay for one dialog: queued CANCEL/BYE/re-INVITE out,
/// peer BYE/CANCEL/REFER/NOTIFY in, until the transport dies or the leg ends
/// locally. Transport loss fails only the driven leg (the parked leg is
/// promoted, never orphaned) — no silent zombie Active.
async fn relay_established_for(
    stream: &mut SignallingStream,
    app: &AppHandle,
    leg: WhichLeg,
    target: WireTarget,
) {
    use sip_core::call::CallStateNative as S;
    let mut framer = sip_core::wire::SipFramer::new();
    loop {
        if !flush_wire(stream, app, target).await {
            break;
        }
        let state = app
            .try_state::<CallCoreState>()
            .and_then(|c| c.mgr.lock().map(|m| m.leg_state(leg)).ok())
            .unwrap_or(S::Idle);
        if matches!(state, S::Idle | S::Ended | S::Failed) {
            break;
        }
        match tokio::time::timeout(std::time::Duration::from_secs(1), sig_read_msg(stream, &mut framer)).await
        {
            Err(_) => continue,
            Ok(Err(_)) => {
                log::warn!("core: {}", sanitize_log("call stream lost mid-call"));
                mutate_call(app, |mgr| {
                    if matches!(mgr.leg_state(leg), S::Active | S::Held) {
                        let _ = mgr.on_transport_lost_for(leg);
                    }
                });
                break;
            }
            Ok(Ok(msg)) => {
                if msg.is_response {
                    // Final REFER responses drive the transfer machine;
                    // 200-to-BYE/re-INVITE needs no action (leg already
                    // terminal locally).
                    route_response(app, &msg.head);
                    continue;
                }
                if !handle_inbound_request(app, stream, &msg).await {
                    break;
                }
            }
        }
    }
}

/// Driver task for one outbound dialog stream: the primary INVITE
/// (`Primary`/`Call`) or the consult INVITE (`Second`/`Consult`). The
/// previous task for the same leg is aborted before a new one starts.
async fn outbound_call_task(
    mut stream: SignallingStream,
    invite_req: String,
    app: AppHandle,
    leg: WhichLeg,
    target: WireTarget,
) {
    let answered = if sig_write_msg(&mut stream, &invite_req).await.is_ok() {
        drive_establishing_for(&mut stream, &app, leg, target).await
    } else {
        log::warn!("core: {}", sanitize_log("outbound: INVITE write failed"));
        mutate_call(&app, |mgr| {
            let _ = mgr.on_failure_for(leg, 503);
        });
        false
    };
    if answered {
        relay_established_for(&mut stream, &app, leg, target).await;
    } else {
        // Failed leg: flush a queued CANCEL so the peer never rings forever.
        flush_wire(&mut stream, &app, target).await;
    }
}

/// Map a sanitised TLS failure to actionable, secret-free user guidance.
/// Input must already be redacted (`sanitize_log`): variant keywords carry
/// no identities, IPs, or key material.
fn classify_tls_error(sanitised: &str) -> String {
    let l = sanitised.to_lowercase();
    if l.contains("unknownissuer") || l.contains("unknown issuer") {
        "TLS verification failed: Core certificate is not signed by a trusted CA — paste the Core CA certificate in Provisioning and try again".to_string()
    } else if l.contains("expir") {
        "TLS verification failed: Core certificate is expired — renew it on the Core".to_string()
    } else if l.contains("notvalidyet") || l.contains("not valid yet") {
        "TLS verification failed: Core certificate is not yet valid — check the device and Core clocks".to_string()
    } else if l.contains("notvalidforname") || l.contains("not valid for name") {
        "TLS verification failed: Core certificate does not cover this host — use the provisioned hostname or fix its SANs on the Core".to_string()
    } else if l.contains("server name rejected") {
        "TLS setup failed: cannot build a server name from the Server field — check host/IP and port".to_string()
    } else if l.contains("tls config rejected") || l.contains("zero usable certs") {
        "TLS setup failed: custom CA bundle is unusable — re-paste a valid PEM bundle".to_string()
    } else {
        "TLS certificate verification failed; connection closed (fail-closed)".to_string()
    }
}

async fn registration_worker(
    core: Arc<CoreState>,
    profile: SipProfile,
    _guard: register::RegistrationGuard,
) {
    let account_id = profile.account_id.clone();
    let policy = ReconnectPolicy::default();
    let mut failed: u32 = 0;

    loop {
        // (Re)connect the transport.
        let stream = match open_signalling(&profile).await {
            Ok(v) => {
                core.apply(&account_id, AccountEvent::TcpConnected);
                failed = 0;
                v
            }
            Err(e) => {
                let msg = sanitize_log(&e);
                if msg.contains("TLS config rejected")
                    || msg.contains("server name rejected")
                    || msg.contains("handshake")
                {
                    log::error!("core: {msg}");
                    core.set_status_message(&account_id, classify_tls_error(&msg));
                    core.apply(&account_id, AccountEvent::CertError);
                    return; // fail-closed: no silent retry on cert errors
                }
                log::warn!("core: {msg}");
                core.apply(&account_id, AccountEvent::NetError);
                failed += 1;
                if policy.attempts_exhausted(failed) {
                    log::error!("core: reconnect attempts exhausted for '{account_id}'");
                    core.set_status_message(
                        &account_id,
                        "Network unreachable; retry budget exhausted",
                    );
                    return;
                }
                tokio::time::sleep(policy.delay_for(failed)).await;
                core.apply(&account_id, AccountEvent::RetryTimerFired);
                continue;
            }
        };

        let (mut stream, local_ip, local_port) = stream;
        // Stamp the socket address for future SDP offers (inbound answers
        // need a routable `c=` line, not loopback).
        if let Some(app) = core.app_handle() {
            if let Some(calls) = app.try_state::<CallCoreState>() {
                if let Ok(mut mgr) = calls.mgr.lock() {
                    mgr.set_media_addr(&local_ip);
                }
            }
        }
        let password = core
            .keystore
            .load_password(&account_id)
            .unwrap_or(None);
        let outcome = match &mut stream {
            SignallingStream::Tcp(s) => {
                register::register_once(&profile, password.as_deref(), s, &local_ip, local_port, &core.cseq).await
            }
            SignallingStream::Tls(s) => {
                register::register_once(&profile, password.as_deref(), s, &local_ip, local_port, &core.cseq).await
            }
        };

        match outcome {
            Ok(RegisterOutcome::Accepted { expires }) => {
                core.apply(&account_id, AccountEvent::RegisterAccepted);
                core.clear_status_message(&account_id);
                // Inbound multiplex: the same verified stream carries inbound
                // INVITE/CANCEL/BYE until the refresh deadline
                // (single-connection MVP — no second listener socket).
                match multiplex_until_refresh(&core, &mut stream, expires).await {
                    ListenEnd::RefreshDue => {
                        core.apply(&account_id, AccountEvent::RefreshDue);
                        // Mark the generation so a superseded transport never leaks.
                        core.supervisor.start_new();
                        continue;
                    }
                    ListenEnd::StreamBroken => {
                        log::warn!("core: {}", sanitize_log("registration stream lost; reconnecting"));
                        core.apply(&account_id, AccountEvent::NetError);
                        failed += 1;
                        if policy.attempts_exhausted(failed) {
                            log::error!("core: reconnect attempts exhausted for '{account_id}'");
                            core.set_status_message(
                                &account_id,
                                "Network unreachable; retry budget exhausted",
                            );
                            return;
                        }
                        tokio::time::sleep(policy.delay_for(failed)).await;
                        core.apply(&account_id, AccountEvent::RetryTimerFired);
                    }
                }
            }
            Ok(RegisterOutcome::Challenged(_)) => {
                // register_once always answers one challenge; reaching here
                // means protocol confusion — fail visible, not silent.
                log::error!("core: unexpected bare challenge for '{account_id}'");
                core.apply(&account_id, AccountEvent::AuthRejected);
                return;
            }
            Ok(RegisterOutcome::Rejected { code, reason }) => {
                log::warn!("core: {}", sanitize_log(&format!("REGISTER rejected {code}: {reason}")));
                if code == 401 || code == 407 || code == 403 || code == 404 {
                    core.set_status_message(
                        &account_id,
                        "Registration rejected by registrar (authentication failed)",
                    );
                    core.apply(&account_id, AccountEvent::AuthRejected);
                    return;
                }
                core.apply(&account_id, AccountEvent::NetError);
                failed += 1;
                if policy.attempts_exhausted(failed) {
                    core.set_status_message(
                        &account_id,
                        "Network unreachable; retry budget exhausted",
                    );
                    return;
                }
                tokio::time::sleep(policy.delay_for(failed)).await;
                core.apply(&account_id, AccountEvent::RetryTimerFired);
            }
            Ok(RegisterOutcome::NetworkError { detail }) => {
                log::warn!("core: {}", sanitize_log(&detail));
                core.apply(&account_id, AccountEvent::NetError);
                failed += 1;
                if policy.attempts_exhausted(failed) {
                    core.set_status_message(
                        &account_id,
                        "Network unreachable; retry budget exhausted",
                    );
                    return;
                }
                tokio::time::sleep(policy.delay_for(failed)).await;
                core.apply(&account_id, AccountEvent::RetryTimerFired);
            }
            Err(e) => {
                log::warn!("core: {}", sanitize_log(&e));
                core.apply(&account_id, AccountEvent::NetError);
                failed += 1;
                if policy.attempts_exhausted(failed) {
                    core.set_status_message(
                        &account_id,
                        "Network unreachable; retry budget exhausted",
                    );
                    return;
                }
                tokio::time::sleep(policy.delay_for(failed)).await;
                core.apply(&account_id, AccountEvent::RetryTimerFired);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Native call + media core (Phase 2): INVITE/BYE/CANCEL lifecycle, SDES-SRTP,
// G.711 media, DTMF, routes. Secrets (keys, SDP bodies, passwords) never
// cross to the webview: commands return secret-free summaries and typed
// events carry only extensions + state. Wire transport binding (sending the
// sans-io messages over the Phase-1 TLS/TCP stream) is pending integration;
// until then the manager drives state + media and reports what to send via
// secret-free summaries.
// ---------------------------------------------------------------------------

/// Shared native call state (Tauri-managed).
pub struct CallCoreState {
    mgr: Mutex<CallManager>,
    /// Outbound SIP texts queued by commands for the connection tasks.
    /// `Registration` entries are drained by the registration worker's
    /// inbound multiplex loop (same verified stream the INVITE arrived on);
    /// `Call` entries are drained by the outbound call task (the stream the
    /// INVITE went out on). Bounded; oldest dropped past the cap.
    pending: Mutex<Vec<(WireTarget, String)>>,
    /// Live outbound call task (single-call invariant: aborted on new
    /// invite / unregister / remove).
    call_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    /// Live consult-leg task (attended-transfer consultation dialog).
    /// Aborted on new consult / hangup of the consult leg / teardown.
    consult_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    /// When the current call entered `Active` (Rust-owned timing).
    started_at: Mutex<Option<std::time::SystemTime>>,
}

/// Which connection task must send a queued SIP text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WireTarget {
    /// Registration stream (inbound legs: 200-to-INVITE, 603, in-dialog BYE,
    /// REFER/NOTIFY for inbound transfers).
    Registration,
    /// Outbound call stream (CANCEL, BYE, re-INVITE, REFER for the primary
    /// outgoing leg).
    Call,
    /// Consult stream (second outgoing dialog: CANCEL/BYE for consult).
    Consult,
}

impl CallCoreState {
    fn new() -> Self {
        Self {
            mgr: Mutex::new(CallManager::new()),
            pending: Mutex::new(Vec::new()),
            call_task: Mutex::new(None),
            consult_task: Mutex::new(None),
            started_at: Mutex::new(None),
        }
    }

    fn push_wire(&self, target: WireTarget, text: String) {
        let mut q = self.pending.lock().unwrap();
        if q.len() >= 16 {
            q.remove(0);
            log::warn!("call wire queue full; dropping oldest entry");
        }
        q.push((target, text));
    }

    fn drain_wire(&self, target: WireTarget) -> Vec<String> {
        let mut q = self.pending.lock().unwrap();
        let mut out = Vec::new();
        q.retain(|(t, text)| {
            if *t == target {
                out.push(text.clone());
                false
            } else {
                true
            }
        });
        out
    }

    fn clear_wire(&self) {
        self.pending.lock().unwrap().clear();
    }

    fn abort_call_task(&self) {
        if let Some(h) = self.call_task.lock().unwrap().take() {
            h.abort();
        }
    }

    fn abort_consult_task(&self) {
        if let Some(h) = self.consult_task.lock().unwrap().take() {
            h.abort();
        }
    }

    /// Track call timing: stamp on `Active` (kept across `Held`), clear when
    /// the leg is gone. Called on every call-state emit.
    fn note_call_state(&self, s: CallStateNative) {
        match s {
            CallStateNative::Active | CallStateNative::Held => {
                let mut g = self.started_at.lock().unwrap();
                if g.is_none() {
                    *g = Some(std::time::SystemTime::now());
                }
            }
            CallStateNative::Idle | CallStateNative::Ended | CallStateNative::Failed => {
                *self.started_at.lock().unwrap() = None;
            }
            _ => {}
        }
    }

    /// `(start epoch millis, duration secs)`; `(None, 0)` when idle.
    fn call_timing(&self) -> (Option<u64>, u64) {
        match *self.started_at.lock().unwrap() {
            None => (None, 0),
            Some(t) => {
                let duration = t.elapsed().map(|d| d.as_secs()).unwrap_or(0);
                let start = t
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .ok();
                (start, duration)
            }
        }
    }
}

/// Secret-free call summary returned to the webview (no SDP, no keys).
#[derive(Debug, Clone, serde::Serialize)]
struct CallSummary {
    call_id: String,
    peer: String,
    state: String,
}

fn summarize(mgr: &CallManager, call_id: &str, peer: &str) -> CallSummary {
    CallSummary {
        call_id: call_id.to_string(),
        peer: peer.to_string(),
        state: format!("{:?}", mgr.state()),
    }
}

/// Forward drained [`sip_core::call::CallEvent`]s to the webview.
fn forward_call_events(app: &AppHandle, mgr: &mut CallManager) {
    use tauri::Emitter;
    for ev in mgr.take_events() {
        let _ = app.emit("daad-call-event", &ev);
    }
}

/// Drain events, forwarding each to the webview, and return the last
/// call_id seen (so summaries carry the real id, never a placeholder).
fn forward_call_events_last_id(app: &AppHandle, mgr: &mut CallManager) -> Option<String> {
    use tauri::Emitter;
    let mut last = None;
    for ev in mgr.take_events() {
        match &ev {
            sip_core::call::CallEvent::OutgoingRinging { call_id, .. }
            | sip_core::call::CallEvent::IncomingRinging { call_id, .. }
            | sip_core::call::CallEvent::Active { call_id }
            | sip_core::call::CallEvent::Ended { call_id, .. } => {
                last = Some(call_id.clone());
            }
            // Waiting/swap/transfer events carry no new dialog identity for
            // the summary, but must still reach the webview.
            sip_core::call::CallEvent::CallWaiting { .. }
            | sip_core::call::CallEvent::Swapped { .. }
            | sip_core::call::CallEvent::TransferRequested { .. }
            | sip_core::call::CallEvent::TransferFailed { .. } => {}
            _ => {}
        }
        let _ = app.emit("daad-call-event", &ev);
    }
    last
}

#[tauri::command]
async fn call_invite(
    app: AppHandle,
    core: State<'_, CallCoreState>,
    extension: String,
) -> Result<CallSummary, String> {
    let mut mgr = core.mgr.lock().map_err(|e| format!("call core poisoned: {e}"))?;
    mgr.invite(&extension)
        .map_err(|e| sanitize_log(&e.to_string()))?;
    let peer = extension.trim().to_string();
    let call_id = forward_call_events_last_id(&app, &mut mgr).unwrap_or_default();
    Ok(summarize(&mgr, &call_id, &peer))
}

#[tauri::command]
async fn call_answer(app: AppHandle, core: State<'_, CallCoreState>) -> Result<CallSummary, String> {
    let mut mgr = core.mgr.lock().map_err(|e| format!("call core poisoned: {e}"))?;
    mgr.answer().map_err(|e| sanitize_log(&e.to_string()))?;
    let call_id = forward_call_events_last_id(&app, &mut mgr).unwrap_or_default();
    Ok(summarize(&mgr, &call_id, ""))
}

#[tauri::command]
async fn call_reject(
    app: AppHandle,
    core: State<'_, CallCoreState>,
    busy: Option<bool>,
) -> Result<(), String> {
    let mut mgr = core.mgr.lock().map_err(|e| format!("call core poisoned: {e}"))?;
    mgr.reject(busy.unwrap_or(false))
        .map_err(|e| sanitize_log(&e.to_string()))?;
    forward_call_events(&app, &mut mgr);
    Ok(())
}

#[tauri::command]
async fn call_hangup(app: AppHandle, core: State<'_, CallCoreState>) -> Result<(), String> {
    let mut mgr = core.mgr.lock().map_err(|e| format!("call core poisoned: {e}"))?;
    mgr.hangup().map_err(|e| sanitize_log(&e.to_string()))?;
    forward_call_events(&app, &mut mgr);
    Ok(())
}

#[tauri::command]
async fn call_mute(core: State<'_, CallCoreState>, muted: bool) -> Result<bool, String> {
    let mut mgr = core.mgr.lock().map_err(|e| format!("call core poisoned: {e}"))?;
    mgr.set_muted(muted).map_err(|e| sanitize_log(&e.to_string()))?;
    Ok(mgr.is_muted())
}

#[tauri::command]
async fn call_hold(core: State<'_, CallCoreState>, held: bool) -> Result<String, String> {
    let mut mgr = core.mgr.lock().map_err(|e| format!("call core poisoned: {e}"))?;
    if held {
        mgr.hold().map_err(|e| sanitize_log(&e.to_string()))?;
    } else {
        mgr.resume().map_err(|e| sanitize_log(&e.to_string()))?;
    }
    Ok(format!("{:?}", mgr.state()))
}

#[tauri::command]
async fn call_dtmf(core: State<'_, CallCoreState>, digit: String) -> Result<u8, String> {
    let mut mgr = core.mgr.lock().map_err(|e| format!("call core poisoned: {e}"))?;
    let ch = digit.chars().next().ok_or_else(|| "empty digit".to_string())?;
    mgr.dtmf(ch).map_err(|e| sanitize_log(&e.to_string()))?;
    Ok(sip_core::call::CallManager::dtmf_pt())
}

#[tauri::command]
async fn call_audio_route(core: State<'_, CallCoreState>, route: String) -> Result<String, String> {
    use sip_core::audio::AudioRoute;
    let route = AudioRoute::parse(&route).ok_or_else(|| format!("unknown route '{route}'"))?;
    let mut mgr = core.mgr.lock().map_err(|e| format!("call core poisoned: {e}"))?;
    mgr.set_audio_route(route);
    Ok(mgr.audio_route().as_str().to_string())
}

#[tauri::command]
async fn call_state(core: State<'_, CallCoreState>) -> Result<String, String> {
    let mgr = core.mgr.lock().map_err(|e| format!("call core poisoned: {e}"))?;
    Ok(format!("{:?}", mgr.state()))
}

/// Logout/suspend path: tears down media + dialog and releases devices.
/// Window hide (tray minimize) does NOT call this — minimizing never ends a call.
#[tauri::command]
async fn call_teardown(
    app: AppHandle,
    core: State<'_, CallCoreState>,
    reason: String,
) -> Result<(), String> {
    use sip_core::audio::TeardownReason;
    let reason = match reason.trim().to_lowercase().as_str() {
        "logout" => TeardownReason::Logout,
        "suspend" => TeardownReason::Suspend,
        "failure" => TeardownReason::Failure,
        _ => TeardownReason::Bye,
    };
    let mut mgr = core.mgr.lock().map_err(|e| format!("call core poisoned: {e}"))?;
    mgr.teardown_all(reason);
    forward_call_events(&app, &mut mgr);
    Ok(())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(&["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let bridge_manager = Arc::new(SipBridgeManager::new());

    tauri::Builder::default()
        .manage(bridge_manager)
        .manage(Arc::new(CoreState::new()))
        .manage(CallCoreState::new())
        .invoke_handler(tauri::generate_handler![start_sip_bridge, stop_sip_bridge, open_url, account_upsert, account_remove, register, unregister, registration_status, diagnostics_export_sanitized, call_invite, call_answer, call_reject, call_hangup, call_mute, call_hold, call_dtmf, call_audio_route, call_state, call_teardown, sip_account_upsert, sip_account_remove, sip_register, sip_unregister, sip_status, sip_call_invite, sip_call_answer, sip_call_answer_waiting, sip_call_reject, sip_call_hangup, sip_call_mute, sip_call_hold, sip_call_swap, sip_call_consult, sip_call_transfer_blind, sip_call_transfer_attended, sip_call_dtmf, sip_audio_route, sip_diagnostics_export])

        .setup(|app| {
            // Hand the webview handle to the native core so background
            // registration workers can push `sip://*` status events.
            if let Some(core) = app.try_state::<Arc<CoreState>>() {
                core.set_app(app.handle().clone());
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Register Process plugin
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_process::init())?;
            }

            // Create System Tray Menu
            let show_item = MenuItem::with_id(app, "show", "Show Daad", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            // Build Tray Icon
            if let Some(icon) = app.default_window_icon() {
                let _tray = TrayIconBuilder::new()
                    .icon(icon.clone())
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .tooltip("Daad Softphone")
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app)?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Intercept window close: hide the window instead of killing process
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod native_facade_tests {
    use super::*;

    #[test]
    fn tls_errors_classify_to_actionable_guidance() {
        // Inputs mirror sanitize_log output: variant keywords, redacted IDs.
        let unknown = classify_tls_error("handshake failed: invalid peer certificate: UnknownIssuer");
        assert!(unknown.contains("not signed by a trusted CA"), "{unknown}");
        assert!(unknown.contains("paste the Core CA"), "{unknown}");

        let expired = classify_tls_error("handshake failed: invalid peer certificate: Expired");
        assert!(expired.contains("expired"), "{expired}");

        let san = classify_tls_error("handshake failed: invalid peer certificate: NotValidForName");
        assert!(san.contains("does not cover this host"), "{san}");

        let sni = classify_tls_error("server name rejected: empty host");
        assert!(sni.contains("Server field"), "{sni}");

        let fallback = classify_tls_error("handshake failed: unexpected message");
        assert!(fallback.contains("fail-closed"), "{fallback}");

        // Guidance must never echo identities or network details.
        for m in [&unknown, &expired, &san, &sni, &fallback] {
            assert!(!m.contains("10.41.113.71"), "{m}");
            assert!(!m.contains("guest-2001"), "{m}");
        }
    }

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

    #[test]
    fn call_state_mapping_covers_all_native_states() {
        use CallStateNative as S;
        for (native, expect) in [
            (S::Idle, "Idle"),
            (S::OutgoingRinging, "Calling"),
            (S::IncomingRinging, "Ringing"),
            (S::Active, "Active"),
            (S::Held, "Holding"),
            (S::Ended, "Idle"),
            (S::Failed, "Idle"),
        ] {
            assert_eq!(frontend_call_state(native), expect);
        }
    }

    #[test]
    fn native_status_never_confuses_socket_with_registration() {
        let core = CoreState::new();
        // No provisioning yet: everything false, failure none.
        let s = native_status_of(&core, NATIVE_ACCOUNT_ID);
        assert!(!s.transport_open && !s.registered && !s.tls_verified);
        assert_eq!(s.failure_kind, "none");
        assert_eq!(s.contacts_reachable, 0);
        assert!(s.message.is_none(), "no secret-adjacent text in status");

        // Disabled + TLS profile: not-applicable cert is wrong (unknown),
        // and a bare socket must never read as registered.
        core.profiles.lock().unwrap().insert(
            NATIVE_ACCOUNT_ID.to_string(),
            SipProfile {
                account_id: NATIVE_ACCOUNT_ID.into(),
                hostname: "pbx.example.com".into(),
                port: 5061,
                transport: SipTransport::Tls,
                username: "2001".into(),
                extension: Some("2001".into()),
                display_name: None,
                domain: None,
                ca_pem: None,
                expires_secs: 600,
                codecs: vec![AudioCodec::Pcmu, AudioCodec::Pcma],
                media: MediaPolicy::default(),
                interop_opus: false,
            },
        );
        core.apply(NATIVE_ACCOUNT_ID, AccountEvent::EnableRequested);
        core.apply(NATIVE_ACCOUNT_ID, AccountEvent::TcpConnected);
        let s = native_status_of(&core, NATIVE_ACCOUNT_ID);
        assert!(s.transport_open && s.tls_verified && s.registering);
        assert!(!s.registered, "socket-open is not registered");
        assert_eq!(s.cert_status, "verified");
    }

    #[test]
    fn native_status_failure_kinds() {
        let core = CoreState::new();
        core.apply(NATIVE_ACCOUNT_ID, AccountEvent::EnableRequested);
        core.apply(NATIVE_ACCOUNT_ID, AccountEvent::TcpConnected);
        core.apply(NATIVE_ACCOUNT_ID, AccountEvent::AuthRejected);
        let s = native_status_of(&core, NATIVE_ACCOUNT_ID);
        assert_eq!(s.failure_kind, "auth");
        assert!(!s.registered);
    }
}
