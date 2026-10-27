"""Python reference for the in-app pipeline (src-tauri/src/ai): used to validate the Rust port.

  python reference_pipeline.py <folder> --models <dir with detector.onnx, classifier.onnx, class_names.json>
         [--provider cpu|coreml|hybrid] [--ref reference.json] [--out results.json]

Needs onnxruntime, opencv-python and numpy.
"""
import sys, json, time, argparse, warnings
warnings.filterwarnings("ignore")
from pathlib import Path
import numpy as np, cv2, onnxruntime as ort

ap = argparse.ArgumentParser()
ap.add_argument("folder"); ap.add_argument("--models", required=True); ap.add_argument("--provider", default="cpu")
ap.add_argument("--ref"); ap.add_argument("--out"); ap.add_argument("--limit", type=int, default=0)
a = ap.parse_args()
M = Path(a.models)
names = json.load(open(M / "class_names.json"))
MEAN = np.array([0.485, 0.456, 0.406], np.float32); STD = np.array([0.229, 0.224, 0.225], np.float32)
MD_KEEP = 0.05; NMS_IOU = 0.45; CROP = 600; FINAL = 480; MD_EMPTY = 0.15; CLS_THRESH = 0.5

def make(path, gpu):
    so = ort.SessionOptions(); so.log_severity_level = 3
    prov = ["CoreMLExecutionProvider", "CPUExecutionProvider"] if gpu else ["CPUExecutionProvider"]
    return ort.InferenceSession(str(path), so, providers=prov)
# cpu = everything on CPU; coreml = both on the GPU path; hybrid = detector on the GPU path, classifier on CPU
t0 = time.time(); det = make(M / "detector.onnx", a.provider in ("coreml", "hybrid")); cls = make(M / "classifier.onnx", a.provider == "coreml"); print(f"models loaded in {time.time()-t0:.1f}s ({a.provider})")

def letterbox(img, size=1280):
    h, w = img.shape[:2]; r = min(size / h, size / w); nh, nw = round(h * r), round(w * r)
    canvas = np.full((size, size, 3), 114, np.uint8); top, left = (size - nh) // 2, (size - nw) // 2
    canvas[top:top + nh, left:left + nw] = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    return canvas, r, left, top

def nms(boxes, scores, iou):
    order = scores.argsort()[::-1]; keep = []
    while order.size:
        i = order[0]; keep.append(i)
        if order.size == 1: break
        rest = order[1:]
        xx1 = np.maximum(boxes[i, 0], boxes[rest, 0]); yy1 = np.maximum(boxes[i, 1], boxes[rest, 1])
        xx2 = np.minimum(boxes[i, 2], boxes[rest, 2]); yy2 = np.minimum(boxes[i, 3], boxes[rest, 3])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        a_i = (boxes[i, 2] - boxes[i, 0]) * (boxes[i, 3] - boxes[i, 1]); a_r = (boxes[rest, 2] - boxes[rest, 0]) * (boxes[rest, 3] - boxes[rest, 1])
        order = rest[inter / (a_i + a_r - inter + 1e-9) <= iou]
    return keep

