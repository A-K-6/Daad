fn main() {
    println!("cargo:rerun-if-changed=native/pjsua_adapter.c");
    println!("cargo:rerun-if-changed=native/pjsua_adapter.h");
    println!("cargo:rerun-if-env-changed=DAAD_PJSIP_PREFIX");
    let target = std::env::var("TARGET").unwrap();
    let base = format!("{}/target/native/{target}", std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let prefix = std::env::var("DAAD_PJSIP_PREFIX").unwrap_or_else(|_| format!("{base}/install"));
    let mut native = cc::Build::new();
    native.file("native/pjsua_adapter.c");
    if target.contains("windows-msvc") {
        native.include(format!("{prefix}/include"));
        native.define("PJ_WIN32", "1");
        if target.starts_with("aarch64") { native.define("PJ_M_ARM64", "1"); }
        else { native.define("PJ_WIN64", "1"); native.define("PJ_M_X86_64", "1"); }
        native.compile("daad_pjsua_adapter");
        let manifest = format!("{prefix}/windows-libs.json");
        println!("cargo:rerun-if-changed={manifest}");
        let libraries: Vec<String> = serde_json::from_str(&std::fs::read_to_string(manifest)
            .expect("Build native dependencies first: bun run native:prepare <target>")).unwrap();
        println!("cargo:rustc-link-search=native={prefix}/lib");
        println!("cargo:rustc-link-search=native={base}/openssl/lib");
        for library in libraries { println!("cargo:rustc-link-lib=static={library}"); }
        for library in ["libssl", "libcrypto"] { println!("cargo:rustc-link-lib=static={library}"); }
        for library in ["ws2_32", "mswsock", "winmm", "ole32", "secur32", "crypt32", "bcrypt", "advapi32", "user32", "iphlpapi"] {
            println!("cargo:rustc-link-lib={library}");
        }
    } else {
        // The target-specific directory prevents accidentally linking host archives,
        // including the two distinct arm64 Apple device/simulator platforms.
        std::env::set_var("PKG_CONFIG_PATH", format!("{prefix}/lib/pkgconfig"));
        if std::env::var("HOST").unwrap() != target { std::env::set_var("PKG_CONFIG_ALLOW_CROSS", "1"); }
        let library = pkg_config::Config::new().statik(true).cargo_metadata(false)
            .probe("libpjproject").expect("Build native dependencies first: bun run native:prepare <target>");
        for include in &library.include_paths { native.include(include); }
        for (key, value) in &library.defines { native.define(key, value.as_deref()); }
        native.compile("daad_pjsua_adapter");
        pkg_config::Config::new().statik(true).probe("libpjproject").unwrap();
    }
    tauri_build::build()
}
