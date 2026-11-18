#!/usr/bin/env python3
"""Ink Tag desktop test tool: converts pictures and sends them over BLE.

Stands in for the phone app until it exists, and doubles as a reference for
the app's image pipeline and BLE protocol (docs/PROTOCOL.md).

    pip install pillow bleak
    python inktag.py convert photo.jpg --preview preview.png --out photo.bin
    python inktag.py send photo.jpg            # first Ink Tag found nearby
    python inktag.py send photo.jpg --name InkTag-1A2B
    python inktag.py clear white
    python inktag.py show
    python inktag.py info
    python inktag.py send photo.jpg --slot 2 --keep   # store in slot 2 without drawing (firmware 0.6+)
    python inktag.py show --slot 2                    # draw slot 2
    python inktag.py slots                            # list what each slot holds
    python inktag.py delete 2
    python inktag.py update build/inktag.bin          # wireless firmware update (firmware 0.6+)
    python inktag.py temp 35                   # pretend the panel is 35 C ("off" = read it again)
    python inktag.py window 304 200 184 128 black            # redraw one box only
    python inktag.py window 304 200 184 128 white --code1 skip --code2 90
"""

import argparse
import asyncio
import struct
import sys
import zlib

from PIL import Image, ImageOps

WIDTH, HEIGHT = 792, 528          # panel controller orientation (landscape)
FRAME_BYTES = WIDTH * HEIGHT // 2
FMT_NATIVE_4BPP = 0x01

# Palette used for dithering and previews, and the panel code for each entry.
# These are colors measured on a real six-color (Spectra 6) panel, not pure
# RGB: the panel's white is a light grey and its red is dark, so dithering
# against pure primaries makes photos come out washed out. Source:
# epaper-dithering, SPECTRA_7_3_6COLOR (docs.rs/crate/epaper-dithering-core,
# measured_palettes.rs). Replace with measurements of our own panel once it
# runs: photograph each color band of the boot test pattern under daylight.
PALETTE = [
    ("black", (26, 13, 35), 0),
    ("white", (185, 202, 205), 1),
    ("yellow", (202, 184, 0), 2),
    ("red", (121, 9, 0), 3),
    ("blue", (0, 69, 139), 5),
    ("green", (40, 82, 57), 6),
]
COLOR_CODES = {name: code for name, _, code in PALETTE}

UUID_BASE = "b5a1{:04x}-6e6b-4a7a-9c3e-1f2a3b4c5d6e"
UUID_SERVICE = UUID_BASE.format(0x0000)
UUID_CONTROL = UUID_BASE.format(0x0001)
UUID_DATA = UUID_BASE.format(0x0002)

CMD_BEGIN, CMD_END, CMD_SHOW, CMD_CLEAR, CMD_INFO, CMD_ABORT, CMD_TEMP = 1, 2, 3, 4, 5, 6, 7
CMD_WINDOW = 0x0B
CMD_DELETE, CMD_SLOT, CMD_UPDATE_BEGIN, CMD_UPDATE_END = 0x0C, 0x0D, 0x0E, 0x0F   # firmware 0.6+
EVT_READY, EVT_RECEIVED, EVT_DISPLAYED, EVT_INFO, EVT_ERROR = 0x81, 0x82, 0x83, 0x84, 0x8F
EVT_WINDOW = 0x86
EVT_UPDATED, EVT_SLOT = 0x87, 0x88
BEGIN_SHOW = 0x01                 # BEGIN flags: draw the picture once it arrives

# Window test (firmware 0.5+): see docs/PROTOCOL.md
WINDOW_STRIPES = 0x10             # fill the box with six color stripes
WINDOW_CODE_NORMAL, WINDOW_CODE_SKIP = 0x00, 0xFF
WINDOW_BOX_DATA = 0x01            # flags: send only the box's pixels


def window_command(x, y, w, h, fill, code1=WINDOW_CODE_NORMAL, code2=WINDOW_CODE_NORMAL, box_data=True):
    if x % 8 or w % 8 or w <= 0 or h <= 0 or x + w > WIDTH or y + h > HEIGHT:
        raise ValueError(f"box must fit in {WIDTH}x{HEIGHT}, with x and width multiples of 8")
    return struct.pack("<BHHHHBBBB", CMD_WINDOW, x, y, w, h, fill, code1, code2,
                       WINDOW_BOX_DATA if box_data else 0)


def parse_window(msg):
    """WINDOW notification -> (temperature C, code1, code2, pass 1 ms, pass 2 ms)."""
    return struct.unpack_from("<bBBII", msg, 2)


