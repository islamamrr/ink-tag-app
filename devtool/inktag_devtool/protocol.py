"""Ink Tag BLE protocol client, independent of the transport.

The same TagClient drives the real badge (ble_link.BleLink) and the built-in
simulator (fake_device.FakeLink), so everything the GUI does against the
simulator exercises the code that talks to real hardware.
"""

import asyncio
import struct
import zlib
from abc import ABC, abstractmethod

from .imaging import inktag

FMT_NATIVE_4BPP = inktag.FMT_NATIVE_4BPP
CMD_BEGIN, CMD_END, CMD_SHOW = inktag.CMD_BEGIN, inktag.CMD_END, inktag.CMD_SHOW
CMD_CLEAR, CMD_INFO, CMD_ABORT = inktag.CMD_CLEAR, inktag.CMD_INFO, inktag.CMD_ABORT
CMD_TEMP = getattr(inktag, "CMD_TEMP", 0x07)
CMD_WINDOW, EVT_WINDOW = inktag.CMD_WINDOW, inktag.EVT_WINDOW
WINDOW_STRIPES, WINDOW_CODE_NORMAL, WINDOW_CODE_SKIP = (
    inktag.WINDOW_STRIPES, inktag.WINDOW_CODE_NORMAL, inktag.WINDOW_CODE_SKIP)
EVT_READY, EVT_RECEIVED, EVT_DISPLAYED = inktag.EVT_READY, inktag.EVT_RECEIVED, inktag.EVT_DISPLAYED
EVT_INFO, EVT_ERROR = inktag.EVT_INFO, inktag.EVT_ERROR
ERRORS = inktag.ERRORS
ERR_BAD_COMMAND = 1
TEMP_UNKNOWN = -128

COMMAND_NAMES = {CMD_BEGIN: "BEGIN", CMD_END: "END", CMD_SHOW: "SHOW", CMD_CLEAR: "CLEAR",
                 CMD_INFO: "INFO", CMD_ABORT: "ABORT", CMD_TEMP: "TEMP", CMD_WINDOW: "WINDOW"}
EVENT_NAMES = {EVT_READY: "READY", EVT_RECEIVED: "RECEIVED", EVT_DISPLAYED: "DISPLAYED",
               EVT_INFO: "INFO", EVT_WINDOW: "WINDOW", EVT_ERROR: "ERROR"}
COLOR_NAMES = {code: name for name, _, code in inktag.PALETTE}

INFO_FORMAT = "<BBBBBBHHBBbI"            # protocol v1
INFO_SIZE = struct.calcsize(INFO_FORMAT)  # 18; firmware 0.2 appends i8 temperature override,
                                          # firmware 0.3 then 3 bytes of panel id


class TagError(Exception):
    def __init__(self, code, command):
        self.code, self.command = code, command
        super().__init__(f"{ERRORS.get(code, f'error {code}')} "
                         f"(command {COMMAND_NAMES.get(command, command)})")


class Link(ABC):
    """A connection to one badge. Set on_notify / on_disconnect before use."""

    mtu = 23
    on_notify = None       # called with bytes for each Control notification
    on_disconnect = None   # called with no arguments when the link drops

    @abstractmethod
    async def write_control(self, data: bytes): ...

    @abstractmethod
    async def write_data(self, data: bytes, response: bool): ...

    @abstractmethod
    async def close(self): ...


def temp_str(t):
    return "unknown" if t == TEMP_UNKNOWN else f"{t} °C"


