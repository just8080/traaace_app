//! Downloads and installs the AI add-on: fetch the manifest, download each file, check its checksum, unpack it,
//! and only then swap the finished pack into place. A failed or cancelled install leaves any earlier pack untouched.

use super::pack::{app_version_at_least, Component, Manifest, PackFiles};
use super::trust;
use flate2::read::GzDecoder;
use crate::ai_commands::{DownloadInfo, Progress};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

const MAX_MANIFEST_BYTES: u64 = 1 << 20;
const CHUNK: usize = 256 * 1024;
const DISK_FULL: &str = "There isn't enough free space on this computer's disk. Free up some space and try again.";

/// Where files come from. The app uses `AutoSource`; tests and local testing read from folders.
pub trait Source {
    fn open(&self, url: &str) -> Result<Box<dyn Read>, String>;
}

/// Reads `file://` addresses (a folder on this computer standing in for the download server).
pub struct FileSource;

impl Source for FileSource {
    fn open(&self, url: &str) -> Result<Box<dyn Read>, String> {
        let path = url.strip_prefix("file://").ok_or_else(|| format!("{url} is not a local file address."))?;
        let file = File::open(path).map_err(|e| format!("Could not open {path}: {e}"))?;
        Ok(Box::new(file))
    }
}

/// Reads `https://` addresses with the operating system's own TLS.
pub struct HttpSource {
    agent: ureq::Agent,
}

impl HttpSource {
    pub fn new() -> Self {
        use std::time::Duration;
        let tls = ureq::tls::TlsConfig::builder().provider(ureq::tls::TlsProvider::NativeTls).build();
        let agent = ureq::Agent::config_builder()
            .tls_config(tls)
            .timeout_connect(Some(Duration::from_secs(15)))
            .timeout_recv_response(Some(Duration::from_secs(30)))
            .build()
            .into();
        Self { agent }
    }
}

impl Source for HttpSource {
    fn open(&self, url: &str) -> Result<Box<dyn Read>, String> {
        let response = self.agent.get(url).call().map_err(|e| match e {
            ureq::Error::StatusCode(404) => "The AI add-on is not available to download yet.".to_string(),
            ureq::Error::StatusCode(code) => format!("The download server answered with an error ({code}). Please try again later."),
            _ => "Could not reach the download server. Check your internet connection and try again.".to_string(),
        })?;
        Ok(Box::new(response.into_body().into_with_config().limit(u64::MAX).reader()))
    }
}

/// Picks the right source for each address.
pub struct AutoSource {
    http: HttpSource,
}

impl AutoSource {
    pub fn new() -> Self {
        Self { http: HttpSource::new() }
    }
}

impl Source for AutoSource {
    fn open(&self, url: &str) -> Result<Box<dyn Read>, String> {
        if url.starts_with("file://") { FileSource.open(url) } else { self.http.open(url) }
    }
}

/// A checked manifest for this computer, ready to install.
pub struct Offer {
    pub manifest: Manifest,
    pub manifest_text: String,
    pub platform: String,
}

impl Offer {
    pub fn info(&self) -> Result<DownloadInfo, String> {
        let (download_bytes, unpacked_bytes) = self.manifest.sizes_for(&self.platform)?;
        Ok(DownloadInfo {
            version: self.manifest.version.clone(),
            title: self.manifest.notice.title.clone(),
            model_name: self.manifest.model.display_name.clone(),
            download_bytes,
            unpacked_bytes,
            credits: self.manifest.notice.credits.clone(),
            licenses: self.manifest.notice.licenses.clone(),
            requires_acceptance: self.manifest.notice.requires_acceptance,
        })
    }
}

fn read_limited(source: &dyn Source, url: &str, limit: u64) -> Result<String, String> {
    let mut text = String::new();
    source
        .open(url)?
        .take(limit + 1)
        .read_to_string(&mut text)
        .map_err(|e| format!("Could not read the add-on details: {e}"))?;
    if text.len() as u64 > limit {
        return Err("The add-on details are larger than expected.".to_string());
    }
    Ok(text)
}