def parse_code(text):
    """'normal', 'skip', or a number (decimal or 0x..) for register 0xE6."""
    if text == "normal":
        return WINDOW_CODE_NORMAL
    if text == "skip":
        return WINDOW_CODE_SKIP
    v = int(text, 0)
    if not 1 <= v <= 0xFE:
        raise argparse.ArgumentTypeError("code must be 1..254, normal or skip")
    return v
ERRORS = {
    1: "bad command", 2: "bad length", 3: "bad state", 4: "overflow", 5: "CRC mismatch",
    6: "flash error", 7: "panel timeout", 8: "no stored image", 9: "bad format",
    10: "locked to another phone", 11: "no such slot", 12: "not a valid Ink Tag firmware for this chip",
}


def parse_slot(msg):
    """SLOT notification -> (slot, used, format, length, crc32)."""
    return struct.unpack_from("<BBBII", msg, 2)


# ------------------------------------------------------------ image pipeline

def to_panel_image(path, portrait=True, fit="cover"):
    """Loads a picture and returns a WIDTH x HEIGHT palette image, dithered."""
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    # The badge hangs in portrait (528 x 792); the controller scans landscape.
    target = (HEIGHT, WIDTH) if portrait else (WIDTH, HEIGHT)
    if fit == "cover":
        img = ImageOps.fit(img, target, Image.LANCZOS)
    else:
        img = ImageOps.pad(img, target, Image.LANCZOS, color=(255, 255, 255))
    if portrait:
        img = img.transpose(Image.ROTATE_90)

    pal = Image.new("P", (1, 1))
    flat = [c for _, rgb, _ in PALETTE for c in rgb]
    pal.putpalette(flat + flat[:3] * (256 - len(PALETTE)))
    return img.quantize(palette=pal, dither=Image.FLOYDSTEINBERG)


def pack_native(pimg):
    """Packs a palette image into the 4 bpp native frame (high nibble first)."""
    codes = bytes(PALETTE[i][2] for i in range(len(PALETTE)))
    px = pimg.tobytes()
    assert len(px) == WIDTH * HEIGHT
    out = bytearray(FRAME_BYTES)
    for i in range(FRAME_BYTES):
        out[i] = (codes[px[2 * i]] << 4) | codes[px[2 * i + 1]]
    return bytes(out)


def preview(pimg, portrait=True):
    img = pimg.convert("RGB")
    return img.transpose(Image.ROTATE_270) if portrait else img


# ------------------------------------------------------------ BLE

async def find_device(name):
    from bleak import BleakScanner

    print("scanning...")
    devices = await BleakScanner.discover(timeout=8.0, return_adv=True)
    for dev, adv in devices.values():
        if name and (dev.name == name or dev.address.lower() == name.lower()):
            return dev
        if not name and UUID_SERVICE in [u.lower() for u in adv.service_uuids]:
            return dev
    sys.exit("no Ink Tag found" + (f" named {name}" if name else ""))


class Tag:
    def __init__(self, client):
        self.client = client
        self.events = asyncio.Queue()

    async def start(self):
        await self.client.start_notify(UUID_CONTROL, lambda _, d: self.events.put_nowait(bytes(d)))

    async def command(self, payload):
        await self.client.write_gatt_char(UUID_CONTROL, payload, response=True)

    async def expect(self, event, timeout):
        msg = await asyncio.wait_for(self.events.get(), timeout)
        if msg[0] == EVT_ERROR:
            sys.exit(f"tag error: {ERRORS.get(msg[1], msg[1])} (command {msg[2] if len(msg) > 2 else '?'})")
        if msg[0] != event:
            sys.exit(f"unexpected event 0x{msg[0]:02x}")
        return msg


