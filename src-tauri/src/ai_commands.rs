//! Tauri commands for the optional AI add-on. Always compiled so the front end can ask what is available;
//! without the `ai` cargo feature every command reports that the build has no AI support.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::State;

pub const CREDITS: [&str; 3] = [
    "Alita (New Zealand species classifier), version 3.03: Olly and wekaResearch, with the Department of Conservation Predator Science team. Everyone involved is listed at https://github.com/Wologman/Alita",
    "MegaDetector v5a (animal detection): Dan Morris and contributors, https://github.com/agentmorris/MegaDetector",
    "ONNX Runtime: Microsoft, MIT licence",
];
/// Where the add-on's download details live. Developers can point `TRAAACE_AI_MANIFEST` at another address,
/// including a `file://` one for a folder on their own computer.
#[cfg_attr(not(feature = "ai"), allow(dead_code))]
pub const DEFAULT_MANIFEST_URL: &str = "https://traaace.ing/ai/manifest.json";
pub const LICENSE_NOTE: &str = "The models are GPL-3.0 (inherited from MegaDetector / YOLOv5). ONNX Runtime is MIT.";

#[derive(Default)]
pub struct AiState {
    cancel: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    install_cancel: Arc<AtomicBool>,
    installing: Arc<AtomicBool>,
    #[cfg(feature = "ai")]
    engine: Arc<std::sync::Mutex<crate::ai::scan::EngineCache<crate::ai::Engine>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    /// This build of the app can run the models at all.
    pub compiled: bool,
    pub installed: bool,
    /// Why the add-on cannot be used, when it cannot.
    pub problem: Option<String>,
    pub pack_dir: Option<String>,
    /// Where the add-on is (or will be) installed by the downloader.
    pub install_dir: String,
    /// The add-on in use is the one TRAAACE downloaded (so it can be removed from the app), not a folder chosen by hand.
    pub managed: bool,
    /// The installed add-on's version, when it came from the downloader.
    pub version: Option<String>,
    pub platform: &'static str,
    pub credits: Vec<&'static str>,
    pub license_note: &'static str,
    /// The add-on has the video tool (FFmpeg), so videos can be scanned too.
    pub video_tool: bool,
}

/// Only read by the `ai` build; the stub build just refuses the scan.
#[cfg_attr(not(feature = "ai"), allow(dead_code))]
#[derive(Debug, Clone, Deserialize)]
pub struct AiScanFile {
    pub id: String,
    pub path: String,
}

#[cfg_attr(not(feature = "ai"), allow(dead_code))]
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiScanEvent {
    Started { total: usize },
    Suggestion { suggestion: serde_json::Value, done: usize, failed: usize },
    Failure { id: String, error: String, done: usize, failed: usize },
    Finished { total: usize, done: usize, failed: usize, cancelled: bool },
    Error { message: String },
}

#[cfg_attr(not(feature = "ai"), allow(dead_code))]
pub const SCAN_EVENT: &str = "ai-scan";

/// What the user is told before agreeing to the download.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadInfo {
    pub version: String,
    pub title: String,
    pub model_name: String,
    pub download_bytes: u64,
    pub unpacked_bytes: u64,
    pub credits: Vec<String>,
    pub licenses: Vec<String>,
    pub requires_acceptance: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// `downloading` or `installing`.
    pub stage: &'static str,
    /// Plain-language name of the file being fetched.
    pub file: String,
    pub file_index: usize,
    pub file_count: usize,
    pub bytes_done: u64,
    pub bytes_total: u64,
}

#[cfg_attr(not(feature = "ai"), allow(dead_code))]
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiInstallEvent {
    Progress(Progress),
    Done { dir: String },
    Cancelled,
    Failed { message: String },
}

#[cfg_attr(not(feature = "ai"), allow(dead_code))]
pub const INSTALL_EVENT: &str = "ai-install";

#[tauri::command]
pub fn ai_status(app: tauri::AppHandle, pack_dir: Option<String>) -> AiStatus {
    imp::status(&app, pack_dir.as_deref())
}

#[tauri::command]
pub fn ai_scan_start(
    app: tauri::AppHandle,
    state: State<AiState>,
    files: Vec<AiScanFile>,
    known_species: Vec<String>,
    pack_dir: Option<String>,
) -> Result<(), String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("An AI scan is already running.".to_string());
    }
    state.cancel.store(false, Ordering::SeqCst);
    imp::start(app, files, known_species, pack_dir, &state).inspect_err(|_| {
        state.running.store(false, Ordering::SeqCst);
    })
}

