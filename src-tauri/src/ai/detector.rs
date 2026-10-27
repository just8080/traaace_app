//! MegaDetector v5a: letterbox the photo to 1280x1280, read the raw YOLO output, and clean it up.

use super::{Detection, MD_KEEP_THRESHOLD};
use image::{imageops::FilterType, RgbImage};
use ndarray::Array4;

pub const INPUT_SIZE: u32 = 1280;
const PAD_VALUE: f32 = 114.0 / 255.0;
const NMS_IOU: f32 = 0.45;
/// Columns per prediction row: centre x, centre y, width, height, objectness, then 3 class scores.
const ROW: usize = 8;

/// How a photo was fitted into the square model input, needed to map boxes back.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Letterbox {
    pub scale: f32,
    pub left: u32,
    pub top: u32,
    pub width: u32,
    pub height: u32,
}

pub fn letterbox_geometry(width: u32, height: u32) -> (Letterbox, u32, u32) {
    let scale = (INPUT_SIZE as f32 / height as f32).min(INPUT_SIZE as f32 / width as f32);
    let new_w = (width as f32 * scale).round() as u32;
    let new_h = (height as f32 * scale).round() as u32;
    let lb = Letterbox { scale, left: (INPUT_SIZE - new_w) / 2, top: (INPUT_SIZE - new_h) / 2, width, height };
    (lb, new_w, new_h)
}

/// Resizes to fit, pads with grey, and returns the model input `[1, 3, 1280, 1280]` in 0..1.
pub fn preprocess(img: &RgbImage) -> (Array4<f32>, Letterbox) {
    let (lb, new_w, new_h) = letterbox_geometry(img.width(), img.height());
    let resized = image::imageops::resize(img, new_w, new_h, FilterType::Triangle);
    let size = INPUT_SIZE as usize;
    let mut input = Array4::<f32>::from_elem((1, 3, size, size), PAD_VALUE);
    for (x, y, px) in resized.enumerate_pixels() {
        let (ix, iy) = ((x + lb.left) as usize, (y + lb.top) as usize);
        for c in 0..3 {
            input[[0, c, iy, ix]] = px[c] as f32 / 255.0;
        }
    }
    (input, lb)
}

fn iou(a: &[f32; 4], b: &[f32; 4]) -> f32 {
    let iw = (a[2].min(b[2]) - a[0].max(b[0])).max(0.0);
    let ih = (a[3].min(b[3]) - a[1].max(b[1])).max(0.0);
    let inter = iw * ih;
    let union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
    inter / (union + 1e-9)
}

/// Greedy non-maximum suppression on `[x1, y1, x2, y2]` boxes; returns the indices to keep.
pub fn nms(boxes: &[[f32; 4]], scores: &[f32], iou_threshold: f32) -> Vec<usize> {
    let mut order: Vec<usize> = (0..boxes.len()).collect();
    order.sort_by(|&a, &b| scores[b].total_cmp(&scores[a]));
    let mut keep = Vec::new();
    while let Some(&best) = order.first() {
        keep.push(best);
        order = order[1..].iter().copied().filter(|&i| iou(&boxes[best], &boxes[i]) <= iou_threshold).collect();
    }
    keep
}

