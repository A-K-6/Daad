mod account_config;
mod credentials;
mod pjsip_engine;
use account_config::{parse_server_url, parse_sip_uri, validate_custom_ca};

#[tauri::command]
async fn open_url(_app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|_| "Invalid URL")?;
    if !matches!(parsed.scheme(), "https" | "http") { return Err("Only web links can be opened".into()); }
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "linux")]
    let mut command = std::process::Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let mut command = { let mut c = std::process::Command::new("rundll32"); c.arg("url.dll,FileProtocolHandler"); c };
    #[cfg(mobile)]
    {
        use tauri_plugin_mobile::MobileExt;
        return tauri::async_runtime::spawn_blocking(move || _app.mobile().open_url(url)).await.map_err(|_| "Could not open browser".to_string())?;
    }
    #[cfg(desktop)]
    command.arg(url).spawn().map_err(|e| e.to_string())?;
    #[cfg(desktop)]
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() { pjsip_engine::run(); }
