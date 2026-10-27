//! Runs the models over a list of photos and turns each prediction into a suggestion the UI can show.
//! The loop is written against `Predictor` so it can be tested without the models.

use super::names::{display_species, NameMap};
use super::{Engine, Prediction, Thresholds, CATEGORY_ANIMAL, COUNT_THRESHOLD};
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

pub trait Predictor {
    fn predict_file(&mut self, path: &Path, thresholds: &Thresholds) -> Result<Prediction, String>;
}

impl Predictor for Engine {
    fn predict_file(&mut self, path: &Path, thresholds: &Thresholds) -> Result<Prediction, String> {
        Engine::predict_file(self, path, thresholds)
    }
}

/// Keeps the loaded models between scans. ONNX Runtime allows one environment per process, so a second scan
/// has to reuse the first one's models rather than load its own.
pub struct EngineCache<E> {
    slot: Option<(std::path::PathBuf, E)>,
}

impl<E> Default for EngineCache<E> {
    fn default() -> Self {
        Self { slot: None }
    }
}

impl<E> EngineCache<E> {
    /// The engine for `key` (the pack folder), loading it with `load` the first time. A different pack in the
    /// same run cannot be loaded, because the runtime library is already in use.
    pub fn get_or_load(&mut self, key: &Path, load: impl FnOnce() -> Result<E, String>) -> Result<&mut E, String> {
        match &self.slot {
            Some((loaded, _)) if loaded != key => {
                return Err(format!("The AI add-on at {} is already in use. Restart TRAAACE to switch to a different add-on folder.", loaded.display()));
            }
            Some(_) => {}
            None => self.slot = Some((key.to_path_buf(), load()?)),
        }
        Ok(&mut self.slot.as_mut().expect("filled above").1)
    }
}

#[derive(Debug, Clone)]
pub struct ScanInput {
    /// The caller's id for the file (echoed back untouched).
    pub id: String,
    pub path: String,
}

/// What the AI saw in one photo. The reviewer's threshold is applied in the app, so moving it never needs a rescan.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub id: String,
    /// Best three species guesses as display names (the user's own name when they have one), best first.
    pub alternatives: Vec<(String, f32)>,
    /// Confidence of the best detector box, or -1 when the detector found nothing.
    pub detector_confidence: f32,
    /// Animal boxes the detector is reasonably sure of.
    pub animals: u32,
}

