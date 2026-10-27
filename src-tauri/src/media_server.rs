//! A tiny web server on the loopback address that plays video files for the viewer.
//!
//! On Linux the web view (WebKitGTK) cannot play video from Tauri's `asset://` address: GStreamer reports a
//! "FormatError" even though the same file plays fine from a normal web address. Serving the file over plain HTTP,
//! with byte-range support, is what video players expect.
//!
//! It is deliberately narrow:
//! - it listens on `127.0.0.1` only, on a port the system picks;
//! - it serves only video files the app has registered, each under its own random token that changes on every run,
//!   so nothing else on the computer can be reached through it, and a page cannot guess an address;
//! - it checks the `Host` header, so a web page cannot reach it by pointing its own domain name at 127.0.0.1.

use std::collections::HashMap;
use std::fs::File;
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

const MAX_HEAD_BYTES: usize = 16 * 1024;
const MAX_FILES: usize = 20_000;
const CHUNK: usize = 64 * 1024;

#[derive(Default)]
struct Registry {
    by_token: HashMap<String, PathBuf>,
    by_path: HashMap<PathBuf, String>,
}

pub struct MediaServer {
    port: u16,
    registry: Arc<Mutex<Registry>>,
}

/// The content type for a video file name, or `None` when it is not a video this server serves.
fn content_type(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "mp4" | "m4v" => Some("video/mp4"),
        "mov" => Some("video/quicktime"),
        "avi" => Some("video/x-msvideo"),
        "mkv" => Some("video/x-matroska"),
        "webm" => Some("video/webm"),
        _ => None,
    }
}

/// 128 random bits as hex. Reads the operating system's random source where there is one.
fn random_token() -> String {
    let mut bytes = [0u8; 16];
    #[cfg(unix)]
    let filled = File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut bytes)).is_ok();
    #[cfg(not(unix))]
    let filled = false;
    if !filled {
        // No random device: mix the clock with the per-process random hash keys.
        use std::hash::{BuildHasher, Hasher};
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        for (i, chunk) in bytes.chunks_mut(8).enumerate() {
            let mut h = std::collections::hash_map::RandomState::new().build_hasher();
            h.write_u128(nanos ^ ((i as u128) << 64));
            chunk.copy_from_slice(&h.finish().to_le_bytes());
        }
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

impl MediaServer {
    /// Starts listening. The server runs on background threads for as long as the app does.
    pub fn start() -> io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        let port = listener.local_addr()?.port();
        let registry = Arc::new(Mutex::new(Registry::default()));
        let shared = registry.clone();
        thread::Builder::new().name("media-server".into()).spawn(move || {
            for stream in listener.incoming().flatten() {
                let registry = shared.clone();
                let _ = thread::Builder::new().name("media-conn".into()).spawn(move || {
                    let _ = handle(stream, port, &registry);
                });
            }
        })?;
        Ok(Self { port, registry })
    }

    #[cfg(test)]
    pub fn port(&self) -> u16 {
        self.port
    }

    /// The address to play `path` from. The file must exist and be a video; asking again for the same file gives the same address.
    pub fn register(&self, path: &Path) -> Result<String, String> {
        let real = path.canonicalize().map_err(|e| format!("{}: {e}", path.display()))?;
        if !real.is_file() {
            return Err(format!("{} is not a file", real.display()));
        }
        let ext = real.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        if content_type(&real).is_none() {
            return Err(format!("{} is not a video file this player serves", real.display()));
        }
        let mut registry = self.registry.lock().map_err(|_| "media server state is unusable".to_string())?;
        let token = match registry.by_path.get(&real) {
            Some(token) => token.clone(),
            None => {
                if registry.by_token.len() >= MAX_FILES {
                    return Err("too many videos are registered for playback".to_string());
                }
                let token = random_token();
                registry.by_token.insert(token.clone(), real.clone());
                registry.by_path.insert(real, token.clone());
                token
            }
        };
        Ok(format!("http://127.0.0.1:{}/v/{token}.{ext}", self.port))
    }
}

struct Request {
    method: String,
    target: String,
    host: Option<String>,
    range: Option<String>,
}

fn read_request(stream: &TcpStream) -> io::Result<Request> {
    let mut reader = BufReader::new(stream.take(MAX_HEAD_BYTES as u64));
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("").to_string();
    let (mut host, mut range) = (None, None);
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            match name.trim().to_ascii_lowercase().as_str() {
                "host" => host = Some(value.trim().to_string()),
                "range" => range = Some(value.trim().to_string()),
                _ => {}
            }
        }
    }
    Ok(Request { method, target, host, range })
}

