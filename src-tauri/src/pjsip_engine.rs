//! Single-threaded command adapter to PJSUA. No SIP or media implementation
//! lives here: PJSIP owns transactions, registration refresh and audio I/O.
use std::{ffi::{c_char, c_int, c_void, CStr, CString}, sync::{mpsc, Arc, Mutex}, time::{SystemTime, UNIX_EPOCH}};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, Manager, State};
use tauri_plugin_mobile::MobileExt;
use crate::credentials::{CredentialStore, KeyringStore};

#[repr(C)]
#[derive(Clone, Copy)]
struct Event { kind: c_int, code: c_int, state: c_int, incoming: c_int, connected_seconds: c_int, remote: [c_char; 512] }
extern "C" {
    fn daad_init(callback: extern "C" fn(*mut c_void, *const Event), context: *mut c_void, null_audio: c_int) -> c_int;
    fn daad_poll(ms: c_int);
    fn daad_destroy();
    fn daad_account(host: *const c_char, port: c_int, transport: *const c_char, identity: *const c_char,
        registrar: *const c_char, username: *const c_char, password: *const c_char, ca: *const c_char, expires: c_int) -> c_int;
    fn daad_register(enabled: c_int) -> c_int;
    fn daad_dial(uri: *const c_char) -> c_int;
    fn daad_answer() -> c_int;
    fn daad_hangup(reject: c_int) -> c_int;
    fn daad_mute(muted: c_int) -> c_int;
    fn daad_hold(held: c_int) -> c_int;
    fn daad_dtmf(digits: *const c_char) -> c_int;
    fn daad_error(code: c_int, buf: *mut c_char, len: c_int);
}

#[derive(Clone, Serialize, Deserialize)]
struct Account {
    host: String, port: u16, transport: String, identity: String,
    username: String, password: String, ca: String, expires: u32,
}
impl Account {
    fn trusted_ca(&self) -> &str {
        if self.ca.is_empty() { public_roots() } else { &self.ca }
    }
    fn registrar(&self) -> String {
        let host = if self.host.contains(':') { format!("[{}]", self.host) } else { self.host.clone() };
        format!("sip:{host}:{};transport={}", self.port, self.transport)
    }
    fn destination(&self, target: &str) -> Result<String, String> {
        validate_target(target)?;
        Ok(self.registrar().replacen("sip:", &format!("sip:{target}@"), 1))
    }
}

// Static OpenSSL must not depend on CA files in the build machine's prefix.
// Private PBX trust remains an explicit per-account override.
fn public_roots() -> &'static str {
    use base64::Engine as _;
    static ROOTS: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    ROOTS.get_or_init(|| {
        let mut pem = String::new();
        for certificate in webpki_root_certs::TLS_SERVER_ROOT_CERTS {
            pem.push_str("-----BEGIN CERTIFICATE-----\n");
            let encoded = base64::engine::general_purpose::STANDARD.encode(certificate.as_ref());
            for line in encoded.as_bytes().chunks(64) {
                pem.push_str(std::str::from_utf8(line).unwrap());
                pem.push('\n');
            }
            pem.push_str("-----END CERTIFICATE-----\n");
        }
        pem
    })
}

fn validate_target(target: &str) -> Result<(), String> {
    let digits = target.strip_prefix('+').unwrap_or(target);
    if !(1..=20).contains(&digits.len()) || !digits.bytes().all(|c| c.is_ascii_digit()) {
        return Err("Enter a phone number or extension (digits, with an optional leading +).".into());
    }
    Ok(())
}
fn cstr(value: &str) -> Result<CString, String> { CString::new(value).map_err(|_| "Invalid NUL character in account or number".into()) }
fn result(code: i32) -> Result<(), String> {
    if code == 0 { return Ok(()); }
    let mut text = [0 as c_char; 256];
    unsafe { daad_error(code, text.as_mut_ptr(), text.len() as i32); }
    let error = unsafe { CStr::from_ptr(text.as_ptr()) }.to_string_lossy();
    Err(format!("Native phone error: {error} ({code})"))
}
extern "C" fn callback(context: *mut c_void, event: *const Event) {
    // Sender stays alive until pjsua_destroy has joined all PJSIP workers.
    if context.is_null() || event.is_null() { return; }
    let sender = unsafe { &*(context as *const mpsc::Sender<Event>) };
    let _ = sender.send(unsafe { *event });
}
fn millis() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }

