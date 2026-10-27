//! On-device species detection for camera-trap photos.
//!
//! Two ONNX models run in sequence, the same pipeline as Alita (github.com/Wologman/Alita):
//! 1. MegaDetector v5a finds animals, people and vehicles and gives bounding boxes.
//! 2. A multi-label EfficientNetV2-S classifier names the species from a crop around the best box.
//!
//! The rules in this module (thresholds, labels, counts) are plain functions so they can be tested
//! without the models.

pub mod classifier;
pub mod detector;
pub mod download;
mod engine;
pub mod names;
pub mod pack;
pub mod scan;
pub mod trust;
pub mod video;

pub use engine::Engine;

/// Detector boxes below this confidence are discarded.
pub const MD_KEEP_THRESHOLD: f32 = 0.05;
/// Below this detector confidence (and a weak classifier score) the image counts as empty.
pub const MD_EMPTY_THRESHOLD: f32 = 0.15;
/// The classifier score a species needs to be named.
pub const CLASSIFIER_THRESHOLD: f32 = 0.5;
/// Animal boxes at or above this confidence are counted as individual animals.
pub const COUNT_THRESHOLD: f32 = 0.2;

/// The three thresholds that turn model scores into a label and a count. The defaults are the author's;
/// the classifier one is meant to be adjusted by the user (it was never intended to be final).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Thresholds {
    pub classifier: f32,
    pub detector_empty: f32,
    pub count: f32,
}

impl Default for Thresholds {
    fn default() -> Self {
        Self { classifier: CLASSIFIER_THRESHOLD, detector_empty: MD_EMPTY_THRESHOLD, count: COUNT_THRESHOLD }
    }
}

pub const LABEL_EMPTY: &str = "empty";
pub const LABEL_UNKNOWN: &str = "unknown";

/// MegaDetector categories.
pub const CATEGORY_ANIMAL: u8 = 1;

/// One detector box. `bbox` is `[x, y, width, height]`, each a fraction of the image.
#[derive(Debug, Clone, PartialEq)]
pub struct Detection {
    pub confidence: f32,
    pub category: u8,
    pub bbox: [f32; 4],
}

/// The result for one image.
#[derive(Debug, Clone)]
pub struct Prediction {
    /// A species class name, or `empty` / `unknown`.
    pub label: String,
    /// The classifier's score for the best species, whatever the label ended up as.
    pub confidence: f32,
    /// The three best species and their scores.
    pub top: Vec<(String, f32)>,
    /// Confidence of the best detector box, or -1 when the detector found nothing.
    pub detector_confidence: f32,
    /// Estimated animals in frame (0 for empty images).
    pub count: u32,
    pub detections: Vec<Detection>,
}

/// Turns the two models' scores into a label: a species when the classifier is confident, `unknown`
/// when the detector saw something but the classifier is unsure, `empty` when both are weak.
pub fn decide_label<'a>(best_species: &'a str, classifier_score: f32, detector_confidence: f32, t: &Thresholds) -> &'a str {
    if classifier_score >= t.classifier {
        best_species
    } else if detector_confidence > t.detector_empty {
        LABEL_UNKNOWN
    } else {
        LABEL_EMPTY
    }
}

/// Estimated number of animals: the animal boxes that clear `COUNT_THRESHOLD`, at least one when a
/// species was named, none for empty images.
pub fn estimate_count(label: &str, detections: &[Detection], count_threshold: f32) -> u32 {
    if label == LABEL_EMPTY {
        return 0;
    }
    let boxes = detections
        .iter()
        .filter(|d| d.category == CATEGORY_ANIMAL && d.confidence >= count_threshold)
        .count() as u32;
    if label == LABEL_UNKNOWN { boxes } else { boxes.max(1) }
}

/// Parses `class_names.json` (a JSON array of class names).
pub fn parse_class_names(json: &str) -> Result<Vec<String>, String> {
    serde_json::from_str::<Vec<String>>(json).map_err(|e| format!("Invalid class_names.json: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn det(conf: f32, category: u8) -> Detection {
        Detection { confidence: conf, category, bbox: [0.0, 0.0, 0.1, 0.1] }
    }

    #[test]
    fn names_a_species_only_when_the_classifier_is_confident() {
        let t = Thresholds::default();
        assert_eq!(decide_label("possum", 0.9, 0.8, &t), "possum");
        assert_eq!(decide_label("possum", 0.5, 0.0, &t), "possum"); // exactly on the threshold
        assert_eq!(decide_label("possum", 0.3, 0.6, &t), "unknown"); // detector saw something
        assert_eq!(decide_label("possum", 0.3, 0.15, &t), "empty"); // detector exactly on its threshold
        assert_eq!(decide_label("possum", 0.3, -1.0, &t), "empty"); // detector found nothing
    }

    #[test]
    fn the_classifier_threshold_can_be_changed() {
        let strict = Thresholds { classifier: 0.8, ..Thresholds::default() };
        let loose = Thresholds { classifier: 0.3, ..Thresholds::default() };
        assert_eq!(decide_label("rat", 0.6, 0.9, &strict), "unknown");
        assert_eq!(decide_label("rat", 0.6, 0.9, &loose), "rat");
        assert_eq!(decide_label("rat", 0.3, 0.9, &loose), "rat");
    }

    #[test]
    fn a_confident_classifier_overrides_a_missed_detection() {
        assert_eq!(decide_label("kiwi", 0.8, -1.0, &Thresholds::default()), "kiwi");
    }

    #[test]
    fn counts_animal_boxes_above_the_threshold() {
        let dets = [det(0.9, 1), det(0.25, 1), det(0.1, 1), det(0.9, 2), det(0.8, 3)];
        assert_eq!(estimate_count("rat", &dets, COUNT_THRESHOLD), 2);
        assert_eq!(estimate_count("rat", &dets, 0.05), 3); // a lower count threshold admits the 0.1 box
        assert_eq!(estimate_count("rat", &dets, 0.95), 1); // nothing clears it, but a named species is at least one
    }

    #[test]
    fn a_named_species_counts_at_least_one() {
        assert_eq!(estimate_count("rat", &[], COUNT_THRESHOLD), 1);
        assert_eq!(estimate_count("rat", &[det(0.1, 1)], COUNT_THRESHOLD), 1);
    }

    #[test]
    fn empty_is_zero_and_unknown_is_just_the_boxes() {
        assert_eq!(estimate_count("empty", &[det(0.9, 1)], COUNT_THRESHOLD), 0);
        assert_eq!(estimate_count("unknown", &[], COUNT_THRESHOLD), 0);
        assert_eq!(estimate_count("unknown", &[det(0.6, 1), det(0.4, 1)], COUNT_THRESHOLD), 2);
    }

    #[test]
    fn parses_class_names() {
        assert_eq!(parse_class_names(r#"["cat","dog"]"#).unwrap(), vec!["cat", "dog"]);
        assert!(parse_class_names("{}").is_err());
    }
}