/// The byte range a `Range` header asks for, as `(first, last)` inclusive. `Err` when it cannot be satisfied.
fn parse_range(header: &str, len: u64) -> Result<(u64, u64), ()> {
    let spec = header.strip_prefix("bytes=").ok_or(())?;
    if spec.contains(',') || len == 0 {
        return Err(()); // one range at a time is all a video player needs
    }
    let (first, last) = spec.split_once('-').ok_or(())?;
    match (first.trim(), last.trim()) {
        ("", suffix) => {
            let n: u64 = suffix.parse().map_err(|_| ())?;
            if n == 0 {
                return Err(());
            }
            Ok((len.saturating_sub(n), len - 1))
        }
        (start, "") => {
            let start: u64 = start.parse().map_err(|_| ())?;
            if start >= len { Err(()) } else { Ok((start, len - 1)) }
        }
        (start, end) => {
            let (start, end): (u64, u64) = (start.parse().map_err(|_| ())?, end.parse().map_err(|_| ())?);
            if start > end || start >= len { Err(()) } else { Ok((start, end.min(len - 1))) }
        }
    }
}

fn respond(stream: &mut TcpStream, status: &str, headers: &[(&str, String)], body: &[u8]) -> io::Result<()> {
    let mut head = format!("HTTP/1.1 {status}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n");
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str(&format!("Content-Length: {}\r\n\r\n", body.len()));
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)
}

fn handle(mut stream: TcpStream, port: u16, registry: &Mutex<Registry>) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    stream.set_write_timeout(Some(Duration::from_secs(30)))?;
    let request = read_request(&stream)?;

    let host_ok = request.host.as_deref().is_some_and(|h| h == format!("127.0.0.1:{port}") || h == format!("localhost:{port}"));
    if !host_ok {
        return respond(&mut stream, "403 Forbidden", &[], b"");
    }
    let head_only = request.method == "HEAD";
    if request.method != "GET" && !head_only {
        return respond(&mut stream, "405 Method Not Allowed", &[("Allow", "GET, HEAD".into())], b"");
    }

    // /v/<token>.<ext>, query string ignored
    let target = request.target.split('?').next().unwrap_or("");
    let token = target.strip_prefix("/v/").and_then(|rest| rest.split('.').next()).unwrap_or("");
    let path = registry.lock().ok().and_then(|r| r.by_token.get(token).cloned());
    let Some(path) = path else {
        return respond(&mut stream, "404 Not Found", &[], b"");
    };
    let Some(mime) = content_type(&path) else {
        return respond(&mut stream, "404 Not Found", &[], b"");
    };
    let Ok(mut file) = File::open(&path) else {
        return respond(&mut stream, "404 Not Found", &[], b"");
    };
    let len = file.metadata()?.len();

    let (status, first, last) = match request.range.as_deref() {
        None => ("200 OK", 0, len.saturating_sub(1)),
        Some(header) => match parse_range(header, len) {
            Ok((first, last)) => ("206 Partial Content", first, last),
            Err(()) => return respond(&mut stream, "416 Range Not Satisfiable", &[("Content-Range", format!("bytes */{len}"))], b""),
        },
    };
    let body_len = if len == 0 { 0 } else { last - first + 1 };

    let mut head = format!("HTTP/1.1 {status}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n");
    head.push_str(&format!("Content-Type: {mime}\r\nAccept-Ranges: bytes\r\nContent-Length: {body_len}\r\n"));
    if status.starts_with("206") {
        head.push_str(&format!("Content-Range: bytes {first}-{last}/{len}\r\n"));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    if head_only || body_len == 0 {
        return Ok(());
    }

    file.seek(SeekFrom::Start(first))?;
    let mut remaining = body_len;
    let mut buf = vec![0u8; CHUNK];
    while remaining > 0 {
        let want = remaining.min(CHUNK as u64) as usize;
        let n = file.read(&mut buf[..want])?;
        if n == 0 {
            break;
        }
        // The player closing the connection (a seek, or leaving the page) is normal, not a failure.
        if stream.write_all(&buf[..n]).is_err() {
            break;
        }
        remaining -= n as u64;
    }
    let _ = stream.shutdown(Shutdown::Both);
    Ok(())
}

/// The server, started the first time a video is played.
#[derive(Default)]
pub struct MediaState {
    server: Mutex<Option<MediaServer>>,
}