fn call_failure_message(code: i32) -> String {
    let reason = match code {
        403 => "The PBX did not allow this call. Check this account's calling permissions.",
        404 | 484 => "The PBX could not route this number or extension. Check its dial plan.",
        480 => "The destination is currently unavailable.",
        486 => "The destination is busy.",
        488 => "The PBX and client could not agree on audio or encryption settings.",
        _ => "The call failed. Check the destination and PBX.",
    };
    format!("{reason} (SIP {code})")
}

struct Snapshot { connection: Value, call: Value, tls: bool, enabled: bool }
impl Default for Snapshot {
    fn default() -> Self { Self {
        connection: json!({"transportOpen":false,"tlsVerified":false,"registered":false,
            "registering":false,"reconnecting":false,"failureKind":"none","message":null,
            "certStatus":"unknown","contactsReachable":0}),
        call: json!({"state":"Idle","info":null}), tls: true, enabled: false,
    } }
}
impl Snapshot {
    fn emit(&self, app: &tauri::AppHandle) {
        let _ = app.emit("sip://connection-state", &self.connection);
        let _ = app.emit("sip://cert-status", &self.connection["certStatus"]);
        let _ = app.emit("sip://call-state", &self.call);
    }
    fn event(&mut self, event: Event, app: &tauri::AppHandle) {
        match event.kind {
            1 => {
                let registered = self.enabled && event.state != 0;
                self.connection["registered"] = json!(registered);
                self.connection["registering"] = json!(false);
                self.connection["reconnecting"] = json!(false);
                if registered {
                    self.connection["transportOpen"] = json!(true);
                    self.connection["tlsVerified"] = json!(self.tls);
                    self.connection["certStatus"] = json!(if self.tls { "verified" } else { "not-applicable" });
                    self.connection["failureKind"] = json!("none");
                    self.connection["message"] = Value::Null;
                } else if self.enabled && event.code >= 400 && self.connection["failureKind"] != "cert" {
                    self.connection["failureKind"] = json!(if [401,403,407].contains(&event.code) { "auth" } else { "generic" });
                    self.connection["message"] = json!(format!("Registration failed (SIP {}). Check the account and server.", event.code));
                }
            }
            2 => {
                let state = match event.state { 1 => "Calling", 2|3 => "Ringing", 4 => "Calling", 5 => "Active", _ => "Idle" };
                if state == "Idle" {
                    if event.incoming == 0 && event.code >= 400 && event.code != 487 {
                        let _ = app.emit("daad-call-event", json!({"type":"failed", "reason":call_failure_message(event.code), "code":event.code}));
                    }
                    let _ = app.emit("daad-call-event", json!({"type":"ended","call_id":"native","reason":if event.code >= 400 {"failed"} else {"hangup"}}));
                    // Preserve the final timestamp/duration in the final event for history.
                    if self.call["info"].is_object() {
                        self.call["info"]["duration"] = json!(event.connected_seconds.max(0));
                    }
                    self.call["state"] = json!("Idle");
                    let _ = app.emit("sip://call-state", &self.call);
                    self.call["info"] = Value::Null;
                } else {
                    let remote = unsafe { CStr::from_ptr(event.remote.as_ptr()) }.to_string_lossy().to_string();
                    let start = self.call["info"]["startTime"].as_u64()
                        .or_else(|| if state == "Active" { Some(millis().saturating_sub(event.connected_seconds.max(0) as u64 * 1000)) } else { None });
                    let muted = self.call["info"]["isMuted"].as_bool().unwrap_or(false);
                    self.call = json!({"state":state,"info":{"remoteIdentity":remote,"remoteUri":remote,
                        "direction":if event.incoming != 0 {"incoming"} else {"outgoing"},
                        "startTime":start,"duration":event.connected_seconds.max(0),"isMuted":muted,"isHeld":false}});
                    if event.incoming != 0 && event.state == 2 {
                        #[cfg(desktop)]
                        if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus(); }
                    }
                }
            }
            3 => {
                if event.state == 0 {
                    self.connection["transportOpen"] = json!(true);
                    self.connection["tlsVerified"] = json!(self.tls);
                    self.connection["certStatus"] = json!(if self.tls {"verified"} else {"not-applicable"});
                } else {
                    self.connection["transportOpen"] = json!(false);
                    self.connection["registered"] = json!(false);
                    self.connection["tlsVerified"] = json!(false);
                    self.connection["reconnecting"] = json!(self.enabled);
                    if self.enabled && event.code != 0 {
                        let message = result(event.code).unwrap_err();
                        let cert = message.to_lowercase().contains("cert") || message.to_lowercase().contains("ssl");
                        self.connection["failureKind"] = json!(if cert {"cert"} else {"unreachable"});
                        self.connection["message"] = json!(message);
                        if cert { self.connection["certStatus"] = json!("failed"); }
                    }
                }
            }
            6 => {
                self.connection["transportOpen"] = json!(false);
                self.connection["tlsVerified"] = json!(false);
                self.connection["registered"] = json!(false);
                self.connection["registering"] = json!(false);
                self.connection["failureKind"] = json!("cert");
                self.connection["certStatus"] = json!("failed");
                self.connection["message"] = json!("Server certificate could not be verified. For a private PBX, load its CA certificate in SIP Settings. Also check the server address and certificate expiry.");
            }
            4 => {
                self.connection["message"] = json!("Audio could not start. Check microphone permission and the selected system audio devices.");
                let _ = app.emit("daad-call-event", json!({"type":"failed","reason":"Audio could not start","code":event.code}));
            }
            5 if self.call["info"].is_object() => {
                let held = event.state == 2 || event.state == 3;
                self.call["info"]["isHeld"] = json!(held);
                if held { self.call["state"] = json!("Holding"); }
                else if self.call["info"]["startTime"].is_number() { self.call["state"] = json!("Active"); }
            }
            _ => {}
        }
        self.emit(app);
    }
}

