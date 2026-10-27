"""Exports MegaDetector v5a (YOLOv5x6, 1280px, 3 classes) to ONNX as raw predictions [1, 102000, 8].

  python export_detector.py <alita_dir> <out.onnx>

<alita_dir>/models/md_v5a.0.0.pt is the MegaDetector v5a weights file. Needs torch and the `megadetector`
package. Box decoding and non-max suppression happen in the app (src-tauri/src/ai/detector.rs).
"""
import sys, warnings
warnings.filterwarnings("ignore")
import torch, torch.nn as nn
from megadetector.detection.pytorch_detector import PTDetector
A, OUT = sys.argv[1], sys.argv[2]
det = PTDetector(f"{A}/models/md_v5a.0.0.pt", detector_options={'device': 'cpu'})
model = det.model.float().eval()
print("names:", getattr(model, 'names', None), "stride:", getattr(model, 'stride', None))
for m in model.modules():
    if m.__class__.__name__ == 'Detect':
        m.inplace = False
        print("Detect nc=", m.nc, "no=", m.no, "nl=", m.nl)
x = torch.zeros(1, 3, 1280, 1280)
with torch.no_grad():
    y = model(x)
print("output type:", type(y), [tuple(t.shape) if hasattr(t,'shape') else type(t) for t in (y if isinstance(y,(tuple,list)) else [y])][:3])

class Wrap(nn.Module):
    def __init__(self, m): super().__init__(); self.m = m
    def forward(self, x):
        y = self.m(x)
        return y[0] if isinstance(y, (tuple, list)) else y
w = Wrap(model).eval()
with torch.no_grad():
    ref = w(x + 0.5)
torch.onnx.export(w, x, OUT, input_names=["images"], output_names=["output"], opset_version=12, dynamo=False)
torch.save(ref, OUT + ".ref.pt")
print("exported", OUT, tuple(ref.shape))