/// Fetches and checks the manifest at `manifest_url` for this app version and platform. Its signature
/// (`manifest.json.minisig`) must match one of `trusted_keys` before anything in it is used.
pub fn fetch_offer(source: &dyn Source, manifest_url: &str, app_version: &str, platform: &str, trusted_keys: &[String]) -> Result<Offer, String> {
    let manifest_text = read_limited(source, manifest_url, MAX_MANIFEST_BYTES)?;
    let signature = read_limited(source, &trust::signature_url(manifest_url), 4096)
        .map_err(|_| "The AI add-on's details aren't signed, so they can't be trusted. Nothing was installed.".to_string())?;
    trust::verify_manifest(&manifest_text, &signature, trusted_keys)?;
    // A manifest read from a folder on this computer may point at files there; one from the internet must use https.
    let manifest = Manifest::parse_with(&manifest_text, manifest_url.starts_with("file://"))?;
    if let Some(min) = &manifest.min_app_version {
        if !app_version_at_least(app_version, min) {
            return Err(format!("This AI add-on needs TRAAACE {min} or newer. Please update the app first."));
        }
    }
    manifest.components_for(platform)?;
    Ok(Offer { manifest, manifest_text, platform: platform.to_string() })
}

#[derive(Debug, PartialEq)]
pub enum InstallError {
    Cancelled,
    Failed(String),
}

impl From<String> for InstallError {
    fn from(message: String) -> Self {
        InstallError::Failed(message)
    }
}

fn io_failure(what: &str, e: &io::Error) -> InstallError {
    if e.kind() == io::ErrorKind::StorageFull || e.raw_os_error() == Some(28) {
        InstallError::Failed(DISK_FULL.to_string())
    } else {
        InstallError::Failed(format!("Could not write {what}: {e}"))
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Copies `reader` to `writer`, returning the byte count and SHA-256. Stops with `Cancelled` when asked, and with
/// a failure if more than `max` bytes arrive (a file larger than the manifest says is not the file we expect).
fn copy_checked(
    reader: &mut dyn Read,
    writer: &mut dyn Write,
    max: u64,
    cancel: &AtomicBool,
    what: &str,
    mut on_bytes: impl FnMut(u64),
) -> Result<(u64, String), InstallError> {
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK];
    let mut total = 0u64;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(InstallError::Cancelled);
        }
        let n = reader.read(&mut buf).map_err(|e| InstallError::Failed(format!("The download of {what} was interrupted: {e}")))?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > max {
            return Err(InstallError::Failed(format!("{what} is larger than expected, so it was not installed.")));
        }
        hasher.update(&buf[..n]);
        writer.write_all(&buf[..n]).map_err(|e| io_failure(what, &e))?;
        on_bytes(n as u64);
    }
    writer.flush().map_err(|e| io_failure(what, &e))?;
    Ok((total, hex(&hasher.finalize())))
}

fn check(what: &str, got: (u64, String), size: u64, sha256: &str) -> Result<(), InstallError> {
    if got.0 != size || got.1 != sha256 {
        return Err(InstallError::Failed(format!("{what} did not download correctly (its checksum does not match), so it was not installed. Please try again.")));
    }
    Ok(())
}

fn fetch_component(
    source: &dyn Source,
    c: &Component,
    staging: &Path,
    cancel: &AtomicBool,
    mut on_bytes: impl FnMut(u64),
) -> Result<(), InstallError> {
    let what = c.display_name();
    let dest = staging.join("pack").join(&c.install_path);
    fs::create_dir_all(dest.parent().expect("install paths have a parent")).map_err(|e| io_failure(&what, &e))?;
    let download = staging.join(format!("{}.download", c.id));

    let mut reader = source.open(&c.download.url)?;
    let mut file = File::create(&download).map_err(|e| io_failure(&what, &e))?;
    let got = copy_checked(&mut reader, &mut file, c.download.size, cancel, &what, &mut on_bytes)?;
    drop(file);
    check(&what, got, c.download.size, &c.download.sha256)?;

    let mut unpacked = File::create(&dest).map_err(|e| io_failure(&what, &e))?;
    let mut source_file = File::open(&download).map_err(|e| io_failure(&what, &e))?;
    let got = if c.download.compression == "gzip" {
        copy_checked(&mut GzDecoder::new(&mut source_file), &mut unpacked, c.unpacked.size, cancel, &what, |_| {})?
    } else {
        copy_checked(&mut source_file, &mut unpacked, c.unpacked.size, cancel, &what, |_| {})?
    };
    drop(unpacked);
    check(&what, got, c.unpacked.size, &c.unpacked.sha256)?;
    let _ = fs::remove_file(&download);
    if c.kind == "tool" {
        make_runnable(&dest).map_err(|e| io_failure(&what, &e))?;
    }
    Ok(())
}