enum Op { Provision(Account), Register, Unregister, Remove, Dial(String), Answer, Hangup(bool), Mute(bool), Hold(bool), Dtmf(String), Shutdown }
struct Request { op: Op, reply: tokio::sync::oneshot::Sender<Result<(), String>> }
pub struct Engine { tx: mpsc::Sender<Request>, snapshot: Arc<Mutex<Snapshot>> }
impl Engine {
    fn start(app: tauri::AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<Request>();
        let snapshot = Arc::new(Mutex::new(Snapshot::default()));
        let state = snapshot.clone();
        std::thread::Builder::new().name("daad-phone".into()).spawn(move || {
            let (events_tx, events_rx) = mpsc::channel::<Event>();
            let sender = Box::new(events_tx);
            let context = (&*sender as *const mpsc::Sender<Event>) as *mut c_void;
            let vault = KeyringStore::new();
            let mut account: Option<Account> = None;
            let mut initialized = false;
            loop {
                let request = if initialized {
                    unsafe { daad_poll(20); }
                    match rx.try_recv() { Ok(r) => Some(r), Err(mpsc::TryRecvError::Empty) => None, Err(_) => break }
                } else {
                    match rx.recv() { Ok(r) => Some(r), Err(_) => break }
                };
                while let Ok(event) = events_rx.try_recv() { state.lock().unwrap().event(event, &app); }
                if let Some(request) = request {
                    if matches!(request.op, Op::Shutdown) {
                        if initialized { unsafe { daad_destroy(); } initialized = false; }
                        let _ = request.reply.send(Ok(())); break;
                    }
                    let outcome = (|| -> Result<(), String> {
                        match request.op {
                            Op::Provision(next) => {
                                if state.lock().unwrap().call["state"] != "Idle" { return Err("End the current call before changing accounts.".into()); }
                                if initialized { unsafe { daad_destroy(); } initialized = false; }
                                while events_rx.try_recv().is_ok() {}
                                open(&next, context)?;
                                initialized = true;
                                // One atomic vault item keeps account, CA and credentials together.
                                let saved = serde_json::to_string(&next).map_err(|_| "Could not save account")?;
                                if let Err(error) = vault.store_password("pjsip-account", &saved) {
                                    unsafe { daad_destroy(); } initialized = false;
                                    return Err(error);
                                }
                                let mut s = state.lock().unwrap();
                                *s = Snapshot::default(); s.tls = next.transport == "tls";
                                account = Some(next);
                            }
                            Op::Register => {
                                if !initialized {
                                    let saved = vault.load_password("pjsip-account")?.ok_or("No saved account. Sign in first.")?;
                                    let restored: Account = serde_json::from_str(&saved).map_err(|_| "Saved account is invalid; sign in again.")?;
                                    open(&restored, context)?;
                                    initialized = true;
                                    state.lock().unwrap().tls = restored.transport == "tls";
                                    account = Some(restored);
                                }
                                let mut s = state.lock().unwrap();
                                s.enabled = true;
                                s.connection["failureKind"] = json!("none"); s.connection["message"] = Value::Null;
                                s.connection["registering"] = json!(true);
                                result(unsafe { daad_register(1) })?;
                            }
                            Op::Unregister | Op::Remove => {
                                let remove = matches!(request.op, Op::Remove);
                                if initialized { result(unsafe { daad_register(0) })?; }
                                let mut s = state.lock().unwrap(); s.enabled = false;
                                s.connection = Snapshot::default().connection;
                                if remove {
                                    vault.delete_password("pjsip-account")?;
                                    account = None;
                                    if initialized { unsafe { daad_destroy(); } initialized = false; }
                                }
                            }
                            Op::Dial(target) => {
                                if !state.lock().unwrap().connection["registered"].as_bool().unwrap_or(false) { return Err("Connect your account before calling.".into()); }
                                let uri = cstr(&account.as_ref().ok_or("No account")?.destination(&target)?)?;
                                result(unsafe { daad_dial(uri.as_ptr()) })?;
                            }
                            Op::Answer => result(unsafe { daad_answer() })?,
                            Op::Hangup(reject) => result(unsafe { daad_hangup(reject as i32) })?,
                            Op::Mute(muted) => {
                                result(unsafe { daad_mute(muted as i32) })?;
                                state.lock().unwrap().call["info"]["isMuted"] = json!(muted);
                            }
                            Op::Hold(held) => result(unsafe { daad_hold(held as i32) })?,
                            Op::Dtmf(tone) => {
                                if tone.len() != 1 || !tone.bytes().all(|b| b.is_ascii_digit() || b == b'*' || b == b'#') { return Err("Invalid DTMF digit".into()); }
                                result(unsafe { daad_dtmf(cstr(&tone)?.as_ptr()) })?;
                            }
                            Op::Shutdown => unreachable!(),
                        }
                        Ok(())
                    })();
                    state.lock().unwrap().emit(&app);
                    let _ = request.reply.send(outcome);
                }
            }
            if initialized { unsafe { daad_destroy(); } }
            drop(sender);
        }).expect("Could not start native phone thread");
        Self { tx, snapshot }
    }
    async fn request(&self, op: Op) -> Result<(), String> {
        let (reply, response) = tokio::sync::oneshot::channel();
        self.tx.send(Request { op, reply }).map_err(|_| "Native phone stopped")?;
        response.await.map_err(|_| "Native phone stopped")?
    }
}
fn open(account: &Account, context: *mut c_void) -> Result<(), String> {
    let setup = (|| {
        result(unsafe { daad_init(callback, context, 0) })?;
        result(unsafe { daad_account(cstr(&account.host)?.as_ptr(), account.port as i32,
            cstr(&account.transport)?.as_ptr(), cstr(&account.identity)?.as_ptr(), cstr(&account.registrar())?.as_ptr(),
            cstr(&account.username)?.as_ptr(), cstr(&account.password)?.as_ptr(), cstr(account.trusted_ca())?.as_ptr(), account.expires as i32) })
    })();
    if setup.is_err() { unsafe { daad_destroy(); } }
    setup
}

