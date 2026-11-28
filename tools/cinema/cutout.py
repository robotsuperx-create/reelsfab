"""Cuts the subject out of a photo (rembg, isnet-general-use) for the 2.5D parallax: cutout.py in.jpg out.png"""
import sys
from rembg import new_session, remove
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
im.thumbnail((1600, 1600))
cut = remove(im, session=new_session("isnet-general-use"))
bbox = cut.getbbox()
# A cutout that is almost the whole frame or almost nothing is not a subject.
if not bbox or (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) < 0.04 * im.size[0] * im.size[1]:
    sys.exit(3)
cut.save(dst)
print(json_size := f"{im.size[0]}x{im.size[1]}")
