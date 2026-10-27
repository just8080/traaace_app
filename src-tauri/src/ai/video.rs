//! Videos: sample frames, run each through the photo pipeline, and let the best animal frame name the video.
//! This follows Alita's own video handling (process_video.py and collate_video in inference.py): a frame every
//! half second, at most 20 per video, and the frame with the strongest species score speaks for the whole clip.
//!
//! Frames come from an `ffmpeg` program in the AI add-on, behind `FrameSource` so the rest can be tested without it.

use super::{Prediction, Thresholds};
use image::RgbImage;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Seconds between sampled frames.
pub const FRAME_INTERVAL: f64 = 0.5;
/// Most frames looked at in one video; longer clips are sampled further apart.
pub const MAX_FRAMES: usize = 20;

const VIDEO_EXTENSIONS: [&str; 4] = ["mp4", "mov", "avi", "mkv"];

pub fn is_video(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| VIDEO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// The moments (in seconds) to grab frames at: every `FRAME_INTERVAL`, or evenly spread when that would be more than
/// `MAX_FRAMES`. A clip too short or too unclear to measure still gives its first frame.
pub fn sample_times(duration: f64) -> Vec<f64> {
    if !duration.is_finite() || duration <= FRAME_INTERVAL {
        return vec![0.0];
    }
    let step = FRAME_INTERVAL.max(duration / MAX_FRAMES as f64);
    (0..MAX_FRAMES).map(|i| i as f64 * step).take_while(|t| *t < duration).collect()
}

/// Gives the frames of a video at the requested times. A moment that cannot be read is skipped.
pub trait FrameSource {
    fn duration(&self, video: &Path) -> Result<f64, String>;
    fn frame_at(&self, video: &Path, seconds: f64) -> Option<RgbImage>;
}

/// Reads frames by running the add-on's `ffmpeg` program once per frame.
pub struct Ffmpeg {
    pub program: PathBuf,
}

impl Ffmpeg {
    /// A command for the video tool. On Windows it would otherwise flash a console window for every frame.
    fn command(&self) -> Command {
        #[allow(unused_mut)]
        let mut cmd = Command::new(&self.program);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        cmd
    }
}

/// Reads `Duration: 00:00:12.48` from the text ffmpeg prints about a file.
pub fn parse_duration(ffmpeg_output: &str) -> Option<f64> {
    let rest = ffmpeg_output.split("Duration:").nth(1)?.trim_start();
    let clock = rest.split([',', ' ']).next()?;
    let mut parts = clock.split(':');
    let (h, m, s) = (parts.next()?.parse::<f64>().ok()?, parts.next()?.parse::<f64>().ok()?, parts.next()?.parse::<f64>().ok()?);
    Some(h * 3600.0 + m * 60.0 + s)
}

impl FrameSource for Ffmpeg {
    fn duration(&self, video: &Path) -> Result<f64, String> {
        // With no output file ffmpeg exits with an error after printing the file's details, which is all we want.
        let out = self.command()
            .args(["-hide_banner", "-i"])
            .arg(video)
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("Could not run the video tool at {}: {e}", self.program.display()))?;
        parse_duration(&String::from_utf8_lossy(&out.stderr)).ok_or_else(|| format!("{}: could not read the length of this video", video.display()))
    }

    fn frame_at(&self, video: &Path, seconds: f64) -> Option<RgbImage> {
        let out = self.command()
            .args(["-hide_banner", "-loglevel", "error", "-ss", &format!("{seconds:.3}"), "-i"])
            .arg(video)
            .args(["-frames:v", "1", "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "2", "-"])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()?;
        if out.stdout.is_empty() {
            return None;
        }
        image::load_from_memory(&out.stdout).ok().map(|img| img.to_rgb8())
    }
}

/// Picks the frame that speaks for the video: the strongest species score among frames where the detector saw an
/// animal-sized thing, or among all frames when it saw nothing in any of them. Empty frames cannot outvote a real one.
pub fn best_frame(frames: Vec<Prediction>, thresholds: &Thresholds) -> Option<Prediction> {
    let strongest = |a: &Prediction, b: &Prediction| a.confidence.total_cmp(&b.confidence);
    let seen_something: Vec<usize> = (0..frames.len()).filter(|&i| frames[i].detector_confidence > thresholds.detector_empty).collect();
    let pool: Vec<usize> = if seen_something.is_empty() { (0..frames.len()).collect() } else { seen_something };
    let best = pool.into_iter().max_by(|&a, &b| strongest(&frames[a], &frames[b]))?;
    frames.into_iter().nth(best)
}

/// Runs `predict` over the sampled frames of `video` and combines the results into one prediction.
pub fn predict_video(
    source: &dyn FrameSource,
    video: &Path,
    thresholds: &Thresholds,
    mut predict: impl FnMut(&RgbImage) -> Result<Prediction, String>,
) -> Result<Prediction, String> {
    let duration = source.duration(video).unwrap_or(0.0);
    let mut results = Vec::new();
    let mut last_error = None;
    for t in sample_times(duration) {
        let Some(frame) = source.frame_at(video, t) else { continue };
        match predict(&frame) {
            Ok(p) => results.push(p),
            Err(e) => last_error = Some(e),
        }
    }
    best_frame(results, thresholds)
        .ok_or_else(|| last_error.unwrap_or_else(|| format!("{}: no frames could be read from this video", video.display())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn pred(label: &str, confidence: f32, detector: f32) -> Prediction {
        Prediction { label: label.into(), confidence, top: vec![(label.into(), confidence)], detector_confidence: detector, count: 1, detections: vec![] }
    }

    #[test]
    fn recognises_video_files() {
        for name in ["a.mp4", "B.MOV", "c.avi", "d.mkv"] {
            assert!(is_video(Path::new(name)), "{name}");
        }
        for name in ["a.jpg", "b.mp4.jpg", "noext"] {
            assert!(!is_video(Path::new(name)), "{name}");
        }
    }

    #[test]
    fn samples_every_half_second_for_short_clips() {
        assert_eq!(sample_times(3.2), vec![0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0]);
        assert_eq!(sample_times(0.5), vec![0.0]);
    }

    #[test]
    fn spreads_at_most_twenty_frames_over_long_clips() {
        let t = sample_times(60.0);
        assert_eq!(t.len(), 20);
        assert!((t[1] - 3.0).abs() < 1e-9);
        assert!(*t.last().unwrap() < 60.0);
        assert_eq!(sample_times(10.0).len(), 20); // 10 s is exactly 20 half-second steps
        assert_eq!(sample_times(10.4).len(), 20);
    }

    #[test]
    fn a_clip_of_unknown_length_still_gives_its_first_frame() {
        assert_eq!(sample_times(0.0), vec![0.0]);
        assert_eq!(sample_times(f64::NAN), vec![0.0]);
    }

    #[test]
    fn reads_the_duration_ffmpeg_prints() {
        let text = "Input #0, mov,mp4, from 'a.mp4':\n  Duration: 00:01:02.50, start: 0.000000, bitrate: 1000 kb/s\n";
        assert!((parse_duration(text).unwrap() - 62.5).abs() < 1e-9);
        assert_eq!(parse_duration("Duration: N/A, start: 0"), None);
        assert_eq!(parse_duration("nothing here"), None);
    }

    #[test]
    fn the_best_animal_frame_names_the_video() {
        let t = Thresholds::default();
        let frames = vec![pred("empty", 0.2, 0.05), pred("stoat", 0.6, 0.9), pred("weasel", 0.8, 0.7)];
        assert_eq!(best_frame(frames, &t).unwrap().label, "weasel");
    }

    #[test]
    fn a_confident_frame_without_a_detection_cannot_beat_a_detected_animal() {
        let t = Thresholds::default();
        let frames = vec![pred("possum", 0.95, 0.05), pred("stoat", 0.4, 0.9)];
        assert_eq!(best_frame(frames, &t).unwrap().label, "stoat");
    }

    #[test]
    fn when_the_detector_sees_nothing_the_strongest_frame_still_decides() {
        let t = Thresholds::default();
        let frames = vec![pred("empty", 0.1, -1.0), pred("kiwi", 0.7, -1.0)];
        assert_eq!(best_frame(frames, &t).unwrap().label, "kiwi");
        assert!(best_frame(vec![], &t).is_none());
    }

    struct Fake {
        duration: f64,
        unreadable: Vec<f64>,
        asked: RefCell<Vec<f64>>,
    }

    impl FrameSource for Fake {
        fn duration(&self, _: &Path) -> Result<f64, String> {
            Ok(self.duration)
        }
        fn frame_at(&self, _: &Path, seconds: f64) -> Option<RgbImage> {
            self.asked.borrow_mut().push(seconds);
            (!self.unreadable.contains(&seconds)).then(|| RgbImage::new(2, 2))
        }
    }

    #[test]
    fn skips_unreadable_frames_and_combines_the_rest() {
        let src = Fake { duration: 2.0, unreadable: vec![0.5], asked: RefCell::new(vec![]) };
        let mut calls = 0;
        let result = predict_video(&src, Path::new("v.mp4"), &Thresholds::default(), |_| {
            calls += 1;
            Ok(pred(if calls == 1 { "stoat" } else { "weasel" }, 0.5 + calls as f32 / 10.0, 0.9))
        })
        .unwrap();
        assert_eq!(src.asked.borrow().len(), 4); // 0, 0.5, 1.0, 1.5
        assert_eq!(calls, 3);
        assert_eq!(result.label, "weasel");
    }

    #[test]
    fn reports_a_video_with_no_readable_frames() {
        let src = Fake { duration: 1.0, unreadable: vec![0.0, 0.5], asked: RefCell::new(vec![]) };
        let err = predict_video(&src, Path::new("v.mp4"), &Thresholds::default(), |_| Ok(pred("x", 0.9, 0.9))).unwrap_err();
        assert!(err.contains("no frames could be read"), "{err}");
    }

    #[test]
    fn reports_the_model_error_when_every_frame_fails() {
        let src = Fake { duration: 1.0, unreadable: vec![], asked: RefCell::new(vec![]) };
        let err = predict_video(&src, Path::new("v.mp4"), &Thresholds::default(), |_| Err("model broke".into())).unwrap_err();
        assert_eq!(err, "model broke");
    }
}
