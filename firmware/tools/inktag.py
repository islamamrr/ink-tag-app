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
    python inktag.py stop 40 200 64 64 black --ms 3000          # early-stop test (firmware 0.6.1+)
    python inktag.py probe zero                # custom-waveform probe (firmware 0.6+), see PROBE.md
    python inktag.py probe pulse 20
    python inktag.py probe push 20 --dir a
"""

import argparse
import asyncio
import json
import os
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
ESP_CHIPS = {5: "ESP32-C3", 13: "ESP32-C6"}   # firmware image byte 12, INFO byte 30 (0.6.1+)
CMD_LUT = 0x10
CMD_STOP = 0x11
EVT_STOP = 0x8A
EVT_READY, EVT_RECEIVED, EVT_DISPLAYED, EVT_INFO, EVT_ERROR = 0x81, 0x82, 0x83, 0x84, 0x8F
EVT_WINDOW = 0x86
EVT_UPDATED, EVT_SLOT = 0x87, 0x88
EVT_LUT = 0x89

# Window test (firmware 0.5+): see docs/PROTOCOL.md
WINDOW_STRIPES = 0x10             # fill the box with six color stripes
WINDOW_CODE_NORMAL, WINDOW_CODE_SKIP = 0x00, 0xFF
WINDOW_BOX_DATA = 0x01            # flags: send only the box's pixels
WINDOW_CUSTOM_LUT = 0x02          # flags (fw 0.7+): load the probe registers first
WINDOW_DRF = 0x08                 # flags (fw 0.7+): PON + DRF + POF instead of AUTO


def window_command(x, y, w, h, fill, code1=WINDOW_CODE_NORMAL, code2=WINDOW_CODE_NORMAL, box_data=True,
                   extra_flags=0):
    if x % 8 or w % 8 or w <= 0 or h <= 0 or x + w > WIDTH or y + h > HEIGHT:
        raise ValueError(f"box must fit in {WIDTH}x{HEIGHT}, with x and width multiples of 8")
    return struct.pack("<BHHHHBBBB", CMD_WINDOW, x, y, w, h, fill, code1, code2,
                       (WINDOW_BOX_DATA if box_data else 0) | extra_flags)


# ------------------------------------------------------------ custom-waveform probe (fw 0.7+)
#
# The LUT layout is the one the B/W UC8279 uses (FreeInk's recovered Xteink X3
# tables): each register holds 7-byte groups [01, p0, p1, p2, p3, 01, 01], and
# each phase byte is (voltage level << 6) | frames (0..63). Level 0 is ground
# (no drive); levels 1 and 2 drive the ink in opposite directions. Nobody has
# confirmed this layout on the colour UC8279E: that is what step 1 tests.
#
# Register 0x20 is VCOM, the electrode shared by every pixel. It is always held
# at level 0, so pixels outside the box never see a voltage. 0x21-0x24 are the
# four pixel levels; all four get the same waveform, so every pixel in the box
# is driven alike whatever the picture data says.

PROBE_BOX = (752, 488, 32, 32)    # a 32x32 corner, clear of the middle seam (x = 396)
PROBE_MAX_AREA = 128 * 128        # the firmware refuses bigger boxes
LEDGER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "probe_ledger.json")


def lut_phases(level, frames):
    """Up to 4 phase bytes driving `level` for `frames` frames in total."""
    if not 0 < frames <= 4 * 63:
        raise ValueError("frames must be 1..252")
    out = []
    while frames:
        n = min(63, frames)
        out.append((level << 6) | n)
        frames -= n
    return out


def lut_group(phases):
    if len(phases) > 4:
        raise ValueError("at most 4 phases per group")
    return [0x01] + phases + [0] * (4 - len(phases)) + [0x01, 0x01]


def lut_register(groups, length):
    data = [b for g in groups for b in lut_group(g)]
    if len(data) > length:
        raise ValueError("waveform longer than the register")
    return bytes(data + [0] * (length - len(data)))


def probe_waveform(kind, frames, direction):
    """-> (list of groups for the pixel rows, net charge in frames: + for a, - for b)."""
    if kind == "zero":
        return [lut_phases(0, 10)], 0
    if kind == "pulse":
        a, b = lut_phases(1, frames), lut_phases(2, frames)
        # One group when it fits, as in the recovered B/W tables (e.g. 5A 9A).
        return ([a + b] if len(a + b) <= 4 else [a, b]), 0
    level = 1 if direction == "a" else 2
    return [lut_phases(level, frames)], (frames if direction == "a" else -frames)


def probe_registers(kind, frames, direction, length):
    groups, net = probe_waveform(kind, frames, direction)
    # VCOM mirrors the pixel rows' timing at level 0 (ground) throughout.
    vcom = [[0x00 | (p & 0x3F) for p in g] for g in groups]
    regs = [(0x20, lut_register(vcom, length))]
    regs += [(r, lut_register(groups, length)) for r in (0x21, 0x22, 0x23, 0x24)]
    return regs, net


def ledger_load():
    try:
        with open(LEDGER) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def ledger_add(box, kind, frames, direction, net, ms):
    data = ledger_load()
    key = "{},{},{},{}".format(*box)
    entry = data.setdefault(key, {"net": 0, "runs": []})
    entry["net"] += net
    entry["runs"].append({"kind": kind, "frames": frames, "dir": direction, "net": net, "ms": ms})
    with open(LEDGER, "w") as f:
        json.dump(data, f, indent=1)
    return entry["net"]


def parse_hex_bytes(text):
    return bytes(int(t, 16) for t in text.replace(",", " ").split())


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
            if len(m) >= 31:   # firmware 0.6.1+: chip id
                print(f"chip: {ESP_CHIPS.get(m[30], f'id {m[30]}')}")
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
            await tag.command(bytes([CMD_INFO]))
            m = await tag.expect(EVT_INFO, 5)
            chip = m[30] if len(m) >= 31 else 5   # 0.6.0 badges are all ESP32-C3
            if fw[12] != chip:
                sys.exit(f"that firmware is for {ESP_CHIPS.get(fw[12], fw[12])}, this badge is {ESP_CHIPS.get(chip, chip)}")
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

        if args.cmd == "stop":
            if args.x % 8 or args.w % 8 or args.w * args.h > 200 * 200:
                sys.exit("x and width must be multiples of 8, box at most 200x200")
            await tag.command(struct.pack("<BHHHHBHBB", CMD_STOP, args.x, args.y, args.w, args.h,
                                          COLOR_CODES[args.fill], args.ms,
                                          1 if args.method == "reset" else 0,
                                          0 if args.no_pass2 else 1))
            print(f"pass 1 of the box, stopped after {args.ms} ms by {args.method}...")
            m = await tag.expect(EVT_STOP, 150)
            stopped, p2, early = struct.unpack_from("<IIB", m, 2)
            print(f"  stopped after {stopped} ms" + ("  (the refresh had already ended)" if early else ""))
            print("  pass 2: " + ("not run" if args.no_pass2 else f"{p2} ms"))
            return

        if args.cmd == "probe":
            if args.kind == "ledger":
                for key, e in ledger_load().items():
                    print(f"box {key}: net {e['net']:+d} frames over {len(e['runs'])} runs")
                return
            box = tuple(args.box)
            if box[2] * box[3] > PROBE_MAX_AREA:
                sys.exit(f"box too big for the probe (max {PROBE_MAX_AREA} pixels)")
            regs, net = probe_registers(args.kind, args.frames, args.dir, args.lut_len)
            if args.psr:
                regs.append((0x00, parse_hex_bytes(args.psr)))
            if args.cdi:
                regs.append((0x50, parse_hex_bytes(args.cdi)))
            await tag.command(bytes([CMD_LUT, 0xFF]))
            await tag.expect(EVT_LUT, 5)
            for reg, data in regs:
                print(f"  0x{reg:02x}: {data.hex(' ')}")
                await tag.command(bytes([CMD_LUT, reg]) + data)
                await tag.expect(EVT_LUT, 5)
            fill = COLOR_CODES[args.fill]
            flags = WINDOW_CUSTOM_LUT | (WINDOW_DRF if args.drf else 0)
            await tag.command(window_command(*box, fill, WINDOW_CODE_NORMAL, WINDOW_CODE_SKIP,
                                             True, flags))
            print(f"probe '{args.kind}' on box {box}...")
            m = await tag.expect(EVT_WINDOW, 150)
            _, _, _, ms, _ = parse_window(m)
            print(f"  busy for {ms} ms" + ("  (BUSY never went low)" if ms == 0 else ""))
            total = ledger_add(box, args.kind, args.frames, args.dir, net, ms)
            print(f"  net charge on this box: {total:+d} frames")
            if total:
                other = "b" if total > 0 else "a"
                print(f"  -> balance it before moving on: probe push {abs(total)} --dir {other}")
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

    p = sub.add_parser("stop", help="experimental: stop a box refresh early (firmware 0.7+)",
                       description="Starts pass 1 of a box refresh, stops it after --ms, then runs "
                                   "the short pass 2 (unless --no-pass2). See docs/EARLYSTOP.md.")
    for n in ("x", "y", "w", "h"):
        p.add_argument(n, type=int)
    p.add_argument("fill", choices=list(COLOR_CODES))
    p.add_argument("--ms", type=int, default=3000, help="stop after this many ms (100..30000)")
    p.add_argument("--method", choices=["poweroff", "reset"], default="poweroff")
    p.add_argument("--no-pass2", action="store_true", help="leave the box as the cut-short pass left it")
    ble_args(p)

    p = sub.add_parser("probe", help="experimental: custom waveform on a tiny box (firmware 0.7+)",
                       description="Loads a hand-made waveform into the controller's LUT registers "
                                   "and runs it on one small box. See PROBE.md before using it.")
    p.add_argument("kind", choices=["zero", "pulse", "push", "ledger"],
                   help="zero: no drive at all; pulse: +N then -N frames (balanced); "
                        "push: N frames one way (unbalanced, logged); ledger: show net charge per box")
    p.add_argument("frames", type=int, nargs="?", default=10, help="frames per direction (1..252)")
    p.add_argument("--dir", choices=["a", "b"], default="a", help="push direction (level 1 or 2)")
    p.add_argument("--box", type=int, nargs=4, default=list(PROBE_BOX), metavar=("X", "Y", "W", "H"))
    p.add_argument("--fill", choices=list(COLOR_CODES), default="black",
                   help="picture data for the box (only matters if the LUT is ignored)")
    p.add_argument("--drf", action="store_true", help="refresh with PON + DRF instead of AUTO")
    p.add_argument("--psr", help="PSR override, hex bytes, e.g. '0B 2A'")
    p.add_argument("--cdi", help="CDI override, one hex byte")
    p.add_argument("--lut-len", type=int, default=42, choices=[42, 49], help="bytes per LUT register")
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