async fn prepare_audio(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.mobile().prepare_audio()).await.map_err(|_| "Microphone permission request failed".to_string())?
}

#[tauri::command]
async fn sip_account_upsert(app: tauri::AppHandle, engine: State<'_, Engine>, server_url: String, sip_uri: String,
    username: String, password: String, custom_ca_pem: Option<String>, register_expires: Option<u32>) -> Result<(), String> {
    prepare_audio(app).await?;
    let (transport, host, port) = crate::parse_server_url(&server_url)?;
    crate::account_config::validate_device_username(&username)?;
    if password.is_empty() { return Err("Password is required to save an account.".into()); }
    let (user, domain) = crate::parse_sip_uri(&sip_uri)?;
    if user != username || domain.chars().any(|c| c.is_whitespace() || c == '<' || c == '>') {
        return Err("SIP address must match your account username and domain.".into());
    }
    let ca = crate::validate_custom_ca(custom_ca_pem)?.unwrap_or_default();
    let transport = transport.via_token().to_ascii_lowercase();
    engine.request(Op::Provision(Account { host, port, transport, identity: format!("sip:{user}@{domain}"),
        username, password, ca, expires: register_expires.unwrap_or(600).clamp(60, 3600) })).await
}
#[tauri::command]
async fn sip_register(app: tauri::AppHandle, engine: State<'_, Engine>) -> Result<(), String> {
    prepare_audio(app).await?;
    engine.request(Op::Register).await
}
#[tauri::command]
async fn sip_unregister(engine: State<'_, Engine>) -> Result<(), String> { engine.request(Op::Unregister).await }
#[tauri::command]
async fn sip_account_remove(engine: State<'_, Engine>) -> Result<(), String> { engine.request(Op::Remove).await }
#[tauri::command]
fn sip_status(engine: State<'_, Engine>) -> Value { engine.snapshot.lock().unwrap().connection.clone() }
#[tauri::command]
async fn sip_call_invite(engine: State<'_, Engine>, target: String) -> Result<(), String> { engine.request(Op::Dial(target)).await }
#[tauri::command]
async fn sip_call_answer(engine: State<'_, Engine>) -> Result<(), String> { engine.request(Op::Answer).await }
#[tauri::command]
async fn sip_call_reject(engine: State<'_, Engine>) -> Result<(), String> { engine.request(Op::Hangup(true)).await }
#[tauri::command]
async fn sip_call_hangup(engine: State<'_, Engine>) -> Result<(), String> { engine.request(Op::Hangup(false)).await }
#[tauri::command]
async fn sip_call_mute(engine: State<'_, Engine>, muted: bool) -> Result<(), String> { engine.request(Op::Mute(muted)).await }
#[tauri::command]
async fn sip_call_hold(engine: State<'_, Engine>, held: bool) -> Result<(), String> { engine.request(Op::Hold(held)).await }
#[tauri::command]
async fn sip_call_dtmf(engine: State<'_, Engine>, tone: String) -> Result<(), String> { engine.request(Op::Dtmf(tone)).await }
#[tauri::command]
fn sip_audio_route(route: String) -> Result<(), String> {
    if route == "system" { Ok(()) } else { Err("This alpha uses your system microphone and speaker. Select devices in system sound settings.".into()) }
}
#[tauri::command]
fn sip_diagnostics_export(engine: State<'_, Engine>) -> Value {
    let snapshot = engine.snapshot.lock().unwrap();
    json!({"engine":"PJSIP 2.17", "connection":snapshot.connection, "callState":snapshot.call["state"], "srtpRequired":true})
}

pub fn run() {
    #[cfg(desktop)]
    use tauri::{menu::{Menu, MenuItem}, tray::TrayIconBuilder};
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_mobile::init())
        .invoke_handler(tauri::generate_handler![sip_account_upsert, sip_account_remove, sip_register,
            sip_unregister, sip_status, sip_call_invite, sip_call_answer, sip_call_reject, sip_call_hangup,
            sip_call_mute, sip_call_hold, sip_call_dtmf, sip_audio_route, sip_diagnostics_export, crate::open_url, crate::runtime_platform])
        .setup(|app| {
            #[cfg(target_os = "android")]
            keyring_core::set_default_store(android_native_keyring_store::Store::new()?);
            app.manage(Engine::start(app.handle().clone()));
            #[cfg(desktop)]
            {
            let show = MenuItem::with_id(app, "show", "Show Daad", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            if let Some(icon) = app.default_window_icon() {
                TrayIconBuilder::new().icon(icon.clone()).menu(&menu).tooltip("Daad")
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus();
                        },
                        "quit" => app.exit(0),
                        _ => {}
                    }).build(app)?;
            }
            }
            Ok(())
        })
        .on_window_event(|_window, _event| {
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
            api.prevent_close(); let _ = _window.hide();
            }
        })
        .build(tauri::generate_context!()).expect("Could not start Daad");
    app.run(|app, event| if let tauri::RunEvent::Exit = event {
        if let Some(engine) = app.try_state::<Engine>() {
            let (reply, response) = tokio::sync::oneshot::channel();
            if engine.tx.send(Request { op: Op::Shutdown, reply }).is_ok() { let _ = response.blocking_recv(); }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn phone_numbers_and_extensions_are_supported_without_sip_injection() {
        for target in ["1", "1001", "02112345678", "+982112345678"] { assert!(validate_target(target).is_ok()); }
        for target in ["", "+", "123\r\nVia: bad", "sip:x@evil", "12;transport=udp"] { assert!(validate_target(target).is_err()); }
    }
    #[test]
    fn registrar_preserves_explicit_transport_and_port() {
        let account = Account { host: "::1".into(), port: 5061, transport: "tls".into(), identity: "sip:1001@localhost".into(),
            username: "1001".into(), password: "test".into(), ca: String::new(), expires: 600 };
        assert_eq!(account.destination("+123456789").unwrap(), "sip:+123456789@[::1]:5061;transport=tls");
    }
    #[test]
    fn account_trust_is_explicit_and_never_selected_by_host() {
        let mut account = Account { host: "pbx.example.com".into(), port: 5061, transport: "tls".into(),
            identity: "sip:test@pbx.example.com".into(), username: "test".into(),
            password: String::new(), ca: String::new(), expires: 600 };
        assert!(account.trusted_ca().starts_with("-----BEGIN CERTIFICATE-----"));
        assert_eq!(account.trusted_ca(), public_roots());
        account.ca = "explicit CA".into();
        assert_eq!(account.trusted_ca(), "explicit CA");
        let restored: Account = serde_json::from_str(&serde_json::to_string(&account).unwrap()).unwrap();
        assert_eq!(restored.trusted_ca(), "explicit CA");
    }
}
