fn main() {
    link_apple_compiler_runtime();
    tauri_build::build()
}

/// ONNX Runtime's prebuilt macOS library calls a helper (`__isPlatformVersionAtLeast`) that lives in
/// Apple's compiler runtime, which Rust does not link by default. Only needed when ONNX Runtime is linked in (`ai-static`); the normal `ai` feature loads it from a file.
fn link_apple_compiler_runtime() {
    let wants_ai_static = std::env::var_os("CARGO_FEATURE_AI_STATIC").is_some();
    let on_macos = std::env::var("CARGO_CFG_TARGET_OS").is_ok_and(|os| os == "macos");
    if !(wants_ai_static && on_macos) {
        return;
    }
    let resource_dir = std::process::Command::new("xcrun")
        .args(["clang", "--print-resource-dir"])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string());
    if let Some(dir) = resource_dir {
        let runtime = std::path::Path::new(&dir).join("lib/darwin/libclang_rt.osx.a");
        if runtime.exists() {
            println!("cargo:rustc-link-arg={}", runtime.display());
        }
    } else {
        println!("cargo:warning=could not find Apple's compiler runtime; linking the `ai` feature may fail");
    }
}