async def run_ble(args, frame=None):
    from bleak import BleakClient

    dev = await find_device(args.name)
    print(f"connecting to {dev.name or dev.address}")
    async with BleakClient(dev) as client:
        tag = Tag(client)
        await tag.start()

        if args.cmd == "info":
            await tag.command(bytes([CMD_INFO]))
            m = await tag.expect(EVT_INFO, 5)
            (_, _, proto, ma, mi, pa, w, h, fmt, has, temp, maxlen) = struct.unpack_from("<BBBBBBHHBBbI", m)
            print(f"firmware {ma}.{mi}.{pa}, protocol {proto}, panel {w}x{h}, format {fmt}, "
                  f"stored image: {'yes' if has else 'no'}, "
                  f"temperature: {'unknown' if temp == -128 else f'{temp} C'}, max upload {maxlen}")
            if len(m) >= 21:   # firmware 0.3+: panel id read at boot
                pid = m[18:21]
                ok = pid not in (b"\xff\xff\xff", b"\x00\x00\x00")
                print(f"panel id: {pid.hex(' ')} ({'answering' if ok else 'not answering, check the wiring'})")
            if len(m) >= 30:   # firmware 0.6+: picture slots and updates
                count, mask, cur, uflags, maxfw = struct.unpack_from("<BBBBI", m, 22)
                used = [str(i) for i in range(count) if mask >> i & 1]
                print(f"picture slots: {count}, used: {', '.join(used) or 'none'}, "
                      f"showing: {'none' if cur == 0xFF else cur}")
                print(f"firmware slot {1 if uflags & 1 else 0}, largest update {maxfw} bytes"
                      + (", a failed update was rolled back" if uflags & 2 else ""))
            return

        if args.cmd == "slots":
            await tag.command(bytes([CMD_INFO]))
            m = await tag.expect(EVT_INFO, 5)
            if len(m) < 30:
                sys.exit("this firmware has one picture only (slots need firmware 0.6+)")
            count, cur = m[22], m[24]
            for i in range(count):
                await tag.command(bytes([CMD_SLOT, i]))
                slot, used, fmt, length, crc = parse_slot(await tag.expect(EVT_SLOT, 5))
                mark = " (showing)" if slot == cur else ""
                print(f"slot {slot}: " + (f"{length} bytes, crc32 {crc:08x}{mark}" if used else "empty"))
            return

        if args.cmd == "delete":
            await tag.command(bytes([CMD_DELETE, args.slot]))
            await tag.expect(EVT_INFO, 5)
            print(f"slot {args.slot} emptied")
            return

        if args.cmd == "update":
            fw = open(args.firmware, "rb").read()
            if fw[:1] != b"\xe9":
                sys.exit("that isn't an app image: use build/inktag.bin, not the merged flash image")
            await tag.command(struct.pack("<BI", CMD_UPDATE_BEGIN, len(fw)))
            print("erasing the update slot...")
            await tag.expect(EVT_READY, 30)
            chunk = client.mtu_size - 3
            loop = asyncio.get_running_loop()
            t0 = loop.time()
            for i, off in enumerate(range(0, len(fw), chunk)):
                await client.write_gatt_char(UUID_DATA, fw[off:off + chunk],
                                             response=args.safe or i % 32 == 31)
                if i % 200 == 0:
                    print(f"  {off * 100 // len(fw)}%", end="\r", flush=True)
            print(f"sent {len(fw)} bytes in {loop.time() - t0:.1f} s")
            await tag.command(struct.pack("<BI", CMD_UPDATE_END, zlib.crc32(fw)))
            await tag.expect(EVT_UPDATED, 30)
            print("installed; the badge restarts into the new firmware. Run 'info' to check the version.")
            return

        if args.cmd == "window":
            fill = WINDOW_STRIPES if args.fill == "stripes" else COLOR_CODES[args.fill]
            await tag.command(window_command(args.x, args.y, args.w, args.h, fill,
                                             args.code1, args.code2, not args.full_frame))
            print("refreshing the box...")
            m = await tag.expect(EVT_WINDOW, 150)
            temp, c1, c2, ms1, ms2 = parse_window(m)
            print(f"panel {temp} C, codes {c1}/{c2}")
            for n, code, ms in ((1, c1, ms1), (2, c2, ms2)):
                print(f"  pass {n}: " + ("skipped" if code == WINDOW_CODE_SKIP else f"{ms} ms (code {code})"))
            return

        if args.cmd == "temp":
            value = -128 if args.celsius == "off" else max(-20, min(60, int(args.celsius)))
            await tag.command(struct.pack("<Bb", CMD_TEMP, value))
            await tag.expect(EVT_INFO, 5)
            print("temperature override " + ("off" if value == -128 else f"{value} C"))
            return

        if args.cmd == "clear":
            await tag.command(bytes([CMD_CLEAR, COLOR_CODES[args.color]]))
        elif args.cmd == "show":
            await tag.command(bytes([CMD_SHOW] if args.slot is None else [CMD_SHOW, args.slot]))
        else:
            if args.slot is None:
                await tag.command(struct.pack("<BBI", CMD_BEGIN, FMT_NATIVE_4BPP, len(frame)))
            else:
                await tag.command(struct.pack("<BBIBB", CMD_BEGIN, FMT_NATIVE_4BPP, len(frame),
                                              args.slot, 0 if args.keep else BEGIN_SHOW))
            await tag.expect(EVT_READY, 15)
            chunk = client.mtu_size - 3
            print(f"sending {len(frame)} bytes in {chunk}-byte chunks")
            loop = asyncio.get_running_loop()
            t0 = loop.time()
            for i, off in enumerate(range(0, len(frame), chunk)):
                await client.write_gatt_char(UUID_DATA, frame[off:off + chunk],
                                             response=args.safe or i % 32 == 31)
            print(f"sent in {loop.time() - t0:.1f} s")
            await tag.command(struct.pack("<BI", CMD_END, zlib.crc32(frame)))
            await tag.expect(EVT_RECEIVED, 15)
            if args.keep:
                await tag.expect(EVT_SLOT, 5)
                print(f"stored in slot {args.slot}, not drawn")
                return
        print("refreshing panel (this takes a while)...")
        m = await tag.expect(EVT_DISPLAYED, 120)
        print(f"done, panel at {m[2] - 256 if m[2] > 127 else m[2]} C")


