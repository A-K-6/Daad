fn main() {
    println!("cargo:rerun-if-changed=native/pjsua_adapter.c");
    println!("cargo:rerun-if-changed=native/pjsua_adapter.h");
    println!("cargo:rerun-if-env-changed=DAAD_PJSIP_PREFIX");
    {
        let prefix = std::env::var("DAAD_PJSIP_PREFIX").unwrap_or_else(|_| {
            let os = match std::env::var("CARGO_CFG_TARGET_OS").unwrap().as_str() {
                "macos" => "darwin".to_string(), other => other.to_string(),
            };
            let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
                "aarch64" => "arm64".to_string(), "x86_64" => "x64".to_string(), other => other.to_string(),
            };
            format!("{}/target/native/{os}-{arch}/install", std::env::var("CARGO_MANIFEST_DIR").unwrap())
        });
        std::env::set_var("PKG_CONFIG_PATH", format!("{prefix}/lib/pkgconfig"));
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
    tauri_build::build()
}
