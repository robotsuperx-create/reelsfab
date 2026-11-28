"""Depth map of a photo for the 2.5D camera (Depth Anything V2 Small, ONNX on the CPU).

depth.py in.jpg out.png → a grayscale PNG the size of the photo, near = white. The model (~100 MB) is downloaded
once from Hugging Face into ~/.reellllocal/models.
"""
import os, sys, urllib.request
import numpy as np
from PIL import Image, ImageFilter
import onnxruntime as ort

URL = "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx"
HOME = os.path.join(os.path.expanduser("~"), ".reellllocal", "models")
MODEL = os.path.join(HOME, "depth-anything-v2-small.onnx")

def model_path():
    if not os.path.exists(MODEL):
        os.makedirs(HOME, exist_ok=True)
        tmp = MODEL + ".part"
        urllib.request.urlretrieve(URL, tmp)
        os.replace(tmp, MODEL)
    return MODEL

def main(src, dst):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    side = 518
    x = np.asarray(im.resize((side, side), Image.BICUBIC), dtype=np.float32) / 255.0
    x = (x - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array([0.229, 0.224, 0.225], dtype=np.float32)
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    sess = ort.InferenceSession(model_path(), providers=["CPUExecutionProvider"])
    out = sess.run(None, {sess.get_inputs()[0].name: x})[0]
    d = np.squeeze(out).astype(np.float32)
    lo, hi = np.percentile(d, 2), np.percentile(d, 98)
    d = np.clip((d - lo) / max(1e-6, hi - lo), 0, 1)
    img = Image.fromarray((d * 255).astype(np.uint8), "L").resize((w, h), Image.BICUBIC)
    # Soft edges: a hard depth step tears the picture when the camera moves.
    img = img.filter(ImageFilter.GaussianBlur(radius=max(2, w // 300)))
    img.save(dst)
    print(f"{w}x{h}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
