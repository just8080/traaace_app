//! The species classifier's input: a 600px square cut around the best detector box (Alita's own
//! rule), centre-cropped to 480px and normalised.

use image::{imageops::FilterType, Rgb, RgbImage};
use ndarray::Array4;

pub const CROP_SIZE: u32 = 600;
pub const INPUT_SIZE: u32 = 480;
const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const STD: [f32; 3] = [0.229, 0.224, 0.225];

/// Where to cut from the (possibly shrunk) photo.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CropPlan {
    /// Size of the photo after any shrinking.
    pub width: u32,
    pub height: u32,
    pub left: i32,
    pub top: i32,
}

/// Alita shrinks the whole photo when the box is bigger than the crop, so the box fits; then takes a
/// `CROP_SIZE` square around the box centre, sliding it back inside the photo if it would overhang.
/// `bbox` is `[x, y, width, height]` as fractions; use `[0, 0, 1, 1]` when nothing was detected.
pub fn plan_crop(width: u32, height: u32, bbox: [f32; 4]) -> CropPlan {
    let clamp = |n: f32| n.clamp(0.0, 1.0);
    let [x0, y0, bw, bh] = bbox;
    let max_dim = ((clamp(x0 + bw) - clamp(x0)) * width as f32).max((clamp(y0 + bh) - clamp(y0)) * height as f32);
    let (mut w, mut h) = (width, height);
    if max_dim > CROP_SIZE as f32 {
        let scale = CROP_SIZE as f32 / max_dim;
        w = (width as f32 * scale).round().max(1.0) as u32;
        h = (height as f32 * scale).round().max(1.0) as u32;
    }

    let size = CROP_SIZE as i32;
    let centre_x = (x0 + bw / 2.0) * w as f32;
    let centre_y = (y0 + bh / 2.0) * h as f32;
    let left = (centre_x - size as f32 / 2.0) as i32; // truncates toward zero, like Alita
    let top = (centre_y - size as f32 / 2.0) as i32;

    let slide = |start: i32, limit: i32| -> i32 {
        let end = start + size;
        if start < 0 && end > limit { 0 } else { start - if start < 0 { start } else { 0 } - if end > limit { end - limit } else { 0 } }
    };
    CropPlan { width: w, height: h, left: slide(left, w as i32), top: slide(top, h as i32) }
}

/// Cuts the planned square out of `img` (already at the planned size) and, when the photo is smaller
/// than the crop, centres it on black padding.
pub fn extract_square(img: &RgbImage, plan: &CropPlan) -> RgbImage {
    let (w, h) = (img.width() as i32, img.height() as i32);
    let size = CROP_SIZE as i32;
    let x0 = plan.left.clamp(0, w);
    let y0 = plan.top.clamp(0, h);
    let x1 = (plan.left + size).clamp(0, w);
    let y1 = (plan.top + size).clamp(0, h);
    let (cw, ch) = ((x1 - x0) as u32, (y1 - y0) as u32);

    let side = cw.max(ch).max(CROP_SIZE);
    let mut square = RgbImage::from_pixel(side, side, Rgb([0, 0, 0]));
    let (off_x, off_y) = ((side - cw) / 2, (side - ch) / 2);
    for y in 0..ch {
        for x in 0..cw {
            square.put_pixel(off_x + x, off_y + y, *img.get_pixel(x0 as u32 + x, y0 as u32 + y));
        }
    }
    square
}