/// Reads the raw model output (`rows` of 8 numbers) into detections, best first.
pub fn decode(output: &[f32], lb: &Letterbox) -> Vec<Detection> {
    let mut boxes = Vec::new();
    let mut offset_boxes = Vec::new();
    let mut scores = Vec::new();
    let mut categories = Vec::new();

    for row in output.chunks_exact(ROW) {
        let objectness = row[4];
        if objectness <= MD_KEEP_THRESHOLD {
            continue; // the class score is at most 1, so this row can never reach the threshold
        }
        let (mut category, mut best) = (0usize, 0.0f32);
        for (i, class_score) in row[5..ROW].iter().enumerate() {
            if class_score * objectness > best {
                best = class_score * objectness;
                category = i;
            }
        }
        if best <= MD_KEEP_THRESHOLD {
            continue;
        }
        let xyxy = [row[0] - row[2] / 2.0, row[1] - row[3] / 2.0, row[0] + row[2] / 2.0, row[1] + row[3] / 2.0];
        // Offsetting boxes by category keeps NMS from suppressing an animal with a person next to it.
        let off = (category as f32 + 1.0) * 4096.0;
        offset_boxes.push([xyxy[0] + off, xyxy[1] + off, xyxy[2] + off, xyxy[3] + off]);
        boxes.push(xyxy);
        scores.push(best);
        categories.push(category as u8 + 1);
    }

    let (w, h) = (lb.width as f32, lb.height as f32);
    nms(&offset_boxes, &scores, NMS_IOU)
        .into_iter()
        .map(|i| {
            let b = boxes[i];
            let x1 = ((b[0] - lb.left as f32) / lb.scale).clamp(0.0, w);
            let x2 = ((b[2] - lb.left as f32) / lb.scale).clamp(0.0, w);
            let y1 = ((b[1] - lb.top as f32) / lb.scale).clamp(0.0, h);
            let y2 = ((b[3] - lb.top as f32) / lb.scale).clamp(0.0, h);
            Detection { confidence: scores[i], category: categories[i], bbox: [x1 / w, y1 / h, (x2 - x1) / w, (y2 - y1) / h] }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn letterbox_centres_a_landscape_photo() {
        let (lb, new_w, new_h) = letterbox_geometry(2560, 1920);
        assert_eq!((new_w, new_h), (1280, 960));
        assert_eq!((lb.left, lb.top), (0, 160));
        assert!((lb.scale - 0.5).abs() < 1e-6);
    }

    #[test]
    fn letterbox_centres_a_portrait_photo_and_upscales_small_ones() {
        let (lb, new_w, new_h) = letterbox_geometry(640, 1280);
        assert_eq!((new_w, new_h, lb.left, lb.top), (640, 1280, 320, 0));
        let (small, w, h) = letterbox_geometry(640, 480);
        assert_eq!((w, h, small.left, small.top), (1280, 960, 0, 160));
    }

    #[test]
    fn preprocess_pads_with_grey_and_scales_to_unit_range() {
        let img = RgbImage::from_pixel(1280, 640, image::Rgb([255, 0, 51]));
        let (input, lb) = preprocess(&img);
        assert_eq!(input.shape(), &[1, 3, 1280, 1280]);
        assert_eq!(lb.top, 320);
        assert!((input[[0, 0, 0, 0]] - 114.0 / 255.0).abs() < 1e-6); // padding
        assert!((input[[0, 0, 640, 640]] - 1.0).abs() < 1e-6); // red
        assert!((input[[0, 1, 640, 640]] - 0.0).abs() < 1e-6); // green
        assert!((input[[0, 2, 640, 640]] - 0.2).abs() < 1e-3); // blue
    }

    #[test]
    fn nms_drops_overlaps_and_keeps_separate_boxes() {
        let boxes = [[0.0, 0.0, 10.0, 10.0], [1.0, 1.0, 11.0, 11.0], [50.0, 50.0, 60.0, 60.0]];
        let kept = nms(&boxes, &[0.9, 0.8, 0.7], 0.45);
        assert_eq!(kept, vec![0, 2]);
    }

    #[test]
    fn nms_prefers_the_higher_score() {
        let boxes = [[0.0, 0.0, 10.0, 10.0], [0.5, 0.5, 10.5, 10.5]];
        assert_eq!(nms(&boxes, &[0.4, 0.9], 0.45), vec![1]);
    }

    fn row(cx: f32, cy: f32, w: f32, h: f32, obj: f32, classes: [f32; 3]) -> Vec<f32> {
        vec![cx, cy, w, h, obj, classes[0], classes[1], classes[2]]
    }

    #[test]
    fn decode_maps_boxes_back_to_the_original_photo() {
        // A 2560x1920 photo is scaled by 0.5 and padded 160px top and bottom.
        let (lb, _, _) = letterbox_geometry(2560, 1920);
        // Box centred at (640, 640) in model space, 200 wide and 100 high, an animal at 0.9 x 0.8.
        let out = row(640.0, 640.0, 200.0, 100.0, 0.9, [0.8, 0.0, 0.0]);
        let dets = decode(&out, &lb);
        assert_eq!(dets.len(), 1);
        let d = &dets[0];
        assert_eq!(d.category, 1);
        assert!((d.confidence - 0.72).abs() < 1e-5);
        // x: (540 - 0) / 0.5 = 1080 of 2560; y: (590 - 160) / 0.5 = 860 of 1920; 400 x 200 pixels.
        assert!((d.bbox[0] - 1080.0 / 2560.0).abs() < 1e-5);
        assert!((d.bbox[1] - 860.0 / 1920.0).abs() < 1e-5);
        assert!((d.bbox[2] - 400.0 / 2560.0).abs() < 1e-5);
        assert!((d.bbox[3] - 200.0 / 1920.0).abs() < 1e-5);
    }

    #[test]
    fn decode_ignores_weak_rows_and_reports_the_best_category() {
        let (lb, _, _) = letterbox_geometry(1280, 1280);
        let mut out = row(100.0, 100.0, 50.0, 50.0, 0.04, [1.0, 0.0, 0.0]); // below the threshold
        out.extend(row(400.0, 400.0, 80.0, 80.0, 0.9, [0.1, 0.8, 0.2])); // a person
        let dets = decode(&out, &lb);
        assert_eq!(dets.len(), 1);
        assert_eq!(dets[0].category, 2);
    }

    #[test]
    fn decode_keeps_an_animal_next_to_an_overlapping_person() {
        let (lb, _, _) = letterbox_geometry(1280, 1280);
        let mut out = row(400.0, 400.0, 100.0, 100.0, 0.9, [0.9, 0.0, 0.0]);
        out.extend(row(405.0, 405.0, 100.0, 100.0, 0.9, [0.0, 0.9, 0.0]));
        assert_eq!(decode(&out, &lb).len(), 2);
    }

    #[test]
    fn decode_clamps_boxes_to_the_photo() {
        let (lb, _, _) = letterbox_geometry(1280, 1280);
        let dets = decode(&row(1270.0, 10.0, 100.0, 100.0, 0.9, [0.9, 0.0, 0.0]), &lb);
        let b = dets[0].bbox;
        assert!(b[0] + b[2] <= 1.0 + 1e-6 && b[1] >= 0.0);
    }
}
