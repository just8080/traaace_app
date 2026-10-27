//! The AI add-on ("pack"): its download manifest, and finding an installed pack on disk.

use serde::Deserialize;
use std::collections::HashSet;
use std::path::{Component as PathPart, Path, PathBuf};

pub const SUPPORTED_SCHEMA: u32 = 1;
pub const PACK_NAME: &str = "traaace-ai";

/// Which build of the pack matches this machine.
pub fn current_platform() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "macos-aarch64",
        ("macos", _) => "macos-x86_64",
        ("windows", _) => "windows-x86_64",
        _ => "linux-x86_64",
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    pub schema: u32,
    pub pack: String,
    pub version: String,
    #[serde(default)]
    pub min_app_version: Option<String>,
    pub notice: Notice,
    pub model: ModelInfo,
    pub components: Vec<Component>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Notice {
    pub title: String,
    #[serde(default)]
    pub requires_acceptance: bool,
    pub credits: Vec<String>,
    #[serde(default)]
    pub licenses: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub display_name: String,
    pub classes: u32,
    pub detector_component: String,
    pub classifier_component: String,
    pub class_names_component: String,
    #[serde(default)]
    pub name_map_component: Option<String>,
    #[serde(default = "uncalibrated")]
    pub score_kind: String,
    /// Optional Platt / temperature calibration, applied to scores when present.
    #[serde(default)]
    pub calibration: Option<serde_json::Value>,
}

fn uncalibrated() -> String {
    "uncalibrated".to_string()
}

#[derive(Debug, Clone, Deserialize)]
pub struct Component {
    pub id: String,
    /// A plain-language name for the download screen ("Animal detector"); falls back to the id.
    #[serde(default)]
    pub label: Option<String>,
    /// `runtime`, `model`, `data` or `tool`; other kinds are ignored so newer packs still load.
    pub kind: String,
    pub platforms: Vec<String>,
    pub install_path: String,
    #[serde(default = "yes")]
    pub required: bool,
    pub download: Download,
    pub unpacked: Unpacked,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
pub struct Download {
    pub url: String,
    #[serde(default = "no_compression")]
    pub compression: String,
    pub size: u64,
    pub sha256: String,
}

fn no_compression() -> String {
    "none".to_string()
}

#[derive(Debug, Clone, Deserialize)]
pub struct Unpacked {
    pub size: u64,
    pub sha256: String,
}

fn is_sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// A path inside the pack folder: relative, no `..`, no drive letters or backslashes.
pub fn is_safe_install_path(path: &str) -> bool {
    if path.is_empty() || path.contains('\\') || path.contains(':') || path.starts_with('/') {
        return false;
    }
    Path::new(path).components().all(|c| matches!(c, PathPart::Normal(_)))
}

fn version_parts(v: &str) -> Option<[u64; 3]> {
    let core = v.split(['-', '+']).next()?;
    let mut it = core.split('.').map(|p| p.parse::<u64>());
    let parts = [it.next()?.ok()?, it.next()?.ok()?, it.next()?.ok()?];
    it.next().is_none().then_some(parts)
}

/// The message for a computer the add-on has no ONNX Runtime for. Microsoft publishes no ONNX Runtime for Intel Macs
/// after version 1.23, so the add-on can't run there.
pub fn not_available_on(platform: &str) -> String {
    if platform == "macos-x86_64" {
        "The AI add-on isn't available for Intel Macs yet. It needs a Mac with Apple Silicon (M1 or newer), Windows or Linux.".to_string()
    } else {
        format!("The AI add-on isn't available for this kind of computer ({platform}) yet.")
    }
}

/// True when `app` is at least `min` (both `x.y.z`, suffixes ignored).
pub fn app_version_at_least(app: &str, min: &str) -> bool {
    matches!((version_parts(app), version_parts(min)), (Some(a), Some(m)) if a >= m)
}

impl Manifest {
    /// Parses and checks a manifest. Nothing in it is trusted until this passes.
    pub fn parse(json: &str) -> Result<Self, String> {
        Self::parse_with(json, false)
    }

    /// As `parse`; `allow_local` also accepts `file://` download addresses (testing against a folder on this computer).
    pub fn parse_with(json: &str, allow_local: bool) -> Result<Self, String> {
        let manifest: Manifest = serde_json::from_str(json).map_err(|e| format!("The add-on manifest is not valid: {e}"))?;
        manifest.validate(allow_local)?;
        Ok(manifest)
    }

