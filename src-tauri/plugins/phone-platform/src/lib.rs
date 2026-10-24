use tauri::{plugin::{Builder, PluginHandle, TauriPlugin}, Manager, Wry};
use serde::Deserialize;
use serde_json::json;
use std::sync::{OnceLock, atomic::{AtomicU64, Ordering}};

pub struct PhonePlatform(PluginHandle<Wry>, AtomicU64);
static PHONE: OnceLock<PluginHandle<Wry>> = OnceLock::new();
#[derive(Deserialize)]
struct Value { value: Option<String> }
impl PhonePlatform {
    fn unit(&self, command: &str, payload: serde_json::Value) -> Result<(), String> {
        self.0.run_mobile_plugin::<serde_json::Value>(command, payload)
            .map(|_| ()).map_err(|_| format!("Android phone service failed: {command}"))
    }
    pub fn store(&self, id: &str, value: &str) -> Result<(), String> { self.unit("store", json!({"id":id,"value":value})) }
    pub fn load(&self, id: &str) -> Result<Option<String>, String> {
        self.0.run_mobile_plugin::<Value>("load", json!({"id":id}))
            .map(|r| r.value).map_err(|_| "Android secure account store is unavailable".into())
    }
    pub fn delete(&self, id: &str) -> Result<(), String> { self.unit("delete", json!({"id":id})) }
    pub fn prepare(&self) -> Result<(), String> {
        self.0.run_mobile_plugin::<serde_json::Value>("prepare", ())
            .map(|_| ()).map_err(|_| "Allow microphone and notification access in Android app settings, then reconnect.".into())
    }
    pub fn system_ca(&self) -> Result<String, String> {
        self.0.run_mobile_plugin::<Value>("systemCa", ())
            .map_err(|_| "Android trusted certificates are unavailable".to_string())?
            .value.ok_or_else(|| "Android trusted certificates are empty".into())
    }
    pub fn session(&self, enabled: bool) -> Result<(), String> {
        let sequence = self.1.fetch_add(1, Ordering::Relaxed);
        self.unit("session", json!({"enabled":enabled,"sequence":sequence}))
    }
    pub fn call_state(&self, state: &str) {
        let handle = self.0.clone();
        let payload = json!({"state":state,"sequence":self.1.fetch_add(1, Ordering::Relaxed)});
        // Never block the native snapshot mutex waiting for the Android UI
        // thread: a concurrent status IPC may be waiting for that same mutex.
        tauri::async_runtime::spawn(async move {
            let _ = handle.run_mobile_plugin_async::<serde_json::Value>("callState", payload).await;
        });
    }
}
pub fn open_url(url: String) -> Result<(), String> {
    PHONE.get().ok_or("Android service is unavailable")?
        .run_mobile_plugin::<serde_json::Value>("openUrl", json!({"url":url}))
        .map(|_| ()).map_err(|_| "Could not open web link".into())
}
pub fn init() -> TauriPlugin<Wry> {
    Builder::new("phone-platform").setup(|app, api| {
        let handle = api.register_android_plugin("com.daad.phone", "PhonePlugin")?;
        let _ = PHONE.set(handle.clone());
        app.manage(PhonePlatform(handle, AtomicU64::new(1)));
        Ok(())
    }).build()
}
