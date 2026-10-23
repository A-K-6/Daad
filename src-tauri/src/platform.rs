//! Platform services never pass account secrets through the webview.
use crate::credentials::CredentialStore;

#[cfg(not(target_os = "android"))]
pub fn credentials(_: &tauri::AppHandle) -> Box<dyn CredentialStore> {
    Box::new(crate::credentials::KeyringStore::new())
}
#[cfg(not(target_os = "android"))]
pub fn prepare(_: &tauri::AppHandle) -> Result<(), String> { Ok(()) }
#[cfg(not(any(target_os = "android", target_os = "windows")))]
pub fn system_ca(_: &tauri::AppHandle) -> Result<String, String> { Ok(String::new()) }
#[cfg(target_os = "windows")]
pub fn system_ca(_: &tauri::AppHandle) -> Result<String, String> {
    use base64::Engine;
    let roots = rustls_native_certs::load_native_certs();
    if roots.certs.is_empty() { return Err("Windows trusted certificates are unavailable; import your PBX CA in Settings.".into()); }
    Ok(roots.certs.iter().map(|cert| {
        let encoded = base64::engine::general_purpose::STANDARD.encode(cert.as_ref());
        let lines = encoded.as_bytes().chunks(64).map(|line| std::str::from_utf8(line).unwrap()).collect::<Vec<_>>().join("\n");
        format!("-----BEGIN CERTIFICATE-----\n{lines}\n-----END CERTIFICATE-----\n")
    }).collect())
}
#[cfg(not(target_os = "android"))]
pub fn session(_: &tauri::AppHandle, _: bool) -> Result<(), String> { Ok(()) }
#[cfg(not(target_os = "android"))]
pub fn call_state(_: &tauri::AppHandle, _: &str) {}

#[cfg(target_os = "android")]
mod android {
    use super::*;
    use tauri::Manager;
    use tauri_plugin_phone_platform::PhonePlatform;
    struct Store(tauri::AppHandle);
    fn phone(app: &tauri::AppHandle) -> tauri::State<'_, PhonePlatform> { app.state() }
    impl CredentialStore for Store {
        fn store_password(&self, id: &str, value: &str) -> Result<(), String> { phone(&self.0).store(id, value) }
        fn load_password(&self, id: &str) -> Result<Option<String>, String> { phone(&self.0).load(id) }
        fn delete_password(&self, id: &str) -> Result<(), String> { phone(&self.0).delete(id) }
    }
    pub fn credentials(app: &tauri::AppHandle) -> Box<dyn CredentialStore> { Box::new(Store(app.clone())) }
    pub fn prepare(app: &tauri::AppHandle) -> Result<(), String> { phone(app).prepare() }
    pub fn system_ca(app: &tauri::AppHandle) -> Result<String, String> { phone(app).system_ca() }
    pub fn session(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> { phone(app).session(enabled) }
    pub fn call_state(app: &tauri::AppHandle, state: &str) { let _ = phone(app).call_state(state); }
    pub fn open_url(url: String) -> Result<(), String> {
        tauri_plugin_phone_platform::open_url(url)
    }
    // PJSIP's JNI_OnLoad is disabled to avoid colliding with Tauri's entry point.
    // Initialize its JVM from the plugin before the native phone thread starts.
    #[no_mangle]
    pub extern "system" fn Java_com_daad_phone_PhonePlugin_nativeInitialize(env: jni::JNIEnv, _: jni::objects::JClass) {
        if let Ok(vm) = env.get_java_vm() {
            extern "C" { fn daad_android_set_jvm(vm: *mut std::ffi::c_void); }
            unsafe { daad_android_set_jvm(vm.get_java_vm_pointer().cast()); }
        }
    }
}
#[cfg(target_os = "android")]
pub use android::*;