def describe_command(data):
    name = COMMAND_NAMES.get(data[0], f"0x{data[0]:02x}")
    if data[0] == CMD_BEGIN and len(data) >= 6:
        fmt, length = struct.unpack_from("<BI", data, 1)
        return f"{name} format {fmt}, {length} bytes"
    if data[0] == CMD_END and len(data) >= 5:
        return f"{name} crc32 {struct.unpack_from('<I', data, 1)[0]:08x}"
    if data[0] == CMD_CLEAR and len(data) >= 2:
        return f"{name} {COLOR_NAMES.get(data[1], data[1])}"
    if data[0] == CMD_TEMP and len(data) >= 2:
        t = struct.unpack_from("<b", data, 1)[0]
        return f"{name} override {'off' if t == TEMP_UNKNOWN else f'{t} °C'}"
    if data[0] == CMD_WINDOW and len(data) >= 13:
        x, y, w, h, fill, c1, c2, flags = struct.unpack_from("<HHHHBBBB", data, 1)
        fill = "stripes" if fill == WINDOW_STRIPES else COLOR_NAMES.get(fill, fill)
        return (f"{name} box {x},{y} {w}x{h} {fill}, codes {code_str(c1)}/{code_str(c2)}, "
                f"{'box' if flags & 1 else 'full-frame'} data")
    return name


def code_str(code):
    return {WINDOW_CODE_NORMAL: "normal", WINDOW_CODE_SKIP: "skip"}.get(code, str(code))


def window_result_str(result):
    temp, c1, c2, ms1, ms2 = result
    passes = [f"pass {n} {'skipped' if c == WINDOW_CODE_SKIP else f'{ms / 1000:.1f} s (code {c})'}"
              for n, c, ms in ((1, c1, ms1), (2, c2, ms2))]
    return f"{', '.join(passes)}, panel {temp_str(temp)}"


def describe_event(data):
    if len(data) < 2:
        return f"short notification {data.hex(' ')}"
    name = EVENT_NAMES.get(data[0], f"0x{data[0]:02x}")
    if data[0] == EVT_ERROR:
        cmd = COMMAND_NAMES.get(data[2], data[2]) if len(data) > 2 else "?"
        return f"{name} {ERRORS.get(data[1], data[1])} (command {cmd})"
    if data[0] == EVT_DISPLAYED and len(data) >= 3:
        return f"{name} panel {temp_str(struct.unpack_from('<b', data, 2)[0])}"
    if data[0] == EVT_WINDOW and len(data) >= 13:
        return f"{name} {window_result_str(inktag.parse_window(data))}"
    if data[0] == EVT_INFO:
        try:
            i = parse_info(data)
        except struct.error:
            return f"{name} (malformed) {data.hex(' ')}"
        return (f"{name} fw {i['firmware']}, {i['width']}x{i['height']}, "
                f"stored image {'yes' if i['has_image'] else 'no'}, temp {temp_str(i['temperature'])}"
                + ("" if i["temp_override"] is None else
                   f", override {'off' if i['temp_override'] == TEMP_UNKNOWN else temp_str(i['temp_override'])}")
                + ("" if i["panel_id"] is None else f", panel id {i['panel_id'].hex(' ')}"))
    return name


def parse_info(data):
    (_, _, proto, ma, mi, pa, w, h, fmt, has, temp, maxlen) = struct.unpack_from(INFO_FORMAT, data)
    override = struct.unpack_from("<b", data, INFO_SIZE)[0] if len(data) > INFO_SIZE else None
    panel_id = bytes(data[INFO_SIZE + 1:INFO_SIZE + 4]) if len(data) >= INFO_SIZE + 4 else None
    return dict(protocol=proto, firmware=f"{ma}.{mi}.{pa}", width=w, height=h, format=fmt,
                has_image=bool(has), temperature=temp, max_length=maxlen,
                temp_override=override,   # None: firmware can't report or set it
                panel_id=panel_id)        # None: firmware older than 0.3


def panel_answering(panel_id):
    """False when the panel id reads all FF or all 00 (no answer: wiring), None if unknown."""
    if panel_id is None:
        return None
    return panel_id not in (b"\xff\xff\xff", b"\x00\x00\x00")


