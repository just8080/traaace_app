//! Scans a folder of photos with the on-device species model and prints the results.
//!
//!   cargo run --release --features ai --example ai_scan -- <models_dir> <folder> --runtime <libonnxruntime> [--cpu] [--ffmpeg <ffmpeg>] [--json out.json]
//!
//! `<models_dir>` holds detector.onnx, classifier.onnx and class_names.json; `--runtime` is the ONNX Runtime
//! library file (libonnxruntime.dylib / onnxruntime.dll / libonnxruntime.so). Not needed with `--features ai-static`.

use std::{path::PathBuf, time::Instant};
use traaace_v2_lib::ai::{Engine, Thresholds};
use walkdir::WalkDir;

fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (models, folder) = match (args.first(), args.get(1)) {
        (Some(m), Some(f)) => (PathBuf::from(m), PathBuf::from(f)),
        _ => return Err("usage: ai_scan <models_dir> <folder> [--runtime <lib>] [--cpu] [--json out.json]".into()),
    };
    let gpu = !args.iter().any(|a| a == "--cpu");
    let runtime = args.iter().position(|a| a == "--runtime").and_then(|i| args.get(i + 1)).map(PathBuf::from);
    let json_out = args.iter().position(|a| a == "--json").and_then(|i| args.get(i + 1)).cloned();

    let ffmpeg = args.iter().position(|a| a == "--ffmpeg").and_then(|i| args.get(i + 1)).map(PathBuf::from);
    let started = Instant::now();
    let mut engine = Engine::load(runtime.as_deref(), &models, gpu)?;
    println!("models loaded in {:.1}s ({})", started.elapsed().as_secs_f32(), if gpu { "detector on GPU, classifier on CPU" } else { "CPU" });

    engine.set_video_tool(ffmpeg);
    let mut files: Vec<PathBuf> = WalkDir::new(&folder)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| p.extension().and_then(|e| e.to_str()).is_some_and(|e| matches!(e.to_lowercase().as_str(), "jpg" | "jpeg" | "mp4" | "mov" | "avi" | "mkv")))
        .collect();
    files.sort();

    let started = Instant::now();
    let mut rows = Vec::new();
    for path in &files {
        let rel = path.strip_prefix(&folder).unwrap_or(path).display().to_string();
        match engine.predict_file(path, &Thresholds::default()) {
            Ok(p) => {
                let (best, score) = &p.top[0];
                println!("{:<48} {:<20} {:>18} {:.2}  md={:.2} count={}", tail(&rel, 48), p.label, best, score, p.detector_confidence, p.count);
                rows.push(serde_json::json!({
                    "file": rel, "label": p.label, "confidence": p.confidence, "top": p.top,
                    "detector_confidence": p.detector_confidence, "count": p.count, "boxes": p.detections.len(),
                }));
            }
            Err(e) => println!("{rel}: ERROR {e}"),
        }
    }
    let secs = started.elapsed().as_secs_f32();
    println!("\n{} photos in {:.1}s = {:.0} ms/photo", files.len(), secs, secs * 1000.0 / files.len().max(1) as f32);
    if let Some(out) = json_out {
        std::fs::write(&out, serde_json::to_string_pretty(&rows).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn tail(s: &str, n: usize) -> &str {
    if s.len() <= n { s } else { &s[s.len() - n..] }
}