    fn validate(&self, allow_local: bool) -> Result<(), String> {
        if self.schema != SUPPORTED_SCHEMA {
            return Err(format!("This add-on uses manifest format {}, which this app does not understand (it knows {SUPPORTED_SCHEMA}). Update the app.", self.schema));
        }
        if self.pack != PACK_NAME {
            return Err(format!("This is not a TRAAACE AI add-on (pack \"{}\").", self.pack));
        }
        if version_parts(&self.version).is_none() {
            return Err(format!("The add-on version \"{}\" is not of the form x.y.z.", self.version));
        }
        let mut seen = HashSet::new();
        for c in &self.components {
            if !seen.insert(c.id.as_str()) {
                return Err(format!("The add-on lists \"{}\" twice.", c.id));
            }
            if !is_safe_install_path(&c.install_path) {
                return Err(format!("The add-on file \"{}\" has an unsafe install path \"{}\".", c.id, c.install_path));
            }
            if c.platforms.is_empty() {
                return Err(format!("The add-on file \"{}\" has no platforms.", c.id));
            }
            if !(c.download.url.starts_with("https://") || (allow_local && c.download.url.starts_with("file://"))) {
                return Err(format!("The add-on file \"{}\" is not downloaded over https.", c.id));
            }
            if !matches!(c.download.compression.as_str(), "none" | "gzip") {
                return Err(format!("The add-on file \"{}\" uses unknown compression \"{}\".", c.id, c.download.compression));
            }
            if !is_sha256(&c.download.sha256) || !is_sha256(&c.unpacked.sha256) {
                return Err(format!("The add-on file \"{}\" has a checksum that is not a SHA-256.", c.id));
            }
            if c.download.size == 0 || c.unpacked.size == 0 {
                return Err(format!("The add-on file \"{}\" has no size.", c.id));
            }
        }
        for (what, id) in [
            ("detector", &self.model.detector_component),
            ("classifier", &self.model.classifier_component),
            ("class names", &self.model.class_names_component),
        ] {
            if !seen.contains(id.as_str()) {
                return Err(format!("The add-on's {what} file \"{id}\" is not in its file list."));
            }
        }
        if let Some(id) = &self.model.name_map_component {
            if !seen.contains(id.as_str()) {
                return Err(format!("The add-on's name map \"{id}\" is not in its file list."));
            }
        }
        Ok(())
    }

    /// The files to install on `platform`, or an error if there is no ONNX Runtime for it.
    pub fn components_for(&self, platform: &str) -> Result<Vec<&Component>, String> {
        let chosen: Vec<&Component> = self.components.iter().filter(|c| c.platforms.iter().any(|p| p == "*" || p == platform)).collect();
        if !chosen.iter().any(|c| c.kind == "runtime") {
            return Err(not_available_on(platform));
        }
        Ok(chosen)
    }

    /// Total bytes to download and to unpack for `platform`.
    pub fn sizes_for(&self, platform: &str) -> Result<(u64, u64), String> {
        let files = self.components_for(platform)?;
        Ok((files.iter().map(|c| c.download.size).sum(), files.iter().map(|c| c.unpacked.size).sum()))
    }
}

impl Component {
    /// What to call this file on the download screen.
    pub fn display_name(&self) -> String {
        self.label.clone().unwrap_or_else(|| self.id.replace(['-', '_'], " "))
    }
}

/// An installed pack on disk: where its pieces are.
#[derive(Debug, Clone)]
pub struct PackFiles {
    pub dir: PathBuf,
    pub runtime: PathBuf,
    pub models_dir: PathBuf,
    pub class_names: PathBuf,
    pub name_map: Option<PathBuf>,
    /// The video frame tool (`tools/ffmpeg`), which an add-on may leave out.
    pub video_tool: Option<PathBuf>,
}

fn find_runtime(dir: &Path) -> Option<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
            !name.contains("providers") && (name == "onnxruntime.dll" || (name.starts_with("libonnxruntime") && (name.contains(".dylib") || name.contains(".so"))))
        })
        .collect();
    found.sort();
    found.into_iter().next()
}

