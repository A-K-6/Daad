//! Mobile OS integration only. SIP and audio streams remain owned by PJSIP.
use tauri::{plugin::{Builder, TauriPlugin}, Manager, Runtime};
#[cfg(mobile)]
use tauri::plugin::PluginHandle;
#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_mobile);

pub struct Mobile<R: Runtime> {
    #[cfg(mobile)]
    handle: PluginHandle<R>,
    #[cfg(desktop)]
    _runtime: std::marker::PhantomData<fn() -> R>,
}
pub trait MobileExt<R: Runtime> {
    fn mobile(&self) -> &Mobile<R>;
}
impl<R: Runtime, T: Manager<R>> MobileExt<R> for T {
    fn mobile(&self) -> &Mobile<R> { self.state::<Mobile<R>>().inner() }
}
impl<R: Runtime> Mobile<R> {
    pub fn prepare_audio(&self) -> Result<(), String> {
        #[cfg(mobile)]
        {
            #[derive(serde::Deserialize)]
            struct Permission { granted: bool }
            let permission: Permission = self.handle.run_mobile_plugin("prepareAudio", ())
                .map_err(|_| "Could not request microphone permission.".to_string())?;
            if !permission.granted { return Err("Allow microphone access in system settings before connecting.".into()); }
        }
        Ok(())
    }
    #[cfg(mobile)]
    pub fn open_url(&self, url: String) -> Result<(), String> {
        self.handle.run_mobile_plugin::<serde_json::Value>("openUrl", serde_json::json!({"url": url}))
            .map(|_| ()).map_err(|_| "Could not open the system browser.".into())
    }
}
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mobile").setup(|app, _api| {
        #[cfg(target_os = "android")]
        let handle = _api.register_android_plugin("com.daad.mobile", "MobilePlugin")?;
        #[cfg(target_os = "ios")]
        let handle = _api.register_ios_plugin(init_plugin_mobile)?;
        app.manage(Mobile::<R> {
            #[cfg(mobile)]
            handle,
            #[cfg(desktop)]
            _runtime: std::marker::PhantomData,
        });
        Ok(())
    }).build()
}