/// Tools in the add-on (the video tool, FFmpeg) are programs the app runs, so on macOS and Linux they need permission
/// to run. Windows decides by the `.exe` name instead.
fn make_runnable(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

/// Moves the finished pack into `<install_root>/pack`, keeping the old one until the new one is in place.
fn swap_into_place(install_root: &Path, staging: &Path) -> Result<PathBuf, InstallError> {
    let live = install_root.join("pack");
    let old = install_root.join("pack.old");
    let _ = fs::remove_dir_all(&old);
    let had_old = live.exists();
    if had_old {
        fs::rename(&live, &old).map_err(|e| io_failure("the new add-on", &e))?;
    }
    if let Err(e) = fs::rename(staging.join("pack"), &live) {
        if had_old {
            let _ = fs::rename(&old, &live);
        }
        return Err(io_failure("the new add-on", &e));
    }
    let _ = fs::remove_dir_all(&old);
    Ok(live)
}

/// Downloads every file the offer lists for this platform and installs them as `<install_root>/pack`.
/// `progress` is called as bytes arrive. Returns the installed folder.
pub fn install(
    source: &dyn Source,
    offer: &Offer,
    install_root: &Path,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(Progress),
) -> Result<PathBuf, InstallError> {
    let files = offer.manifest.components_for(&offer.platform)?;
    let (bytes_total, _) = offer.manifest.sizes_for(&offer.platform)?;
    let staging = install_root.join("pack.installing");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| io_failure("the add-on folder", &e))?;

    let result = (|| {
        let mut bytes_done = 0u64;
        for (index, c) in files.iter().enumerate() {
            let name = c.display_name();
            let base = bytes_done;
            let mut in_file = 0u64;
            fetch_component(source, c, &staging, cancel, |n| {
                in_file += n;
                progress(Progress {
                    stage: "downloading",
                    file: name.clone(),
                    file_index: index + 1,
                    file_count: files.len(),
                    bytes_done: base + in_file,
                    bytes_total,
                });
            })?;
            bytes_done += c.download.size;
        }

        progress(Progress { stage: "installing", file: String::new(), file_index: files.len(), file_count: files.len(), bytes_done: bytes_total, bytes_total });
        fs::write(staging.join("pack").join("manifest.json"), &offer.manifest_text).map_err(|e| io_failure("the add-on details", &e))?;
        PackFiles::locate(&staging.join("pack")).map_err(|e| InstallError::Failed(format!("The downloaded add-on is incomplete: {e}")))?;
        swap_into_place(install_root, &staging)
    })();

    let _ = fs::remove_dir_all(&staging);
    result
}