/// Whether videos should be played from the local server on this computer. Linux needs it; Windows and macOS play from
/// `asset://` fine. `TRAAACE_MEDIA_SERVER=1` turns it on anywhere, for testing.
pub fn enabled() -> bool {
    cfg!(target_os = "linux") || std::env::var("TRAAACE_MEDIA_SERVER").is_ok_and(|v| v == "1")
}

/// The address to play a video from, or `None` when this computer plays from `asset://` instead.
#[tauri::command]
pub fn media_url(path: String, state: tauri::State<'_, MediaState>) -> Result<Option<String>, String> {
    if !enabled() {
        return Ok(None);
    }
    let mut guard = state.server.lock().map_err(|_| "media server state is unusable".to_string())?;
    if guard.is_none() {
        *guard = Some(MediaServer::start().map_err(|e| format!("Could not start the video player: {e}"))?);
    }
    guard.as_ref().expect("started above").register(Path::new(&path)).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("traaace-media-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 0, 1, 2 ... 250 repeating, so any slice is easy to check.
    fn sample_file(dir: &Path, name: &str, len: usize) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, (0..len).map(|i| (i % 251) as u8).collect::<Vec<u8>>()).unwrap();
        path
    }

    /// Sends a raw request and returns the status line, the headers (lower-cased names) and the body.
    fn fetch(server: &MediaServer, target: &str, method: &str, host: Option<&str>, range: Option<&str>) -> (String, HashMap<String, String>, Vec<u8>) {
        let mut stream = TcpStream::connect(("127.0.0.1", server.port())).unwrap();
        let host = host.map(String::from).unwrap_or_else(|| format!("127.0.0.1:{}", server.port()));
        let mut req = format!("{method} {target} HTTP/1.1\r\nHost: {host}\r\n");
        if let Some(range) = range {
            req.push_str(&format!("Range: {range}\r\n"));
        }
        req.push_str("\r\n");
        stream.write_all(req.as_bytes()).unwrap();
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).unwrap();
        let split = raw.windows(4).position(|w| w == b"\r\n\r\n").expect("a complete response head");
        let head = String::from_utf8_lossy(&raw[..split]).to_string();
        let mut lines = head.lines();
        let status = lines.next().unwrap().to_string();
        let headers = lines.filter_map(|l| l.split_once(':')).map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string())).collect();
        (status, headers, raw[split + 4..].to_vec())
    }

    fn target(url: &str) -> String {
        url.strip_prefix("http://127.0.0.1:").unwrap().split_once('/').map(|(_, rest)| format!("/{rest}")).unwrap()
    }

    #[test]
    fn serves_the_whole_file_and_says_it_can_be_ranged() {
        let dir = temp_dir("whole");
        let server = MediaServer::start().unwrap();
        let url = server.register(&sample_file(&dir, "a.mp4", 1000)).unwrap();
        let (status, headers, body) = fetch(&server, &target(&url), "GET", None, None);
        assert!(status.contains("200"), "{status}");
        assert_eq!(headers["content-type"], "video/mp4");
        assert_eq!(headers["accept-ranges"], "bytes");
        assert_eq!(headers["content-length"], "1000");
        assert_eq!(body.len(), 1000);
        assert_eq!(body[251], 0);
    }

    #[test]
    fn serves_byte_ranges() {
        let dir = temp_dir("ranges");
        let server = MediaServer::start().unwrap();
        let url = server.register(&sample_file(&dir, "a.mp4", 1000)).unwrap();
        let t = target(&url);

        let (status, headers, body) = fetch(&server, &t, "GET", None, Some("bytes=10-19"));
        assert!(status.contains("206"), "{status}");
        assert_eq!(headers["content-range"], "bytes 10-19/1000");
        assert_eq!(body, (10u8..20).collect::<Vec<_>>());

        let (_, headers, body) = fetch(&server, &t, "GET", None, Some("bytes=990-"));
        assert_eq!(headers["content-range"], "bytes 990-999/1000");
        assert_eq!(body.len(), 10);

        let (_, headers, body) = fetch(&server, &t, "GET", None, Some("bytes=-5"));
        assert_eq!(headers["content-range"], "bytes 995-999/1000");
        assert_eq!(body.len(), 5);

        let (_, headers, _) = fetch(&server, &t, "GET", None, Some("bytes=0-99999"));
        assert_eq!(headers["content-range"], "bytes 0-999/1000"); // an end past the file is cut back
    }

    #[test]
    fn refuses_ranges_it_cannot_satisfy() {
        let dir = temp_dir("bad-range");
        let server = MediaServer::start().unwrap();
        let t = target(&server.register(&sample_file(&dir, "a.mp4", 100)).unwrap());
        for range in ["bytes=100-", "bytes=50-10", "bytes=0-5,10-15", "items=0-5", "bytes=abc"] {
            let (status, headers, _) = fetch(&server, &t, "GET", None, Some(range));
            assert!(status.contains("416"), "{range}: {status}");
            assert_eq!(headers["content-range"], "bytes */100");
        }
    }

    #[test]
    fn head_has_the_headers_but_no_body() {
        let dir = temp_dir("head");
        let server = MediaServer::start().unwrap();
        let t = target(&server.register(&sample_file(&dir, "a.mov", 500)).unwrap());
        let (status, headers, body) = fetch(&server, &t, "HEAD", None, None);
        assert!(status.contains("200"), "{status}");
        assert_eq!(headers["content-length"], "500");
        assert_eq!(headers["content-type"], "video/quicktime");
        assert!(body.is_empty());
    }

    #[test]
    fn unknown_tokens_other_hosts_and_other_methods_are_refused() {
        let dir = temp_dir("refuse");
        let server = MediaServer::start().unwrap();
        let t = target(&server.register(&sample_file(&dir, "a.mp4", 100)).unwrap());
        assert!(fetch(&server, "/v/00000000000000000000000000000000.mp4", "GET", None, None).0.contains("404"));
        assert!(fetch(&server, "/", "GET", None, None).0.contains("404"));
        assert!(fetch(&server, "/v/../../etc/passwd", "GET", None, None).0.contains("404"));
        assert!(fetch(&server, &t, "GET", Some("evil.example.com"), None).0.contains("403"));
        assert!(fetch(&server, &t, "POST", None, None).0.contains("405"));
    }

    #[test]
    fn only_videos_that_exist_can_be_registered() {
        let dir = temp_dir("register");
        let server = MediaServer::start().unwrap();
        let text = dir.join("notes.txt");
        std::fs::write(&text, "secret").unwrap();
        assert!(server.register(&text).is_err());
        assert!(server.register(&dir.join("missing.mp4")).is_err());
        assert!(server.register(&dir).is_err());
    }

    #[test]
    fn the_same_file_keeps_its_address_and_different_files_differ() {
        let dir = temp_dir("tokens");
        let server = MediaServer::start().unwrap();
        let a = sample_file(&dir, "a.mp4", 10);
        let b = sample_file(&dir, "b.mp4", 10);
        let first = server.register(&a).unwrap();
        assert_eq!(first, server.register(&a).unwrap());
        assert_ne!(first, server.register(&b).unwrap());
        assert!(first.starts_with("http://127.0.0.1:") && first.ends_with(".mp4"));
        let token = first.rsplit('/').next().unwrap().trim_end_matches(".mp4");
        assert_eq!(token.len(), 32);
        assert!(token.bytes().all(|b| b.is_ascii_hexdigit()));
    }

    /// Hand test: `TRAAACE_TRY_VIDEO=/path/clip.mp4 cargo test serve_one_video_for_a_while -- --ignored --nocapture`
    /// serves one real video for two minutes, so a browser can be pointed at the printed address.
    #[test]
    #[ignore]
    fn serve_one_video_for_a_while() {
        let path = std::env::var("TRAAACE_TRY_VIDEO").expect("set TRAAACE_TRY_VIDEO to a video file");
        let server = MediaServer::start().unwrap();
        println!("PLAY: {}", server.register(Path::new(&path)).unwrap());
        thread::sleep(Duration::from_secs(120));
    }

    #[test]
    fn range_parsing_edge_cases() {
        assert_eq!(parse_range("bytes=0-0", 1), Ok((0, 0)));
        assert_eq!(parse_range("bytes=-1000", 10), Ok((0, 9))); // a suffix longer than the file is the whole file
        assert_eq!(parse_range("bytes=0-", 0), Err(()));
    }

    #[test]
    fn a_large_file_streams_completely() {
        let dir = temp_dir("large");
        let server = MediaServer::start().unwrap();
        let t = target(&server.register(&sample_file(&dir, "big.mkv", 3 * 1024 * 1024 + 17)).unwrap());
        let (_, headers, body) = fetch(&server, &t, "GET", None, None);
        assert_eq!(headers["content-type"], "video/x-matroska");
        assert_eq!(body.len(), 3 * 1024 * 1024 + 17);
        assert_eq!(body[200_000], (200_000 % 251) as u8);
    }
}