def detect(rgb):
    h, w = rgb.shape[:2]
    lb, r, left, top = letterbox(rgb)
    x = (lb.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
    pred = det.run(None, {"images": x})[0][0]                       # [N, 8] = cx, cy, w, h, obj, 3 class scores
    conf_all = pred[:, 4:5] * pred[:, 5:]
    cat = conf_all.argmax(1); conf = conf_all.max(1)
    m = conf > MD_KEEP
    p = pred[m]; conf = conf[m]; cat = cat[m] + 1                   # MegaDetector categories: 1 animal, 2 person, 3 vehicle
    if not len(p): return []
    xyxy = np.stack([p[:, 0] - p[:, 2] / 2, p[:, 1] - p[:, 3] / 2, p[:, 0] + p[:, 2] / 2, p[:, 1] + p[:, 3] / 2], 1)
    off = cat[:, None] * 4096.0                                       # class-aware NMS
    keep = nms(xyxy + off, conf, NMS_IOU)
    out = []
    for i in keep:
        x1, y1, x2, y2 = xyxy[i]
        x1 = np.clip((x1 - left) / r, 0, w); x2 = np.clip((x2 - left) / r, 0, w); y1 = np.clip((y1 - top) / r, 0, h); y2 = np.clip((y2 - top) / r, 0, h)
        out.append({"conf": float(conf[i]), "cat": int(cat[i]), "box": [x1 / w, y1 / h, (x2 - x1) / w, (y2 - y1) / h]})
    return out

def crop_for(rgb, box):
    """Alita's md_crop_image: scale down if the box is bigger than 600px, take a 600px square around its centre."""
    h, w = rgb.shape[:2]; x0, y0, bw, bh = box
    clamp = lambda n: max(min(1, n), 0)
    maxdim = max((clamp(x0 + bw) - clamp(x0)) * w, (clamp(y0 + bh) - clamp(y0)) * h)
    if maxdim > CROP:
        s = CROP / maxdim; w, h = int(round(w * s)), int(round(h * s)); rgb = cv2.resize(rgb, (w, h), interpolation=cv2.INTER_LINEAR)
    cx = (x0 + bw / 2) * w; cy = (y0 + bh / 2) * h
    left = int(cx - CROP / 2); top = int(cy - CROP / 2); right = left + CROP; bottom = top + CROP
    if left < 0 and right > w: nl, nr = 0, CROP
    else: nl = left - (left < 0) * left - (right > w) * (right - w); nr = right - (left < 0) * left - (right > w) * (right - w)
    if top < 0 and bottom > h: nt, nb = 0, CROP
    else: nt = top - (top < 0) * top - (bottom > h) * (bottom - h); nb = bottom - (top < 0) * top - (bottom > h) * (bottom - h)
    c = rgb[nt:nb, nl:nr]
    if c.shape[0] < CROP or c.shape[1] < CROP:
        d = max(c.shape[0], c.shape[1], CROP); sq = np.zeros((d, d, 3), np.uint8); yo = (d - c.shape[0]) // 2; xo = (d - c.shape[1]) // 2
        sq[yo:yo + c.shape[0], xo:xo + c.shape[1]] = c; c = sq
    o = (c.shape[0] - FINAL) // 2; q = (c.shape[1] - FINAL) // 2
    c = c[o:o + FINAL, q:q + FINAL]
    return ((c.astype(np.float32) / 255.0 - MEAN) / STD).transpose(2, 0, 1)

files = sorted(p for p in Path(a.folder).rglob("*") if p.suffix.lower() in (".jpg", ".jpeg"))
if a.limit: files = files[: a.limit]
res = {}; td = tc = 0.0
t_all = time.time()
for f in files:
    rgb = cv2.cvtColor(cv2.imread(str(f)), cv2.COLOR_BGR2RGB)
    t = time.time(); dets = detect(rgb); td += time.time() - t
    best = max(dets, key=lambda d: d["conf"]) if dets else {"conf": -1.0, "cat": -1, "box": [0, 0, 1, 1]}
    t = time.time(); scores = cls.run(None, {"input": crop_for(rgb, best["box"])[None]})[0][0]; tc += time.time() - t
    top = np.argsort(scores)[::-1][:3]
    pmax = float(scores[top[0]])
    label = names[top[0]] if pmax >= CLS_THRESH else ("unknown" if best["conf"] > MD_EMPTY else "empty")
    if best["conf"] < MD_EMPTY and pmax < CLS_THRESH: label = "empty"
    res[str(f.relative_to(a.folder))] = {"label": label, "top3": [(names[i], round(float(scores[i]), 3)) for i in top], "md_conf": best["conf"], "cat": best["cat"], "box": best["box"],
                   "n_animals_0.2": sum(1 for d in dets if d["cat"] == 1 and d["conf"] >= 0.2), "n_all": len(dets), "probs": scores.tolist()}
wall = time.time() - t_all
print(f"{len(files)} images in {wall:.1f}s = {wall/len(files)*1000:.0f} ms/image   (detector {td/len(files)*1000:.0f} ms, classifier {tc/len(files)*1000:.0f} ms)")
if a.out: json.dump(res, open(a.out, "w"), default=float)
if a.ref:
    ref = json.load(open(a.ref)); agree = 0; maxdiff = []; iou_ok = 0; n = 0
    for k, r in ref.items():
        if k not in res: continue
        n += 1
        rp = np.array(r["probs"]); op = np.array(res[k]["probs"])
        agree += int(rp.argmax() == op.argmax()); maxdiff.append(float(np.abs(rp - op).max()))
        bx = r["box"]; ob = res[k]["box"]
        def xyxy(b): return b[0], b[1], b[0] + b[2], b[1] + b[3]
        a1 = xyxy(bx); a2 = xyxy(ob)
        iw = max(0, min(a1[2], a2[2]) - max(a1[0], a2[0])); ih = max(0, min(a1[3], a2[3]) - max(a1[1], a2[1]))
        inter = iw * ih; union = bx[2] * bx[3] + ob[2] * ob[3] - inter
        iou_ok += int(union > 0 and inter / union > 0.8)
    print(f"vs PyTorch reference ({n} images): same top-1 species {agree}/{n}; best box IoU>0.8 {iou_ok}/{n}; median max|prob diff| {np.median(maxdiff):.3f}, worst {max(maxdiff):.3f}")
for k, v in list(res.items())[: (a.limit or 25)]:
    print(f"{k[-40:]:40} {v['label']:20} {v['top3'][0][0]:>18} {v['top3'][0][1]:.2f}  md={v['md_conf']:.2f} animals={v['n_animals_0.2']}")