impl PackFiles {
    /// Checks `dir` has the layout `runtime/<onnxruntime library>` and `models/{detector,classifier}.onnx` + `class_names.json`.
    pub fn locate(dir: &Path) -> Result<Self, String> {
        let runtime = find_runtime(&dir.join("runtime"));
        let models_dir = dir.join("models");
        let mut missing = Vec::new();
        if runtime.is_none() {
            missing.push("runtime/ (the ONNX Runtime library)".to_string());
        }
        for f in ["detector.onnx", "classifier.onnx", "class_names.json"] {
            if !models_dir.join(f).is_file() {
                missing.push(format!("models/{f}"));
            }
        }
        if !missing.is_empty() {
            return Err(format!("{} is not a complete AI add-on; missing {}.", dir.display(), missing.join(", ")));
        }
        let name_map = models_dir.join("name_map.csv");
        Ok(Self {
            dir: dir.to_path_buf(),
            runtime: runtime.expect("checked above"),
            class_names: models_dir.join("class_names.json"),
            name_map: name_map.is_file().then_some(name_map),
            video_tool: ["tools/ffmpeg", "tools/ffmpeg.exe"].iter().map(|p| dir.join(p)).find(|p| p.is_file()),
            models_dir,
        })
    }
}

/// Folders to look in, best first: one the user chose, the `TRAAACE_AI_PACK` override, then the app's own add-on folder.
pub fn candidate_dirs(chosen: Option<&str>, env_override: Option<&str>, app_data: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for dir in [chosen, env_override].into_iter().flatten().filter(|d| !d.trim().is_empty()) {
        dirs.push(PathBuf::from(dir));
    }
    dirs.push(app_data.join("ai").join("pack"));
    dirs
}

