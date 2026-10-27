use super::{video, classifier, decide_label, detector, estimate_count, parse_class_names, Detection, Prediction, Thresholds};
use ndarray::Array4;
use ort::{ep, environment::Environment, session::Session, value::Tensor};
use std::path::{Path, PathBuf};

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// The loaded models. Load once, then call `predict` for each photo.
pub struct Engine {
    detector: Session,
    classifier: Session,
    names: Vec<String>,
    /// The add-on's `ffmpeg`, when it has one. Without it, videos are reported as unreadable.
    video_tool: Option<PathBuf>,
    _env: Environment,
}

impl Engine {
    /// Loads `detector.onnx`, `classifier.onnx` and `class_names.json` from `models_dir`.
    /// `runtime` is the ONNX Runtime library file (from the AI pack); pass `None` only in an `ai-static` build.
    /// `gpu` runs the detector through Apple's CoreML on a Mac (about 8x faster; ignored elsewhere); the classifier is
    /// quicker on the CPU, so it stays there either way.
    pub fn load(runtime: Option<&Path>, models_dir: &Path, gpu: bool) -> Result<Self, String> {
        let env = match runtime {
            Some(lib) => ort::init_from(lib).map_err(|e| format!("Could not load the ONNX Runtime library at {}: {e}", lib.display()))?,
            #[cfg(feature = "ai-static")]
            None => ort::init(),
            #[cfg(not(feature = "ai-static"))]
            None => return Err("No ONNX Runtime library given (the AI pack is not installed)".to_string()),
        }
        .build()
        .map_err(err)?;

        // CoreML is Apple's; Windows and Linux run the detector on the CPU.
        #[cfg(target_os = "macos")]
        let detector_ep = if gpu { ep::CoreML::default().build() } else { ep::CPU::default().build() };
        #[cfg(not(target_os = "macos"))]
        let detector_ep = {
            let _ = gpu;
            ep::CPU::default().build()
        };
        let detector = Session::builder(&env)
            .map_err(err)?
            .with_execution_providers([detector_ep])
            .map_err(err)?
            .commit_from_file(models_dir.join("detector.onnx"))
            .map_err(|e| format!("Could not load detector.onnx: {e}"))?;
        let classifier = Session::builder(&env)
            .map_err(err)?
            .with_execution_providers([ep::CPU::default().build()])
            .map_err(err)?
            .commit_from_file(models_dir.join("classifier.onnx"))
            .map_err(|e| format!("Could not load classifier.onnx: {e}"))?;

        let names_json = std::fs::read_to_string(models_dir.join("class_names.json")).map_err(|e| format!("Could not read class_names.json: {e}"))?;
        Ok(Self { detector, classifier, names: parse_class_names(&names_json)?, video_tool: None, _env: env })
    }

    pub fn class_names(&self) -> &[String] {
        &self.names
    }

    /// Lets the engine read videos with the add-on's `ffmpeg` program.
    pub fn set_video_tool(&mut self, ffmpeg: Option<PathBuf>) {
        self.video_tool = ffmpeg;
    }

    pub fn predict_file(&mut self, path: &Path, thresholds: &Thresholds) -> Result<Prediction, String> {
        if video::is_video(path) {
            let program = self.video_tool.clone().ok_or_else(|| format!("{}: this AI add-on has no video tool, so videos cannot be scanned", path.display()))?;
            return video::predict_video(&video::Ffmpeg { program }, path, thresholds, |frame| self.predict(frame, thresholds));
        }
        let img = image::open(path).map_err(|e| format!("{}: {e}", path.display()))?.to_rgb8();
        self.predict(&img, thresholds)
    }

    pub fn predict(&mut self, img: &image::RgbImage, thresholds: &Thresholds) -> Result<Prediction, String> {
        let detections = self.detect(img)?;
        let best = detections.iter().max_by(|a, b| a.confidence.total_cmp(&b.confidence));
        let (bbox, detector_confidence) = best.map_or(([0.0, 0.0, 1.0, 1.0], -1.0), |d| (d.bbox, d.confidence));

        // The classifier always runs, on the whole photo when nothing was detected: a confident
        // species still counts even if the detector missed it.
        let scores = self.classify(classifier::preprocess(img, bbox))?;
        let mut ranked: Vec<usize> = (0..scores.len()).collect();
        ranked.sort_by(|&a, &b| scores[b].total_cmp(&scores[a]));
        let top: Vec<(String, f32)> = ranked.iter().take(3).map(|&i| (self.names[i].clone(), scores[i])).collect();

        let label = decide_label(&top[0].0, top[0].1, detector_confidence, thresholds).to_string();
        let count = estimate_count(&label, &detections, thresholds.count);
        Ok(Prediction { label, confidence: top[0].1, top, detector_confidence, count, detections })
    }

    fn detect(&mut self, img: &image::RgbImage) -> Result<Vec<Detection>, String> {
        let (input, lb) = detector::preprocess(img);
        let outputs = self.detector.run(ort::inputs!["images" => Tensor::from_array(input).map_err(err)?]).map_err(err)?;
        let (_, data) = outputs["output"].try_extract_tensor::<f32>().map_err(err)?;
        Ok(detector::decode(data, &lb))
    }

    fn classify(&mut self, input: Array4<f32>) -> Result<Vec<f32>, String> {
        let outputs = self.classifier.run(ort::inputs!["input" => Tensor::from_array(input).map_err(err)?]).map_err(err)?;
        let (_, data) = outputs["scores"].try_extract_tensor::<f32>().map_err(err)?;
        Ok(data.to_vec())
    }
}