pub fn suggestion_from(id: &str, p: &Prediction, names: &NameMap, known: &[String]) -> Suggestion {
    Suggestion {
        id: id.to_string(),
        alternatives: p.top.iter().take(3).map(|(class, score)| (display_species(class, names, known), *score)).collect(),
        detector_confidence: p.detector_confidence,
        animals: p.detections.iter().filter(|d| d.category == CATEGORY_ANIMAL && d.confidence >= COUNT_THRESHOLD).count() as u32,
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub id: String,
    pub error: String,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub total: usize,
    pub done: usize,
    pub failed: usize,
    pub cancelled: bool,
}

pub enum Event {
    Suggestion(Suggestion),
    Failure(Failure),
}

/// Scans `inputs` in order, calling `on_event` after each file. Stops between files when `cancel` is set.
/// A file that fails is reported and skipped; it never stops the scan.
pub fn run_scan<P: Predictor>(
    predictor: &mut P,
    inputs: &[ScanInput],
    names: &NameMap,
    known: &[String],
    thresholds: &Thresholds,
    cancel: &AtomicBool,
    mut on_event: impl FnMut(Event, &Summary),
) -> Summary {
    let mut summary = Summary { total: inputs.len(), ..Summary::default() };
    for input in inputs {
        if cancel.load(Ordering::Relaxed) {
            summary.cancelled = true;
            break;
        }
        let event = match predictor.predict_file(Path::new(&input.path), thresholds) {
            Ok(p) => {
                summary.done += 1;
                Event::Suggestion(suggestion_from(&input.id, &p, names, known))
            }
            Err(error) => {
                summary.failed += 1;
                Event::Failure(Failure { id: input.id.clone(), error })
            }
        };
        on_event(event, &summary);
    }
    summary
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::Detection;

    fn pred(label: &str, conf: f32, count: u32) -> Prediction {
        Prediction {
            label: label.to_string(),
            confidence: conf,
            top: vec![("kereru".into(), conf), ("tui".into(), 0.2), ("kea".into(), 0.1), ("weka".into(), 0.05)],
            detector_confidence: 0.9,
            count,
            detections: vec![],
        }
    }

    fn names() -> NameMap {
        NameMap::parse_csv("Class Name,Common\nkereru,Kererū\ntui,Tūī\nkea,Kea\nweka,Weka\n").unwrap()
    }

    struct Fake(Vec<Result<Prediction, String>>);
    impl Predictor for Fake {
        fn predict_file(&mut self, _: &Path, _: &Thresholds) -> Result<Prediction, String> {
            self.0.remove(0)
        }
    }

    fn inputs(n: usize) -> Vec<ScanInput> {
        (0..n).map(|i| ScanInput { id: format!("id{i}"), path: format!("/p/{i}.jpg") }).collect()
    }

    #[test]
    fn suggestions_use_the_users_own_names_and_keep_three_alternatives() {
        let known = vec!["Kererū / NZ Pigeon".to_string()];
        let s = suggestion_from("a", &pred("kereru", 0.93, 2), &names(), &known);
        assert_eq!(s.alternatives.len(), 3);
        assert_eq!(s.alternatives[0], ("Kererū / NZ Pigeon".to_string(), 0.93));
        assert_eq!(s.alternatives[1].0, "Tūī");
        assert_eq!(s.detector_confidence, 0.9);
    }

    #[test]
    fn counts_only_confident_animal_boxes() {
        let boxed = |category, confidence| Detection { confidence, category, bbox: [0.0; 4] };
        let mut p = pred("kea", 0.8, 1);
        p.detections = vec![boxed(CATEGORY_ANIMAL, 0.9), boxed(CATEGORY_ANIMAL, 0.1), boxed(2, 0.9), boxed(CATEGORY_ANIMAL, 0.25)];
        assert_eq!(suggestion_from("a", &p, &names(), &[]).animals, 2);
    }

    #[test]
    fn scans_everything_and_reports_failures_without_stopping() {
        let mut fake = Fake(vec![Ok(pred("kea", 0.8, 1)), Err("bad jpeg".into()), Ok(pred("empty", 0.9, 0))]);
        let mut seen = Vec::new();
        let summary = run_scan(&mut fake, &inputs(3), &names(), &[], &Thresholds::default(), &AtomicBool::new(false), |e, s| {
            seen.push((matches!(e, Event::Failure(_)), s.done + s.failed));
        });
        assert_eq!(summary, Summary { total: 3, done: 2, failed: 1, cancelled: false });
        assert_eq!(seen, [(false, 1), (true, 2), (false, 3)]);
    }

    #[test]
    fn stops_between_files_when_cancelled() {
        let cancel = AtomicBool::new(false);
        let mut fake = Fake(vec![Ok(pred("kea", 0.8, 1)), Ok(pred("kea", 0.8, 1)), Ok(pred("kea", 0.8, 1))]);
        let summary = run_scan(&mut fake, &inputs(3), &names(), &[], &Thresholds::default(), &cancel, |_, s| {
            if s.done == 1 {
                cancel.store(true, Ordering::Relaxed);
            }
        });
        assert_eq!(summary, Summary { total: 3, done: 1, failed: 0, cancelled: true });
    }

    #[test]
    fn the_cache_loads_once_and_refuses_a_different_pack() {
        let mut cache = EngineCache::<u32>::default();
        let mut loads = 0;
        for _ in 0..3 {
            let engine = cache.get_or_load(Path::new("/pack"), || { loads += 1; Ok(7) }).unwrap();
            assert_eq!(*engine, 7);
        }
        assert_eq!(loads, 1);
        let err = cache.get_or_load(Path::new("/other"), || Ok(1)).unwrap_err();
        assert!(err.contains("Restart TRAAACE"), "{err}");
    }

    #[test]
    fn a_failed_load_is_not_cached() {
        let mut cache = EngineCache::<u32>::default();
        assert!(cache.get_or_load(Path::new("/pack"), || Err("boom".into())).is_err());
        assert_eq!(*cache.get_or_load(Path::new("/pack"), || Ok(5)).unwrap(), 5);
    }

    #[test]
    fn an_empty_list_finishes_at_once() {
        let summary = run_scan(&mut Fake(vec![]), &[], &names(), &[], &Thresholds::default(), &AtomicBool::new(false), |_, _| panic!());
        assert_eq!(summary, Summary::default());
    }
}