/// The first candidate that is a complete pack; otherwise the reason the first one that exists was rejected.
pub fn locate_first(candidates: &[PathBuf]) -> Result<PackFiles, String> {
    let mut first_problem = None;
    for dir in candidates {
        match PackFiles::locate(dir) {
            Ok(pack) => return Ok(pack),
            Err(e) if dir.exists() && first_problem.is_none() => first_problem = Some(e),
            Err(_) => {}
        }
    }
    Err(first_problem.unwrap_or_else(|| "The AI add-on is not installed.".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const EXAMPLE: &str = include_str!("testdata/manifest.example.json");

    fn example() -> serde_json::Value {
        serde_json::from_str(EXAMPLE).unwrap()
    }

    fn parse(v: &serde_json::Value) -> Result<Manifest, String> {
        Manifest::parse(&v.to_string())
    }

    #[test]
    fn the_example_manifest_is_valid() {
        let m = Manifest::parse(EXAMPLE).unwrap();
        assert_eq!(m.pack, "traaace-ai");
        assert_eq!(m.model.classes, 81);
        assert_eq!(m.model.score_kind, "uncalibrated");
        assert!(m.notice.requires_acceptance);
        assert!(m.notice.credits.iter().any(|c| c.contains("wekaResearch")));
    }

    #[test]
    fn picks_the_files_for_a_platform() {
        let m = Manifest::parse(EXAMPLE).unwrap();
        let ids: Vec<&str> = m.components_for("macos-aarch64").unwrap().iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, ["classifier", "detector", "class-names", "name-map", "onnxruntime"]);
        let err = m.components_for("windows-x86_64").unwrap_err();
        assert!(err.contains("isn't available for this kind of computer (windows-x86_64)"), "{err}");
        // Intel Macs get a plain explanation.
        let err = m.components_for("macos-x86_64").unwrap_err();
        assert!(err.contains("Intel Macs") && err.contains("Apple Silicon"), "{err}");
    }

    #[test]
    fn totals_the_download_and_unpacked_sizes() {
        let (download, unpacked) = Manifest::parse(EXAMPLE).unwrap().sizes_for("macos-aarch64").unwrap();
        assert!(download > 500_000_000 && download < 600_000_000, "{download}");
        assert!(unpacked > download);
    }

    #[test]
    fn rejects_unknown_formats_and_other_packs() {
        let mut v = example();
        v["schema"] = 2.into();
        assert!(parse(&v).unwrap_err().contains("Update the app"));
        let mut v = example();
        v["pack"] = "something-else".into();
        assert!(parse(&v).unwrap_err().contains("not a TRAAACE AI add-on"));
        assert!(Manifest::parse("not json").is_err());
    }

    #[test]
    fn rejects_unsafe_install_paths() {
        for bad in ["../evil", "/etc/passwd", "models/../../x", "C:\\x", "a\\b", ""] {
            let mut v = example();
            v["components"][0]["install_path"] = bad.into();
            assert!(parse(&v).unwrap_err().contains("unsafe install path"), "{bad}");
        }
        assert!(is_safe_install_path("models/detector.onnx"));
        assert!(!is_safe_install_path("./models/x/../y"));
    }

    #[test]
    fn rejects_bad_checksums_urls_and_sizes() {
        let mut v = example();
        v["components"][0]["download"]["sha256"] = "XYZ".into();
        assert!(parse(&v).unwrap_err().contains("SHA-256"));
        let mut v = example();
        v["components"][0]["download"]["url"] = "http://example.com/x".into();
        assert!(parse(&v).unwrap_err().contains("https"));
        let mut v = example();
        v["components"][0]["unpacked"]["size"] = 0.into();
        assert!(parse(&v).unwrap_err().contains("no size"));
        let mut v = example();
        v["components"][0]["download"]["compression"] = "zip".into();
        assert!(parse(&v).unwrap_err().contains("compression"));
    }

    #[test]
    fn rejects_duplicate_ids_and_missing_model_files() {
        let mut v = example();
        v["components"][1]["id"] = v["components"][0]["id"].clone();
        assert!(parse(&v).unwrap_err().contains("twice"));
        let mut v = example();
        v["model"]["detector_component"] = "nope".into();
        assert!(parse(&v).unwrap_err().contains("detector"));
    }

    #[test]
    fn ignores_fields_and_kinds_it_does_not_know() {
        let mut v = example();
        v["future_field"] = "x".into();
        v["components"][0]["kind"] = "something-new".into();
        assert!(parse(&v).is_ok());
    }

    #[test]
    fn compares_app_versions() {
        assert!(app_version_at_least("0.5.0", "0.5.0"));
        assert!(app_version_at_least("0.10.0", "0.9.9"));
        assert!(app_version_at_least("1.0.0-rc1", "0.9.0"));
        assert!(!app_version_at_least("0.4.9", "0.5.0"));
        assert!(!app_version_at_least("0.5", "0.5.0"));
    }

    fn make_pack(dir: &Path, with: &[&str]) {
        for f in with {
            let path = dir.join(f);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, b"x").unwrap();
        }
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("traaace_pack_{name}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn finds_a_complete_pack() {
        let dir = temp("complete");
        make_pack(&dir, &["runtime/libonnxruntime.1.31.0.dylib", "models/detector.onnx", "models/classifier.onnx", "models/class_names.json", "models/name_map.csv"]);
        let pack = PackFiles::locate(&dir).unwrap();
        assert!(pack.runtime.ends_with("libonnxruntime.1.31.0.dylib"));
        assert!(pack.name_map.is_some());
        assert!(pack.class_names.ends_with("class_names.json"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_name_map_is_optional_and_provider_libraries_are_not_the_runtime() {
        let dir = temp("optional");
        make_pack(&dir, &["runtime/libonnxruntime_providers_shared.so", "runtime/libonnxruntime.so.1.31.0", "models/detector.onnx", "models/classifier.onnx", "models/class_names.json"]);
        let pack = PackFiles::locate(&dir).unwrap();
        assert!(pack.runtime.ends_with("libonnxruntime.so.1.31.0"));
        assert!(pack.name_map.is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn says_what_is_missing() {
        let dir = temp("missing");
        make_pack(&dir, &["models/detector.onnx"]);
        let err = PackFiles::locate(&dir).unwrap_err();
        assert!(err.contains("runtime/") && err.contains("models/classifier.onnx") && err.contains("models/class_names.json"), "{err}");
        assert!(!err.contains("models/detector.onnx"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn locates_the_dev_pack_when_this_machine_has_one() {
        let Ok(dir) = std::env::var("TRAAACE_AI_PACK") else { return };
        let dir = PathBuf::from(dir);
        if !dir.exists() {
            return;
        }
        let pack = PackFiles::locate(&dir).unwrap();
        assert!(pack.name_map.is_some(), "{pack:?}");
    }

    #[test]
    fn candidates_are_tried_in_order() {
        let dirs = candidate_dirs(Some("/chosen"), Some("/env"), Path::new("/data"));
        assert_eq!(dirs, [PathBuf::from("/chosen"), PathBuf::from("/env"), PathBuf::from("/data/ai/pack")]);
        assert_eq!(candidate_dirs(Some("  "), None, Path::new("/data")), [PathBuf::from("/data/ai/pack")]);

        let (good, bad) = (temp("good"), temp("bad"));
        make_pack(&good, &["runtime/onnxruntime.dll", "models/detector.onnx", "models/classifier.onnx", "models/class_names.json"]);
        assert_eq!(locate_first(&[bad.clone(), good.clone()]).unwrap().dir, good);
        let err = locate_first(&[bad.clone()]).unwrap_err();
        assert!(err.contains("not a complete AI add-on"), "{err}");
        assert_eq!(locate_first(&[PathBuf::from("/definitely/not/here")]).unwrap_err(), "The AI add-on is not installed.");
        let _ = (fs::remove_dir_all(&good), fs::remove_dir_all(&bad));
    }
}
