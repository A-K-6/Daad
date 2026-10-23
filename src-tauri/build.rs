fn main() {
    println!("cargo:rerun-if-changed=native/pjsua_adapter.c");
    println!("cargo:rerun-if-changed=native/pjsua_adapter.h");
    println!("cargo:rerun-if-env-changed=DAAD_PJSIP_PREFIX");
    {
        let prefix = std::env::var("DAAD_PJSIP_PREFIX").unwrap_or_else(|_| {
            let os = match std::env::var("CARGO_CFG_TARGET_OS").unwrap().as_str() {
                "macos" => "darwin".to_string(), "windows" => "win32".to_string(), other => other.to_string(),
            };
            let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
                "aarch64" => "arm64".to_string(), "x86_64" => "x64".to_string(), other => other.to_string(),
            };
            format!("{}/target/native/{os}-{arch}/install", std::env::var("CARGO_MANIFEST_DIR").unwrap())
        });
        let windows = std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "windows";
        if windows {
            let manifest = std::fs::read_to_string(format!("{prefix}/link.json"))
                .expect("Build PJSIP first: bun run native:prepare");
            let manifest: serde_json::Value = serde_json::from_str(&manifest).expect("Invalid PJSIP link manifest");
            let mut native = cc::Build::new();
            native.file("native/pjsua_adapter.c").define("PJ_WIN32", "1").define("PJ_WIN64", "1")
                .define("PJ_AUTOLINK", "0").define("NDEBUG", "1");
            for include in manifest["includes"].as_array().unwrap() { native.include(include.as_str().unwrap()); }
            // The PJSIP release libraries use /MD, including when Cargo checks a debug app.
            native.debug(false).opt_level(2).static_crt(false).compile("daad_pjsua_adapter");
            for dir in manifest["search"].as_array().unwrap() { println!("cargo:rustc-link-search=native={}", dir.as_str().unwrap()); }
            for lib in manifest["libraries"].as_array().unwrap() { println!("cargo:rustc-link-lib=static={}", lib.as_str().unwrap()); }
            for lib in ["ws2_32", "mswsock", "iphlpapi", "winmm", "ole32", "uuid", "secur32", "crypt32", "bcrypt", "advapi32", "user32", "netapi32", "dsound", "dxguid"] {
                println!("cargo:rustc-link-lib={lib}");
            }
        } else {
        std::env::set_var("PKG_CONFIG_PATH", format!("{prefix}/lib/pkgconfig"));
        if std::env::var("HOST").unwrap() != std::env::var("TARGET").unwrap() {
            std::env::set_var("PKG_CONFIG_ALLOW_CROSS", "1");
        }
        let library = pkg_config::Config::new().statik(true).cargo_metadata(false)
            .probe("libpjproject").expect("Build the native engine first: bun scripts/build-native.ts");
        let mut native = cc::Build::new();
        native.file("native/pjsua_adapter.c");
        for include in &library.include_paths { native.include(include); }
        for (key, value) in &library.defines { native.define(key, value.as_deref()); }
        native.compile("daad_pjsua_adapter");
        // Print link metadata after the adapter so static symbols resolve.
        pkg_config::Config::new().statik(true).probe("libpjproject").unwrap();
        }
    }
    tauri_build::build()
}