/// Deletes the add-on TRAAACE installed under `<install_root>` (and any half-finished download). Nothing else is touched.
/// Returns false when there was nothing to remove.
pub fn remove_installed(install_root: &Path) -> Result<bool, String> {
    let mut removed = false;
    for name in ["pack", "pack.old", "pack.installing"] {
        match fs::remove_dir_all(install_root.join(name)) {
            Ok(()) => removed = true,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) if e.kind() == io::ErrorKind::PermissionDenied => {
                return Err("TRAAACE is still using the add-on, so it can't be removed right now. Close TRAAACE, open it again, and remove it before scanning.".to_string());
            }
            Err(e) => return Err(format!("Could not remove the add-on: {e}")),
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};
    use std::collections::HashMap;

    fn sha(bytes: &[u8]) -> String {
        hex(&Sha256::digest(bytes))
    }

    fn gzip(bytes: &[u8]) -> Vec<u8> {
        let mut enc = GzEncoder::new(Vec::new(), Compression::fast());
        enc.write_all(bytes).unwrap();
        enc.finish().unwrap()
    }

    /// A tiny add-on on disk (a "download server" folder) and the manifest that describes it.
    struct Fixture {
        dir: PathBuf,
        manifest: serde_json::Value,
        /// The test key the fixture's manifest is signed with.
        key: String,
    }

    /// Signs a manifest file with a new test key (writing `<file>.minisig`) and returns the key.
    fn sign_file(path: &Path) -> String {
        let (key, signature) = trust::test_key_and_signature(&fs::read_to_string(path).unwrap());
        fs::write(format!("{}.minisig", path.display()), signature).unwrap();
        key
    }

    const FILES: [(&str, &str, &str, &str, &[u8]); 5] = [
        ("onnxruntime", "runtime", "runtime/libonnxruntime.1.31.0.dylib", "gzip", b"runtime library bytes"),
        ("detector", "model", "models/detector.onnx", "gzip", b"detector model bytes bytes bytes bytes"),
        ("classifier", "model", "models/classifier.onnx", "gzip", b"classifier model bytes"),
        ("class-names", "data", "models/class_names.json", "none", b"[\"kea\",\"tui\"]"),
        ("name-map", "data", "models/name_map.csv", "none", b"Class Name,Common\nkea,Kea\n"),
    ];

    #[cfg(unix)]
    #[test]
    fn downloaded_tools_are_made_runnable() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp("runnable");
        let tool = dir.join("ffmpeg");
        fs::write(&tool, b"program").unwrap();
        fs::set_permissions(&tool, fs::Permissions::from_mode(0o644)).unwrap();
        make_runnable(&tool).unwrap();
        assert_eq!(fs::metadata(&tool).unwrap().permissions().mode() & 0o777, 0o755);
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("traaace_dl_{name}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn fixture(name: &str) -> Fixture {
        let dir = temp(name);
        let server = dir.join("server");
        fs::create_dir_all(&server).unwrap();
        let mut components = Vec::new();
        for (id, kind, path, compression, bytes) in FILES {
            let sent = if compression == "gzip" { gzip(bytes) } else { bytes.to_vec() };
            fs::write(server.join(id), &sent).unwrap();
            components.push(serde_json::json!({
                "id": id, "kind": kind, "platforms": ["*"], "install_path": path,
                "download": { "url": format!("file://{}", server.join(id).display()), "compression": compression, "size": sent.len(), "sha256": sha(&sent) },
                "unpacked": { "size": bytes.len(), "sha256": sha(bytes) },
            }));
        }
        let manifest = serde_json::json!({
            "schema": 1, "pack": "traaace-ai", "version": "1.0.0", "min_app_version": "0.5.0",
            "notice": { "title": "AI species detection", "requires_acceptance": true, "credits": ["Alita"], "licenses": ["GPL-3.0"] },
            "model": { "id": "alita-3.03", "display_name": "Alita", "classes": 2, "detector_component": "detector",
                       "classifier_component": "classifier", "class_names_component": "class-names", "name_map_component": "name-map" },
            "components": components,
        });
        fs::write(server.join("manifest.json"), manifest.to_string()).unwrap();
        let key = sign_file(&server.join("manifest.json"));
        Fixture { dir, manifest, key }
    }

    impl Fixture {
        fn url(&self) -> String {
            format!("file://{}", self.dir.join("server/manifest.json").display())
        }
        fn root(&self) -> PathBuf {
            self.dir.join("app/ai")
        }
        fn offer(&self) -> Offer {
            fetch_offer(&FileSource, &self.url(), "0.5.0", "macos-aarch64", &[self.key.clone()]).unwrap()
        }
        fn install(&self, cancel: &AtomicBool) -> (Result<PathBuf, InstallError>, Vec<Progress>) {
            let mut seen = Vec::new();
            let result = install(&FileSource, &self.offer(), &self.root(), cancel, &mut |p| seen.push(p));
            (result, seen)
        }
        fn corrupt_server_file(&self, id: &str) {
            let path = self.dir.join("server").join(id);
            let mut bytes = fs::read(&path).unwrap();
            let last = bytes.len() - 1;
            bytes[last] ^= 0xff;
            fs::write(path, bytes).unwrap();
        }
    }

    #[test]
    fn describes_the_download_before_anything_is_fetched() {
        let f = fixture("info");
        let info = f.offer().info().unwrap();
        assert_eq!((info.version.as_str(), info.title.as_str(), info.requires_acceptance), ("1.0.0", "AI species detection", true));
        assert!(info.download_bytes > 0 && info.unpacked_bytes > 0);
        assert_eq!(info.credits, ["Alita"]);
    }

    #[test]
    fn installs_a_complete_pack_that_can_be_found_afterwards() {
        let f = fixture("ok");
        let (result, progress) = f.install(&AtomicBool::new(false));
        let dir = result.unwrap();
        assert_eq!(dir, f.root().join("pack"));
        let pack = PackFiles::locate(&dir).unwrap();
        assert_eq!(fs::read(&pack.class_names).unwrap(), b"[\"kea\",\"tui\"]");
        assert_eq!(fs::read(dir.join("models/detector.onnx")).unwrap(), b"detector model bytes bytes bytes bytes");
        assert!(dir.join("manifest.json").is_file());
        assert!(!f.root().join("pack.installing").exists(), "scratch folder is cleaned up");

        let downloading: Vec<&Progress> = progress.iter().filter(|p| p.stage == "downloading").collect();
        assert!(downloading.windows(2).all(|w| w[0].bytes_done <= w[1].bytes_done));
        assert_eq!(downloading.last().unwrap().bytes_done, downloading.last().unwrap().bytes_total);
        assert_eq!(downloading.first().unwrap().file_count, 5);
        assert_eq!(progress.last().unwrap().stage, "installing");
    }

    #[test]
    fn a_corrupted_download_is_refused_and_nothing_is_left_behind() {
        let f = fixture("corrupt");
        f.corrupt_server_file("detector");
        let (result, _) = f.install(&AtomicBool::new(false));
        match result {
            Err(InstallError::Failed(m)) => assert!(m.contains("did not download correctly"), "{m}"),
            other => panic!("{other:?}"),
        }
        assert!(!f.root().join("pack").exists());
        assert!(!f.root().join("pack.installing").exists());
    }

    #[test]
    fn a_file_larger_than_the_manifest_says_is_refused() {
        let f = fixture("big");
        let path = f.dir.join("server/name-map");
        let mut bytes = fs::read(&path).unwrap();
        bytes.extend_from_slice(&vec![b'x'; 1000]);
        fs::write(path, bytes).unwrap();
        let (result, _) = f.install(&AtomicBool::new(false));
        assert!(matches!(result, Err(InstallError::Failed(m)) if m.contains("larger than expected")));
    }

    #[test]
    fn cancelling_stops_the_install_and_cleans_up() {
        let f = fixture("cancel");
        let (result, _) = f.install(&AtomicBool::new(true));
        assert_eq!(result, Err(InstallError::Cancelled));
        assert!(!f.root().join("pack").exists());
        assert!(!f.root().join("pack.installing").exists());
    }

    #[test]
    fn a_failed_update_leaves_the_working_pack_alone() {
        let f = fixture("update");
        f.install(&AtomicBool::new(false)).0.unwrap();
        let before = fs::read(f.root().join("pack/models/class_names.json")).unwrap();
        f.corrupt_server_file("classifier");
        assert!(f.install(&AtomicBool::new(false)).0.is_err());
        assert_eq!(fs::read(f.root().join("pack/models/class_names.json")).unwrap(), before);
        assert!(PackFiles::locate(&f.root().join("pack")).is_ok());
    }

    #[test]
    fn a_new_version_replaces_the_old_one() {
        let f = fixture("replace");
        f.install(&AtomicBool::new(false)).0.unwrap();
        fs::write(f.root().join("pack/stale.txt"), b"old").unwrap();
        f.install(&AtomicBool::new(false)).0.unwrap();
        assert!(!f.root().join("pack/stale.txt").exists());
        assert!(!f.root().join("pack.old").exists());
    }

    #[test]
    fn refuses_an_add_on_that_needs_a_newer_app_or_another_platform() {
        let f = fixture("compat");
        let err = fetch_offer(&FileSource, &f.url(), "0.4.0", "macos-aarch64", &[f.key.clone()]).err().unwrap();
        assert!(err.contains("needs TRAAACE 0.5.0 or newer"), "{err}");

        let mut manifest = f.manifest.clone();
        for c in manifest["components"].as_array_mut().unwrap() {
            c["platforms"] = serde_json::json!(["windows-x86_64"]);
        }
        let other = f.dir.join("server/other.json");
        fs::write(&other, manifest.to_string()).unwrap();
        let other_key = sign_file(&other);
        let err = fetch_offer(&FileSource, &format!("file://{}", other.display()), "0.5.0", "macos-aarch64", &[other_key]).err().unwrap();
        assert!(err.contains("isn't available for this kind of computer (macos-aarch64)"), "{err}");
    }

    #[test]
    fn local_addresses_are_only_trusted_from_a_local_manifest() {
        struct Fake(HashMap<String, Vec<u8>>);
        impl Source for Fake {
            fn open(&self, url: &str) -> Result<Box<dyn Read>, String> {
                self.0.get(url).map(|b| Box::new(io::Cursor::new(b.clone())) as Box<dyn Read>).ok_or_else(|| "missing".to_string())
            }
        }
        let f = fixture("trust");
        let text = fs::read(f.dir.join("server/manifest.json")).unwrap();
        let signature = fs::read(f.dir.join("server/manifest.json.minisig")).unwrap();
        let online = Fake(HashMap::from([
            ("https://example.com/manifest.json".to_string(), text),
            ("https://example.com/manifest.json.minisig".to_string(), signature),
        ]));
        let err = fetch_offer(&online, "https://example.com/manifest.json", "0.5.0", "macos-aarch64", &[f.key.clone()]).err().unwrap();
        assert!(err.contains("https"), "{err}");
    }

    #[test]
    fn removes_the_installed_add_on_and_leaves_other_folders_alone() {
        let f = fixture("remove");
        f.install(&AtomicBool::new(false)).0.unwrap();
        fs::create_dir_all(f.root().join("pack.installing")).unwrap();
        fs::create_dir_all(f.root().join("somewhere-else")).unwrap();
        assert_eq!(remove_installed(&f.root()), Ok(true));
        assert!(!f.root().join("pack").exists() && !f.root().join("pack.installing").exists());
        assert!(f.root().join("somewhere-else").exists());
        assert_eq!(remove_installed(&f.root()), Ok(false), "removing twice is fine");
        assert_eq!(remove_installed(&f.dir.join("never-created")), Ok(false));
    }

    #[test]
    fn refuses_an_unsigned_a_changed_or_a_wrongly_signed_list() {
        let f = fixture("signature");
        let manifest = f.dir.join("server/manifest.json");
        let ok = fetch_offer(&FileSource, &f.url(), "0.5.0", "macos-aarch64", &[f.key.clone()]);
        assert!(ok.is_ok());

        let (stranger, _) = trust::test_key_and_signature("{}");
        let err = fetch_offer(&FileSource, &f.url(), "0.5.0", "macos-aarch64", &[stranger]).err().unwrap();
        assert!(err.contains("signature check"), "{err}");

        // Someone changes a download address on the server after it was signed.
        let changed = fs::read_to_string(&manifest).unwrap().replace("detector", "detectoR");
        fs::write(&manifest, changed).unwrap();
        let err = fetch_offer(&FileSource, &f.url(), "0.5.0", "macos-aarch64", &[f.key.clone()]).err().unwrap();
        assert!(err.contains("signature check"), "{err}");

        fs::remove_file(f.dir.join("server/manifest.json.minisig")).unwrap();
        let err = fetch_offer(&FileSource, &f.url(), "0.5.0", "macos-aarch64", &[f.key.clone()]).err().unwrap();
        assert!(err.contains("aren't signed"), "{err}");
    }

    #[test]
    fn an_oversized_manifest_is_refused() {
        let dir = temp("hugemanifest");
        let path = dir.join("m.json");
        fs::write(&path, vec![b' '; (MAX_MANIFEST_BYTES + 10) as usize]).unwrap();
        let err = fetch_offer(&FileSource, &format!("file://{}", path.display()), "0.5.0", "macos-aarch64", &[]).err().unwrap();
        assert!(err.contains("larger than expected"), "{err}");
    }
}