class TagClient:
    """High-level commands. log(kind, text) gets one line per message;
    kind is 'tx', 'rx', 'info' or 'error'."""

    def __init__(self, link: Link, log=lambda kind, text: None):
        self.link = link
        self.log = log
        self.events = asyncio.Queue()
        link.on_notify = self._on_notify

    def _on_notify(self, data):
        data = bytes(data)
        self.log("rx", describe_event(data))
        self.events.put_nowait(data)

    async def command(self, payload):
        self.log("tx", describe_command(payload))
        await self.link.write_control(payload)

    async def expect(self, event, timeout):
        while True:
            msg = await asyncio.wait_for(self.events.get(), timeout)
            if msg[0] == EVT_ERROR:
                raise TagError(msg[1], msg[2] if len(msg) > 2 else None)
            if msg[0] == event:
                return msg
            self.log("info", f"ignoring {EVENT_NAMES.get(msg[0], hex(msg[0]))} while waiting "
                             f"for {EVENT_NAMES.get(event, hex(event))}")

    def _flush(self):
        while not self.events.empty():
            self.events.get_nowait()

    # -------------------------------------------------- commands

    async def info(self):
        self._flush()
        await self.command(bytes([CMD_INFO]))
        return parse_info(await self.expect(EVT_INFO, 5))

    async def show(self):
        self._flush()
        await self.command(bytes([CMD_SHOW]))
        return await self._displayed()

    async def clear(self, color_code):
        self._flush()
        await self.command(bytes([CMD_CLEAR, color_code]))
        return await self._displayed()

    async def abort(self):
        await self.command(bytes([CMD_ABORT]))

    async def set_temp_override(self, celsius):
        """celsius=None goes back to reading the panel. Returns the new INFO."""
        self._flush()
        value = TEMP_UNKNOWN if celsius is None else max(-20, min(60, int(celsius)))
        await self.command(struct.pack("<Bb", CMD_TEMP, value))
        return parse_info(await self.expect(EVT_INFO, 5))

    async def window_test(self, x, y, w, h, fill, code1=WINDOW_CODE_NORMAL,
                          code2=WINDOW_CODE_NORMAL, box_data=True):
        """Experimental (firmware 0.5+): redraws one box. Returns
        (temperature, code1, code2, pass 1 ms, pass 2 ms)."""
        self._flush()
        await self.command(inktag.window_command(x, y, w, h, fill, code1, code2, box_data))
        self.log("info", "refreshing the box...")
        return inktag.parse_window(await self.expect(EVT_WINDOW, 150))

    async def _displayed(self, timeout=150):
        self.log("info", "panel refreshing (a six-color refresh takes a while)...")
        m = await self.expect(EVT_DISPLAYED, timeout)
        return struct.unpack_from("<b", m, 2)[0] if len(m) > 2 else TEMP_UNKNOWN

    async def upload(self, frame, progress=lambda sent, total: None, safe=False, ack_every=32):
        """Sends a native frame and waits for the refresh. Returns
        (seconds spent sending, panel temperature)."""
        self._flush()
        await self.command(struct.pack("<BBI", CMD_BEGIN, FMT_NATIVE_4BPP, len(frame)))
        await self.expect(EVT_READY, 15)
        chunk = max(20, self.link.mtu - 3)
        self.log("info", f"sending {len(frame)} bytes in {chunk}-byte chunks (MTU {self.link.mtu})")
        loop = asyncio.get_running_loop()
        t0 = loop.time()
        try:
            for i, off in enumerate(range(0, len(frame), chunk)):
                await self.link.write_data(frame[off:off + chunk],
                                           response=safe or i % ack_every == ack_every - 1)
                progress(min(off + chunk, len(frame)), len(frame))
        except asyncio.CancelledError:
            try:
                await asyncio.shield(self.abort())
            finally:
                raise
        elapsed = loop.time() - t0
        self.log("info", f"sent in {elapsed:.1f} s ({len(frame) / max(elapsed, 1e-6) / 1024:.1f} KiB/s)")
        await self.command(struct.pack("<BI", CMD_END, zlib.crc32(frame)))
        await self.expect(EVT_RECEIVED, 15)
        return elapsed, await self._displayed()