# ------------------------------------------------------------ CLI

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def image_args(p):
        p.add_argument("image")
        p.add_argument("--landscape", action="store_true", help="badge hung landscape")
        p.add_argument("--pad", action="store_true", help="fit whole picture with white bars instead of cropping")
        p.add_argument("--preview", help="save a PNG of the dithered result")

    def ble_args(p):
        p.add_argument("--name", help="device name or address (default: first Ink Tag found)")

    p = sub.add_parser("convert", help="convert a picture to the native frame")
    image_args(p)
    p.add_argument("--out", help="write the 209,088-byte frame here")

    p = sub.add_parser("send", help="convert and upload a picture")
    image_args(p)
    ble_args(p)
    p.add_argument("--safe", action="store_true", help="acknowledge every chunk (slower, for flaky links)")
    p.add_argument("--slot", type=int, help="picture slot to store it in (firmware 0.6+; default: the current one)")
    p.add_argument("--keep", action="store_true", help="store it without drawing it (needs --slot)")

    p = sub.add_parser("show", help="redraw a stored picture")
    p.add_argument("--slot", type=int, help="which slot (firmware 0.6+; default: the current one)")
    ble_args(p)

    ble_args(sub.add_parser("slots", help="list the picture slots (firmware 0.6+)"))

    p = sub.add_parser("delete", help="empty a picture slot (firmware 0.6+)")
    p.add_argument("slot", type=int)
    ble_args(p)

    p = sub.add_parser("update", help="wireless firmware update (firmware 0.6+)")
    p.add_argument("firmware", help="the app image, build/inktag.bin")
    p.add_argument("--safe", action="store_true", help="acknowledge every chunk (slower, for flaky links)")
    ble_args(p)

    p = sub.add_parser("clear", help="fill the panel with one color")
    p.add_argument("color", choices=list(COLOR_CODES))
    ble_args(p)

    p = sub.add_parser("temp", help="set a fixed panel temperature for the next refreshes (RAM only)")
    p.add_argument("celsius", help="-20..60, or 'off' to read the panel again")
    ble_args(p)

    p = sub.add_parser("window", help="experimental: redraw only a box (firmware 0.5+)",
                       description="Redraws one box over the stored image and reports how long "
                                   "each pass kept the panel busy. Coordinates are in the native "
                                   "792x528 frame; x and width must be multiples of 8.")
    for n in ("x", "y", "w", "h"):
        p.add_argument(n, type=int)
    p.add_argument("fill", choices=list(COLOR_CODES) + ["stripes"])
    p.add_argument("--code1", type=parse_code, default=WINDOW_CODE_NORMAL,
                   help="0xE6 waveform code for pass 1: normal (default), skip, or a number")
    p.add_argument("--code2", type=parse_code, default=WINDOW_CODE_NORMAL,
                   help="same for pass 2")
    p.add_argument("--full-frame", action="store_true",
                   help="send the whole frame and narrow the window only for the refresh")
    ble_args(p)

    ble_args(sub.add_parser("info", help="print device info"))

    args = ap.parse_args()
    if getattr(args, "keep", False) and args.slot is None:
        ap.error("--keep needs --slot")

    frame = None
    if args.cmd in ("convert", "send"):
        portrait = not args.landscape
        pimg = to_panel_image(args.image, portrait, "pad" if args.pad else "cover")
        frame = pack_native(pimg)
        if args.preview:
            preview(pimg, portrait).save(args.preview)
            print(f"preview saved to {args.preview}")
        if args.cmd == "convert":
            if args.out:
                open(args.out, "wb").write(frame)
            print(f"{len(frame)} bytes, crc32 {zlib.crc32(frame):08x}")
            return

    asyncio.run(run_ble(args, frame))


if __name__ == "__main__":
    main()
