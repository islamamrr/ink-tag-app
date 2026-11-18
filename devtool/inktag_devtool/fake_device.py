"""A simulated Ink Tag that speaks the same BLE protocol as the firmware.

It follows main/main.c: one command at a time (commands sent during a refresh
wait), BEGIN erases then notifies READY, data outside an upload is dropped,
END checks the length and CRC, then RECEIVED, a refresh, and DISPLAYED.
Timings are shortened by default; set realistic=True for the real feel.
"""

import asyncio
import random
import struct
import zlib

from . import protocol as p
from .imaging import FRAME_BYTES, HEIGHT, WIDTH

FW_VERSION = (0, 5, 0)
PANEL_ID = bytes([0x00, 0x00, 0x66])   # made up: the UC8279E's real answer is unknown
NAME = "InkTag-SIM0"
ADDRESS = "SIMULATOR"


class FakeTag:
    def __init__(self, log=lambda text: None):
        self.log = log               # the simulator's own "serial monitor" lines
        self.on_display = None       # called with the frame shown on the panel
        self.realistic = False
        self.mtu = 247
        self.sensor_temp = 22        # what the simulated panel sensor reads
        self.temp_override = p.TEMP_UNKNOWN
        self.panel_id = PANEL_ID      # what epd_identify() read at boot
        self.support_temp_cmd = True  # False behaves like firmware 0.1
        self.corrupt_next_upload = False
        self.stored = None
        self.last_temp = p.TEMP_UNKNOWN
        self._receiving = False
        self._buf = bytearray()
        self._overflow = False

    def _timing(self, fast, real):
        return real if self.realistic else fast

    def _read_temp(self):
        if self.temp_override != p.TEMP_UNKNOWN:
            self.log(f"W epd: temperature override: {self.temp_override} C")
            return self.temp_override
        t = self.sensor_temp + random.choice((-1, 0, 0, 1))
        self.log(f"I epd: temperature byte 0x{t & 0xff:02x}")
        return t

    async def _refresh(self, frame):
        self.last_temp = self._read_temp()
        secs = self._timing(3.0, 30.0 if self.last_temp >= 10 else 45.0)
        self.log(f"I epd: panel {self.last_temp} C, refreshing ({secs:.0f} s simulated)")
        await asyncio.sleep(secs)
        self.log("I epd: refresh done")
        if self.on_display:
            self.on_display(frame)

    # -------------------------------------------------- protocol

    def data(self, chunk):
        if not self._receiving:
            return
        if len(self._buf) + len(chunk) > FRAME_BYTES:
            self._overflow = True
            return
        self._buf += chunk

    async def handle(self, cmd, notify):
        def error(code):
            self.log(f"W inktag: command 0x{cmd[0]:02x} failed: {code}")
            notify(bytes([p.EVT_ERROR, code, cmd[0]]))

        op = cmd[0]
        if op == p.CMD_BEGIN:
            if len(cmd) < 6:
                return error(1)
            fmt, length = struct.unpack_from("<BI", cmd, 1)
            if fmt != p.FMT_NATIVE_4BPP:
                return error(9)
            if length != FRAME_BYTES:
                return error(2)
            self._receiving = False
            self.stored = None       # erasing loses the old image, as on the badge
            await asyncio.sleep(self._timing(0.6, 2.0))
            self._buf, self._overflow, self._receiving = bytearray(), False, True
            self.log(f"I inktag: receiving {length} bytes")
            notify(bytes([p.EVT_READY, 0]))

        elif op == p.CMD_END:
            if len(cmd) < 5:
                return error(1)
            if not self._receiving:
                return error(3)
            self._receiving = False
            if self._overflow:
                return error(4)
            if len(self._buf) != FRAME_BYTES:
                self.log(f"W store: got {len(self._buf)} of {FRAME_BYTES} bytes")
                return error(2)
            if self.corrupt_next_upload:
                self.corrupt_next_upload = False
                self._buf[random.randrange(FRAME_BYTES)] ^= 0x55
                self.log("W sim: corrupted one byte on purpose")
            crc = zlib.crc32(self._buf)
            if crc != struct.unpack_from("<I", cmd, 1)[0]:
                self.log(f"E store: CRC mismatch, computed {crc:08x}")
                return error(5)
            self.stored = bytes(self._buf)
            notify(bytes([p.EVT_RECEIVED, 0]))
            await self._refresh(self.stored)
            notify(struct.pack("<BBb", p.EVT_DISPLAYED, 0, self.last_temp))

        elif op == p.CMD_SHOW:
            if self._receiving:
                return error(3)
            if self.stored is None:
                return error(8)
            await self._refresh(self.stored)
            notify(struct.pack("<BBb", p.EVT_DISPLAYED, 0, self.last_temp))

        elif op == p.CMD_CLEAR:
            if self._receiving:
                return error(3)
            color = cmd[1] if len(cmd) > 1 else 1
            await self._refresh(bytes([(color << 4) | color]) * FRAME_BYTES)
            notify(struct.pack("<BBb", p.EVT_DISPLAYED, 0, self.last_temp))

        elif op == p.CMD_WINDOW and self.support_temp_cmd:
            if self._receiving:
                return error(3)
            if len(cmd) < 13:
                return error(1)
            x, y, w, h, fill, c1, c2, _ = struct.unpack_from("<HHHHBBBB", cmd, 1)
            if (w == 0 or h == 0 or x % 8 or w % 8 or x + w > WIDTH or y + h > HEIGHT
                    or c1 == c2 == p.WINDOW_CODE_SKIP):
                return error(1)
            frame = bytearray(self.stored or bytes([0x11]) * FRAME_BYTES)
            colors = (0, 1, 2, 3, 5, 6)
            for row in range(y, y + h):
                for px in range(x, x + w, 2):
                    a, b = ((colors[(q - x) * 6 // w] if fill == p.WINDOW_STRIPES else fill & 0x0F)
                            for q in (px, px + 1))
                    frame[(row * WIDTH + px) // 2] = (a << 4) | b
            self.last_temp = self._read_temp()
            per_pass = self._timing(1.5, 15.0)
            ms = [0 if c == p.WINDOW_CODE_SKIP else int(per_pass * 1000) for c in (c1, c2)]
            self.log(f"W epd: window test: box {x},{y} {w}x{h}")
            await asyncio.sleep(sum(ms) / 1000)
            if self.on_display:
                self.on_display(bytes(frame))
            notify(struct.pack("<BBbBBII", p.EVT_WINDOW, 0, self.last_temp,
                               c1 or 32, c2 or 37, *ms))

        elif op == p.CMD_INFO:
            notify(self._info())

        elif op == p.CMD_ABORT:
            self._receiving = False
            self.log("I inktag: upload aborted")

        elif op == p.CMD_TEMP and self.support_temp_cmd:
            if len(cmd) < 2:
                return error(1)
            self.temp_override = struct.unpack_from("<b", cmd, 1)[0]
            self.log("I epd: temperature override " + (
                "off" if self.temp_override == p.TEMP_UNKNOWN else f"{self.temp_override} C"))
            notify(self._info())

        else:
            error(1)

    def _info(self):
        data = struct.pack(p.INFO_FORMAT, p.EVT_INFO, 0, 1, *FW_VERSION, WIDTH, HEIGHT,
                           p.FMT_NATIVE_4BPP, self.stored is not None, self.last_temp, FRAME_BYTES)
        if self.support_temp_cmd:
            data += struct.pack("<b", self.temp_override) + self.panel_id
        else:
            data = data[:2] + bytes([1, 0, 1, 0]) + data[6:]   # report fw 0.1.0
        return data


class FakeLink(p.Link):
    """In-process link to a FakeTag. Commands are queued and run one at a
    time, like the firmware's main loop."""

    def __init__(self, tag: FakeTag):
        self.tag = tag
        self.mtu = tag.mtu
        self._queue = asyncio.Queue()
        self._worker = None
        self._writes = 0

    async def connect(self):
        await asyncio.sleep(0.4)
        self._worker = asyncio.create_task(self._run())
        self.tag.log(f"I ble: connected, MTU {self.mtu}")

    async def _run(self):
        while True:
            cmd = await self._queue.get()
            await self.tag.handle(cmd, self._notify)

    def _notify(self, data):
        if self.on_notify:
            self.on_notify(data)

    async def write_control(self, data):
        await asyncio.sleep(0.01)
        self._queue.put_nowait(bytes(data))

    async def write_data(self, data, response):
        self._writes += 1
        # About 45 KiB/s fast, 15 KiB/s realistic (a guess at what a PC gets).
        if response or self._writes % 4 == 0:
            await asyncio.sleep(self.tag._timing(0.02, 0.06))
        self.tag.data(bytes(data))

    async def close(self):
        if self._worker:
            self._worker.cancel()
            self._worker = None
        self.tag._receiving = False
        self.tag.log("I ble: disconnected")
