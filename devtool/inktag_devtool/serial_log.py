"""Optional USB serial monitor, so the badge's ESP-IDF log lands in the same
log pane as the BLE traffic. Needs pyserial."""

import re
import threading

try:
    import serial
    from serial.tools import list_ports
except ImportError:          # the tool works without it
    serial = None

ANSI = re.compile(r"\x1b\[[0-9;]*m")


def available():
    return serial is not None


def ports():
    if serial is None:
        return []
    return [(p.device, f"{p.device}  {p.description}") for p in list_ports.comports()]


class SerialMonitor:
    def __init__(self, port, on_line, on_closed, baud=115200):
        self.port = serial.Serial(None, baud, timeout=0.2)
        self.port.port = port
        # Keep DTR/RTS low so opening the port doesn't reset the ESP32.
        self.port.dtr = self.port.rts = False
        self.port.open()
        self.on_line, self.on_closed = on_line, on_closed
        self._stop = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        buf = b""
        try:
            while not self._stop.is_set():
                buf += self.port.read(512)
                *lines, buf = buf.split(b"\n")
                for line in lines:
                    text = ANSI.sub("", line.decode("utf-8", "replace")).rstrip("\r")
                    if text:
                        self.on_line(text)
        except Exception as e:  # unplugged, port grabbed by another program, ...
            self.on_line(f"serial port closed: {e}")
        finally:
            self.port.close()
            self.on_closed()

    def close(self):
        self._stop.set()