/// The classifier input `[1, 3, 480, 480]` for one photo and its best box.
pub fn preprocess(img: &RgbImage, bbox: [f32; 4]) -> Array4<f32> {
    let plan = plan_crop(img.width(), img.height(), bbox);
    let shrunk;
    let source = if (plan.width, plan.height) == (img.width(), img.height()) {
        img
    } else {
        shrunk = image::imageops::resize(img, plan.width, plan.height, FilterType::Triangle);
        &shrunk
    };
    let square = extract_square(source, &plan);

    let size = INPUT_SIZE as usize;
    let (off_x, off_y) = ((square.width() - INPUT_SIZE) / 2, (square.height() - INPUT_SIZE) / 2);
    let mut input = Array4::<f32>::zeros((1, 3, size, size));
    for y in 0..size {
        for x in 0..size {
            let px = square.get_pixel(off_x + x as u32, off_y + y as u32);
            for c in 0..3 {
                input[[0, c, y, x]] = (px[c] as f32 / 255.0 - MEAN[c]) / STD[c];
            }
        }
    }
    input
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn centres_a_small_box_in_a_large_photo() {
        // 2000x1500 photo, a 100x100 box centred at (1000, 725): the square starts 300px up and left of it.
        let plan = plan_crop(2000, 1500, [0.475, 0.45, 0.05, 100.0 / 1500.0]);
        assert_eq!((plan.width, plan.height), (2000, 1500)); // box is small: no shrinking
        assert_eq!((plan.left, plan.top), (700, 425));
    }

    #[test]
    fn slides_the_square_back_inside_at_the_edges() {
        let right = plan_crop(2000, 1500, [0.95, 0.45, 0.05, 0.1]);
        assert_eq!(right.left, 2000 - 600);
        let corner = plan_crop(2000, 1500, [0.0, 0.0, 0.05, 0.05]);
        assert_eq!((corner.left, corner.top), (0, 0));
    }

    #[test]
    fn shrinks_the_photo_when_the_box_is_bigger_than_the_crop() {
        // The box is 1200px wide in a 2400x1800 photo, so everything is halved.
        let plan = plan_crop(2400, 1800, [0.25, 0.25, 0.5, 0.5]);
        assert_eq!((plan.width, plan.height), (1200, 900));
        assert_eq!((plan.left, plan.top), (300, 150)); // box centre (600, 450) minus 300
    }

    #[test]
    fn a_whole_image_box_shrinks_to_the_crop_size_on_its_long_side() {
        let plan = plan_crop(1200, 800, [0.0, 0.0, 1.0, 1.0]);
        assert_eq!((plan.width, plan.height), (600, 400));
    }

    #[test]
    fn pads_photos_smaller_than_the_crop_onto_black() {
        let img = RgbImage::from_pixel(400, 300, Rgb([10, 20, 30]));
        let plan = plan_crop(400, 300, [0.0, 0.0, 0.5, 0.5]);
        let square = extract_square(&img, &plan);
        assert_eq!((square.width(), square.height()), (600, 600));
        assert_eq!(*square.get_pixel(0, 0), Rgb([0, 0, 0])); // padding
        assert_eq!(*square.get_pixel(300, 300), Rgb([10, 20, 30])); // photo, centred
    }

    #[test]
    fn extract_square_cuts_the_planned_region() {
        let mut img = RgbImage::from_pixel(1000, 1000, Rgb([0, 0, 0]));
        img.put_pixel(100, 200, Rgb([255, 1, 2]));
        let square = extract_square(&img, &CropPlan { width: 1000, height: 1000, left: 100, top: 200 });
        assert_eq!(*square.get_pixel(0, 0), Rgb([255, 1, 2]));
        assert_eq!((square.width(), square.height()), (600, 600));
    }

    #[test]
    fn preprocess_normalises_with_imagenet_statistics() {
        let img = RgbImage::from_pixel(1000, 1000, Rgb([255, 255, 255]));
        let input = preprocess(&img, [0.4, 0.4, 0.2, 0.2]);
        assert_eq!(input.shape(), &[1, 3, 480, 480]);
        assert!((input[[0, 0, 10, 10]] - (1.0 - 0.485) / 0.229).abs() < 1e-4);
        assert!((input[[0, 1, 10, 10]] - (1.0 - 0.456) / 0.224).abs() < 1e-4);
        assert!((input[[0, 2, 10, 10]] - (1.0 - 0.406) / 0.225).abs() < 1e-4);
    }
}
