#!/usr/bin/env python3
"""Writes the golden fixtures the TypeScript tests compare against.

Uses firmware/tools/inktag.py (the reference pipeline) so the app and the
desktop tool agree byte for byte where they should.

    python tools/make_golden.py /path/to/project-files

Outputs test/golden/*.gz plus test/golden/golden.json.
"""

import gzip
import json
import math
import os
import re
import sys
import zlib

root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(root, "firmware", "tools"))
import inktag  # noqa: E402
from PIL import Image, ImageOps  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "golden")
os.makedirs(OUT, exist_ok=True)


def save(name, data):
    with open(os.path.join(OUT, name + ".gz"), "wb") as f:
        f.write(gzip.compress(data, mtime=0))


def test_picture(w, h):
    """A deterministic 'photo': hue sweep, soft gradients, solid patches."""
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            u, v = x / w, y / h
            r = 127 + 120 * math.sin(6.0 * u + 1.3 * v)
            g = 127 + 120 * math.sin(4.0 * v + 2.0 * u + 2.1)
            b = 127 + 120 * math.sin(5.0 * (u + v) + 4.2)
            if 0.1 < u < 0.3 and 0.1 < v < 0.25:
                r, g, b = 230, 40, 30
            if 0.6 < u < 0.9 and 0.7 < v < 0.85:
                r, g, b = 250, 250, 250
            px[x, y] = (int(r), int(g), int(b))
    return img


meta = {"palette": [[n, list(rgb), code] for n, rgb, code in inktag.PALETTE]}

# 1. A landscape source cropped to portrait, as inktag.py convert does it.
src = test_picture(900, 600)
fitted = ImageOps.fit(src, (inktag.HEIGHT, inktag.WIDTH), Image.LANCZOS)   # 528 x 792
save("photo_fitted_rgb", fitted.tobytes())

pal = Image.new("P", (1, 1))
flat = [c for _, rgb, _ in inktag.PALETTE for c in rgb]
pal.putpalette(flat + flat[:3] * (256 - len(inktag.PALETTE)))
q = fitted.transpose(Image.ROTATE_90).quantize(palette=pal, dither=Image.FLOYDSTEINBERG)
frame = inktag.pack_native(q)
save("photo_frame", frame)
# The same palette indices, turned back to portrait, so TS can pack them itself.
save("photo_indices_portrait", q.transpose(Image.ROTATE_270).tobytes())
save("photo_preview_rgb", inktag.preview(q, True).tobytes())
hist = q.histogram()
meta["photo"] = {
    "crc32": zlib.crc32(frame),
    "shares": {n: hist[i] / (inktag.WIDTH * inktag.HEIGHT) for i, (n, _, _) in enumerate(inktag.PALETTE)},
}

# 2. The vendor's sample frame from the reference code, a known-good packed image.
ref = [f for f in os.listdir(root) if f.endswith(".txt") and "UC8279E" in f]
if ref:
    text = open(os.path.join(root, ref[0]), encoding="utf-8", errors="replace").read()
    body = text[text.index("DTM1[209088]"):]
    body = body[body.index("{") + 1: body.index("}")]
    data = bytes(int(h, 16) for h in re.findall(r"0x([0-9A-Fa-f]{2})", body))
    assert len(data) == inktag.FRAME_BYTES, len(data)
    save("vendor_dtm1", data)
    meta["vendor_dtm1"] = {"crc32": zlib.crc32(data)}

with open(os.path.join(OUT, "golden.json"), "w") as f:
    json.dump(meta, f, indent=2)
print("wrote", OUT, json.dumps(meta, indent=1))
