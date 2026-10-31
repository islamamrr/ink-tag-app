"""Image pipeline: picture -> six-color dithered frame, and back for previews.

Palette, packing and the protocol constants come from firmware/tools/inktag.py
so the GUI and the command-line tool always agree.
"""

import os
import sys

from PIL import Image, ImageEnhance, ImageOps

_TOOLS = os.path.join(os.path.dirname(__file__), "..", "..", "firmware", "tools")
sys.path.insert(0, os.path.abspath(_TOOLS))
try:
    import inktag  # noqa: E402
except ImportError as e:
    raise SystemExit("Can't find firmware/tools/inktag.py. Keep the devtool folder next to "
                     "the firmware folder, as in the project files.") from e

WIDTH, HEIGHT, FRAME_BYTES = inktag.WIDTH, inktag.HEIGHT, inktag.FRAME_BYTES
PALETTE = inktag.PALETTE
COLOR_CODES = inktag.COLOR_CODES
CODE_TO_RGB = {code: rgb for _, rgb, code in PALETTE}


def load(path):
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")


def prepare(img, portrait=True, fit="cover", brightness=1.0, contrast=1.0,
            saturation=1.0, dither=True):
    """Returns a WIDTH x HEIGHT palette image in panel scan order, like
    inktag.to_panel_image, plus tone controls and an optional dither."""
    target = (HEIGHT, WIDTH) if portrait else (WIDTH, HEIGHT)
    if fit == "cover":
        img = ImageOps.fit(img, target, Image.LANCZOS)
    else:
        img = ImageOps.pad(img, target, Image.LANCZOS, color=(255, 255, 255))
    for enhancer, amount in ((ImageEnhance.Brightness, brightness),
                             (ImageEnhance.Contrast, contrast),
                             (ImageEnhance.Color, saturation)):
        if amount != 1.0:
            img = enhancer(img).enhance(amount)
    if portrait:
        img = img.transpose(Image.ROTATE_90)

    pal = Image.new("P", (1, 1))
    flat = [c for _, rgb, _ in PALETTE for c in rgb]
    pal.putpalette(flat + flat[:3] * (256 - len(PALETTE)))
    return img.quantize(palette=pal, dither=Image.FLOYDSTEINBERG if dither else Image.NONE)


def pack(pimg):
    return inktag.pack_native(pimg)


def preview(pimg, portrait=True):
    return inktag.preview(pimg, portrait)


def frame_to_image(frame, portrait=True):
    """Decodes a native 4 bpp frame into an RGB picture as the badge shows it.
    Unknown pixel values draw as white, like on the panel."""
    frame = bytes(frame[:FRAME_BYTES])
    px = bytearray(2 * len(frame))
    px[0::2] = frame.translate(bytes(b >> 4 for b in range(256)))
    px[1::2] = frame.translate(bytes(b & 0x0F for b in range(256)))
    img = Image.frombytes("P", (WIDTH, HEIGHT), bytes(px))
    img.putpalette([c for v in range(16) for c in CODE_TO_RGB.get(v, (255, 255, 255))])
    img = img.convert("RGB")
    return img.transpose(Image.ROTATE_270) if portrait else img


def color_counts(pimg):
    """Share of each panel color in a prepared image, for the preview stats."""
    hist = pimg.histogram()
    total = WIDTH * HEIGHT
    return {name: hist[i] / total for i, (name, _, _) in enumerate(PALETTE)}