/// What would be downloaded (size, credits, licence), before the user agrees.
#[tauri::command]
pub async fn ai_download_info() -> Result<DownloadInfo, String> {
    tauri::async_runtime::spawn_blocking(imp::download_info).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn ai_install_start(app: tauri::AppHandle, state: State<AiState>) -> Result<(), String> {
    if state.installing.swap(true, Ordering::SeqCst) {
        return Err("The AI add-on is already being installed.".to_string());
    }
    state.install_cancel.store(false, Ordering::SeqCst);
    imp::install_start(app, state.install_cancel.clone(), state.installing.clone()).inspect_err(|_| {
        state.installing.store(false, Ordering::SeqCst);
    })
}

/// Deletes the downloaded add-on. Never touches a folder the user or a developer pointed the app at.
#[tauri::command]
pub fn ai_uninstall(app: tauri::AppHandle, state: State<AiState>) -> Result<(), String> {
    if state.running.load(Ordering::SeqCst) || state.installing.load(Ordering::SeqCst) {
        return Err("Wait for the current scan or download to finish first.".to_string());
    }
    imp::uninstall(&app)
}

#[tauri::command]
pub fn ai_install_cancel(state: State<AiState>) {
    state.install_cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn ai_scan_cancel(state: State<AiState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[cfg(not(feature = "ai"))]
mod imp {
    use super::*;

    pub fn status(_app: &tauri::AppHandle, _pack_dir: Option<&str>) -> AiStatus {
        AiStatus {
            compiled: false,
            installed: false,
            problem: Some("This build of TRAAACE does not include AI support.".to_string()),
            pack_dir: None,
            install_dir: String::new(),
            managed: false,
            version: None,
            platform: "",
            credits: CREDITS.to_vec(),
            license_note: LICENSE_NOTE,
            video_tool: false,
        }
    }

    pub fn download_info() -> Result<DownloadInfo, String> {
        Err("This build of TRAAACE does not include AI support.".to_string())
    }

    pub fn install_start(_: tauri::AppHandle, _: Arc<AtomicBool>, _: Arc<AtomicBool>) -> Result<(), String> {
        Err("This build of TRAAACE does not include AI support.".to_string())
    }

    pub fn uninstall(_: &tauri::AppHandle) -> Result<(), String> {
        Err("This build of TRAAACE does not include AI support.".to_string())
    }

    pub fn start(_: tauri::AppHandle, _: Vec<AiScanFile>, _: Vec<String>, _: Option<String>, _: &AiState) -> Result<(), String> {
        Err("This build of TRAAACE does not include AI support.".to_string())
    }
}

#[cfg(feature = "ai")]
mod imp {
    use super::*;
    use crate::ai::download;
    use crate::ai::names::NameMap;
    use crate::ai::pack::{self, PackFiles};
    use crate::ai::scan::{run_scan, Event, ScanInput};
    use crate::ai::{Engine, Thresholds};
    use tauri::{Emitter, Manager};

    fn find_pack(app: &tauri::AppHandle, chosen: Option<&str>) -> Result<PackFiles, String> {
        let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let env = std::env::var("TRAAACE_AI_PACK").ok().filter(|d| !d.trim().is_empty());
        // A test folder that doesn't exist would otherwise be skipped quietly, and the app would offer the download.
        if let Some(dir) = env.as_deref().filter(|d| !std::path::Path::new(d).exists()) {
            return Err(format!("TRAAACE_AI_PACK points to {dir}, but that folder doesn't exist."));
        }
        pack::locate_first(&pack::candidate_dirs(chosen, env.as_deref(), &app_data))
    }

    fn install_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
        Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("ai"))
    }

    fn installed_version(dir: &std::path::Path) -> Option<String> {
        let text = std::fs::read_to_string(dir.join("manifest.json")).ok()?;
        pack::Manifest::parse_with(&text, true).ok().map(|m| m.version)
    }

    fn manifest_url() -> String {
        std::env::var("TRAAACE_AI_MANIFEST").unwrap_or_else(|_| DEFAULT_MANIFEST_URL.to_string())
    }

    /// The keys an add-on download list must be signed with: the ones built into the app, plus
    /// `TRAAACE_AI_TRUSTED_KEY` for testing an add-on you signed yourself.
    fn trusted_keys() -> Vec<String> {
        let mut keys: Vec<String> = crate::ai::trust::TRUSTED_KEYS.iter().map(|k| k.to_string()).collect();
        keys.extend(std::env::var("TRAAACE_AI_TRUSTED_KEY").ok().filter(|k| !k.trim().is_empty()));
        keys
    }

    fn fetch_offer(source: &dyn download::Source) -> Result<download::Offer, String> {
        download::fetch_offer(source, &manifest_url(), env!("CARGO_PKG_VERSION"), pack::current_platform(), &trusted_keys())
    }

    pub fn uninstall(app: &tauri::AppHandle) -> Result<(), String> {
        download::remove_installed(&install_root(app)?).map(|_| ())
    }

    pub fn download_info() -> Result<DownloadInfo, String> {
        fetch_offer(&download::AutoSource::new())?.info()
    }

    pub fn install_start(app: tauri::AppHandle, cancel: Arc<AtomicBool>, installing: Arc<AtomicBool>) -> Result<(), String> {
        let root = install_root(&app)?;
        std::thread::spawn(move || {
            let emit = |event: AiInstallEvent| {
                let _ = app.emit(INSTALL_EVENT, event);
            };
            let source = download::AutoSource::new();
            let result = fetch_offer(&source).and_then(|offer| {
                let mut last = std::time::Instant::now() - std::time::Duration::from_secs(1);
                download::install(&source, &offer, &root, &cancel, &mut |p| {
                    // Many small chunks arrive; the screen only needs a few updates a second.
                    if p.stage != "downloading" || last.elapsed() >= std::time::Duration::from_millis(150) || p.bytes_done == p.bytes_total {
                        last = std::time::Instant::now();
                        emit(AiInstallEvent::Progress(p));
                    }
                })
                .map_err(|e| match e {
                    download::InstallError::Cancelled => String::new(),
                    download::InstallError::Failed(message) => message,
                })
            });
            emit(match result {
                Ok(dir) => AiInstallEvent::Done { dir: dir.display().to_string() },
                Err(message) if message.is_empty() => AiInstallEvent::Cancelled,
                Err(message) => AiInstallEvent::Failed { message },
            });
            installing.store(false, Ordering::SeqCst);
        });
        Ok(())
    }

    pub fn status(app: &tauri::AppHandle, chosen: Option<&str>) -> AiStatus {
        let found = find_pack(app, chosen);
        AiStatus {
            compiled: true,
            installed: found.is_ok(),
            pack_dir: found.as_ref().ok().map(|p| p.dir.display().to_string()),
            install_dir: install_root(app).map(|d| d.join("pack").display().to_string()).unwrap_or_default(),
            managed: matches!((&found, install_root(app)), (Ok(p), Ok(root)) if p.dir == root.join("pack")),
            version: found.as_ref().ok().and_then(|p| installed_version(&p.dir)),
            video_tool: found.as_ref().is_ok_and(|p| p.video_tool.is_some()),
            problem: found.err(),
            platform: pack::current_platform(),
            credits: CREDITS.to_vec(),
            license_note: LICENSE_NOTE,
        }
    }

    pub fn start(
        app: tauri::AppHandle,
        files: Vec<AiScanFile>,
        known: Vec<String>,
        chosen: Option<String>,
        state: &AiState,
    ) -> Result<(), String> {
        let pack = find_pack(&app, chosen.as_deref())?;
        let (cancel, running, cache) = (state.cancel.clone(), state.running.clone(), state.engine.clone());
        std::thread::spawn(move || {
            let emit = |event: AiScanEvent| {
                let _ = app.emit(SCAN_EVENT, event);
            };
            emit(AiScanEvent::Started { total: files.len() });
            match run(&pack, &cache, &files, &known, &cancel, &emit) {
                Ok(()) => {}
                Err(message) => emit(AiScanEvent::Error { message }),
            }
            running.store(false, Ordering::SeqCst);
        });
        Ok(())
    }

    fn run(
        pack: &PackFiles,
        cache: &std::sync::Mutex<crate::ai::scan::EngineCache<Engine>>,
        files: &[AiScanFile],
        known: &[String],
        cancel: &AtomicBool,
        emit: &dyn Fn(AiScanEvent),
    ) -> Result<(), String> {
        let names = match &pack.name_map {
            Some(path) => NameMap::parse_csv(&std::fs::read_to_string(path).map_err(|e| e.to_string())?)?,
            None => NameMap::default(),
        };
        let mut cache = cache.lock().map_err(|_| "The AI models are in an unusable state. Restart TRAAACE.".to_string())?;
        let engine = cache.get_or_load(&pack.dir, || Engine::load(Some(&pack.runtime), &pack.models_dir, true))?;
        engine.set_video_tool(pack.video_tool.clone());
        let inputs: Vec<ScanInput> = files.iter().map(|f| ScanInput { id: f.id.clone(), path: f.path.clone() }).collect();
        let summary = run_scan(engine, &inputs, &names, known, &Thresholds::default(), cancel, |event, progress| {
            emit(match event {
                Event::Suggestion(s) => AiScanEvent::Suggestion {
                    suggestion: serde_json::to_value(s).unwrap_or_default(),
                    done: progress.done,
                    failed: progress.failed,
                },
                Event::Failure(f) => AiScanEvent::Failure { id: f.id, error: f.error, done: progress.done, failed: progress.failed },
            });
        });
        emit(AiScanEvent::Finished { total: summary.total, done: summary.done, failed: summary.failed, cancelled: summary.cancelled });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_are_tagged_for_the_front_end() {
        let json = serde_json::to_value(AiScanEvent::Finished { total: 3, done: 2, failed: 1, cancelled: false }).unwrap();
        assert_eq!(json["type"], "finished");
        assert_eq!(json["done"], 2);
        let json = serde_json::to_value(AiScanEvent::Error { message: "x".into() }).unwrap();
        assert_eq!(json["type"], "error");
    }

    #[test]
    fn status_is_camel_case() {
        let status = AiStatus { compiled: true, installed: false, problem: None, pack_dir: None, install_dir: String::new(), managed: false, version: None, platform: "x", credits: vec![], license_note: "", video_tool: false };
        let json = serde_json::to_value(status).unwrap();
        assert!(json.get("packDir").is_some() && json.get("licenseNote").is_some() && json.get("installDir").is_some());
    }

    #[test]
    fn credits_thank_the_author_and_the_predator_science_team() {
        let all = CREDITS.join(" ");
        assert!(all.contains("wekaResearch") && all.contains("Predator Science") && all.contains("MegaDetector"));
    }
}
