"""Exports Alita's species classifier (tf_efficientnetv2_s, 81 classes) to ONNX, with the sigmoid inside.

  python export_classifier.py <alita_dir> <out.onnx>

<alita_dir> is a checkout of github.com/Wologman/Alita with models/Exp_60/ (weights, class names).
Needs torch, timm and onnx. Output matches the PyTorch model to ~2e-7.
"""
import sys, json, warnings
warnings.filterwarnings("ignore")
import torch, torch.nn as nn, timm
A = sys.argv[1]          # alita_run dir
OUT = sys.argv[2]

class ClassifierHead(nn.Module):
    def __init__(self, num_features, num_classes):
        super().__init__()
        self.linear = nn.Linear(num_features, num_features // 2)
        self.relu = nn.ReLU(inplace=True)
        self.dropout = nn.Dropout(p=0)
        self.output_layer = nn.Linear(num_features // 2, num_classes)
    def forward(self, x):
        return self.output_layer(self.dropout(self.relu(self.linear(x))))

class Net(nn.Module):
    """Backbone + head, with the sigmoid inside so the app only applies thresholds."""
    def __init__(self, n):
        super().__init__()
        self.backbone = timm.create_model('tf_efficientnetv2_s.in21k', pretrained=False)
        self.backbone.classifier = ClassifierHead(self.backbone.classifier.in_features, n)
    def forward(self, x):
        return torch.sigmoid(self.backbone(x))

names = json.load(open(f"{A}/models/Exp_60/Exp_60_run_01_class_names.json"))
print("classes:", len(names))
m = Net(len(names))
sd = torch.load(f"{A}/models/Exp_60/Exp_60_run_01_best_weights.pt", map_location="cpu")
print(m.load_state_dict(sd))
m.eval()
x = torch.randn(2, 3, 480, 480)
with torch.no_grad():
    ref = m(x)
torch.onnx.export(m, x, OUT, input_names=["input"], output_names=["scores"],
                  dynamic_axes={"input": {0: "batch"}, "scores": {0: "batch"}}, opset_version=17, dynamo=False)
print("exported", OUT)
torch.save(ref, OUT + ".ref.pt"); torch.save(x, OUT + ".in.pt")
