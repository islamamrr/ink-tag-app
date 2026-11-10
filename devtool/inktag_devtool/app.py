"""Ink Tag Dev Tool: a desktop window for working with the badge.

The window runs on the Qt thread; all Bluetooth and protocol work runs on an
asyncio loop in a background thread (which is also what bleak needs on
Windows, where Qt's thread is a COM STA). Results come back through
AsyncRunner.ui().
"""

import asyncio
import html
import os
import sys
import threading
import time
from concurrent.futures import CancelledError

from PySide6.QtCore import QObject, QSettings, Qt, QTimer, Signal
from PySide6.QtGui import QAction, QColor, QFont, QImage, QPixmap
from PySide6.QtWidgets import (
    QApplication, QCheckBox, QComboBox, QFileDialog, QFormLayout, QGridLayout, QGroupBox,
    QHBoxLayout, QLabel, QMainWindow, QMessageBox, QPlainTextEdit, QProgressBar, QPushButton,
    QScrollArea, QSizePolicy, QSlider, QSpinBox, QSplitter, QTabWidget, QVBoxLayout, QWidget,
)

from . import imaging, protocol, serial_log
from .fake_device import ADDRESS as FAKE_ADDRESS, NAME as FAKE_NAME, FakeLink, FakeTag

APP_NAME = "Ink Tag Dev Tool"
LOG_COLORS = {"tx": "#2f6fdd", "rx": "#1b8a4a", "dev": "#8a8a8a", "error": "#d03030",
              "info": None, "ok": "#1b8a4a"}
LOG_PREFIX = {"tx": "→ ", "rx": "← ", "dev": "▏", "error": "✖ ", "info": "", "ok": "✔ "}
SWATCHES = {"black": "#000", "white": "#fff", "yellow": "#ff0", "red": "#f00",
            "blue": "#00f", "green": "#0f0"}


class AsyncRunner(QObject):
    _call = Signal(object)

    def __init__(self):
        super().__init__()
        self._call.connect(lambda fn: fn(), Qt.QueuedConnection)
        self.loop = asyncio.new_event_loop()
        threading.Thread(target=self.loop.run_forever, daemon=True, name="asyncio").start()

    def ui(self, fn, *args):
        """Runs fn(*args) on the Qt thread; safe to call from any thread."""
        self._call.emit(lambda: fn(*args))

    def submit(self, coro, done=None, failed=None):
        fut = asyncio.run_coroutine_threadsafe(coro, self.loop)

        def finished(f):
            try:
                result = f.result()
            except CancelledError:
                self.ui(failed or (lambda e: None), CancelledError("cancelled"))
            except BaseException as e:  # noqa: BLE001 - shown to the user
                self.ui(failed or (lambda e: None), e)
            else:
                if done:
                    self.ui(done, result)
        fut.add_done_callback(finished)
        return fut


def to_pixmap(img):
    img = img.convert("RGB")
    qimg = QImage(img.tobytes(), img.width, img.height, 3 * img.width, QImage.Format_RGB888)
    return QPixmap.fromImage(qimg.copy())


class PictureView(QLabel):
    """Shows a picture scaled to fit, without blurring the dither pattern."""

    def __init__(self, placeholder, smooth=False):
        super().__init__(placeholder)
        self.setAlignment(Qt.AlignCenter)
        self.setMinimumSize(200, 200)
        self.setSizePolicy(QSizePolicy.Ignored, QSizePolicy.Ignored)
        self.setStyleSheet("QLabel { background: palette(mid); color: palette(bright-text); }")
        self._pix = None
        self._smooth = smooth

    def set_image(self, img):
        self._pix = to_pixmap(img) if img is not None else None
        self._rescale()

    def resizeEvent(self, e):
        super().resizeEvent(e)
        self._rescale()

    def _rescale(self):
        if self._pix is None:
            return
        mode = Qt.SmoothTransformation if self._smooth else Qt.FastTransformation
        self.setPixmap(self._pix.scaled(self.size(), Qt.KeepAspectRatio, mode))


def slider(lo, hi, value):
    s = QSlider(Qt.Horizontal)
    s.setRange(lo, hi)
    s.setValue(value)
    return s


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle(APP_NAME)
        self.resize(1280, 860)
        self.settings = QSettings("InkTag", "DevTool")
        self.runner = AsyncRunner()

        self.client = None
        self.link = None
        self.connected_name = None
        self.busy = None            # future of the running action, if any
        self.source = None          # loaded picture (PIL, RGB)
        self.source_path = None
        self.prepared = None        # palette image in panel order
        self.sent_frame = None
        self._uploading = False

        self.fake = FakeTag(log=lambda t: self.runner.ui(self.log, "dev", t))
        self.fake.on_display = lambda f: self.runner.ui(self._panel_displayed, f)
        self.serial = None

        self._build_ui()
        self._update_controls()
        self.log("info", f"{APP_NAME} ready. Pick 'Simulator' to try everything without hardware, "
                         "or press Scan to look for a real badge.")
        self._preview_timer = QTimer(self, singleShot=True, interval=120, timeout=self._render)

    # ================================================== UI

    def _build_ui(self):
        self.setAcceptDrops(True)

        # ---- connection bar
        self.device_box = QComboBox()
        self.device_box.setMinimumWidth(280)
        self.device_box.addItem(f"Simulator ({FAKE_NAME})", ("fake", FAKE_ADDRESS))
        self.show_all = QCheckBox("All BLE devices")
        self.scan_btn = QPushButton("Scan")
        self.scan_btn.clicked.connect(self.scan)
        self.connect_btn = QPushButton("Connect")
        self.connect_btn.clicked.connect(self.toggle_connection)
        self.status_dot = QLabel()
        self.status_text = QLabel()
        bar = QHBoxLayout()
        for w in (QLabel("Device:"), self.device_box, self.show_all, self.scan_btn,
                  self.connect_btn, self.status_dot, self.status_text):
            bar.addWidget(w)
        bar.addStretch()

        # ---- picture (left)
        open_btn = QPushButton("Open picture…")
        open_btn.clicked.connect(self.open_picture)
        self.fit_box = QComboBox()
        self.fit_box.addItem("Crop to fill", "cover")
        self.fit_box.addItem("Fit with white bars", "pad")
        self.orient_box = QComboBox()
        self.orient_box.addItem("Portrait (528 × 792)", True)
        self.orient_box.addItem("Landscape (792 × 528)", False)
        self.dither = QCheckBox("Dither (Floyd–Steinberg)")
        self.dither.setChecked(True)
        self.bright = slider(50, 200, 100)
        self.contrast = slider(50, 200, 100)
        self.sat = slider(0, 300, 100)
        reset = QPushButton("Reset tone")
        reset.clicked.connect(lambda: [s.setValue(100) for s in (self.bright, self.contrast, self.sat)])
        for w in (self.fit_box, self.orient_box):
            w.currentIndexChanged.connect(self._schedule_render)
        self.dither.toggled.connect(self._schedule_render)
        for s in (self.bright, self.contrast, self.sat):
            s.valueChanged.connect(self._schedule_render)

        opts = QGridLayout()
        opts.addWidget(open_btn, 0, 0)
        opts.addWidget(self.fit_box, 0, 1)
        opts.addWidget(self.orient_box, 0, 2)
        opts.addWidget(self.dither, 0, 3)
        for col, (name, s) in enumerate((("Brightness", self.bright), ("Contrast", self.contrast),
                                         ("Saturation", self.sat))):
            box = QVBoxLayout()
            box.addWidget(QLabel(name))
            box.addWidget(s)
            opts.addLayout(box, 1, col)
        opts.addWidget(reset, 1, 3)

        self.view_original = PictureView("Open a picture, or drop one here", smooth=True)
        self.view_dithered = PictureView("The dithered six-color result shows here")
        self.view_panel = PictureView("What the badge shows appears here\nafter a refresh")
        self.tabs = QTabWidget()
        self.tabs.addTab(self.view_dithered, "Dithered (what gets sent)")
        self.tabs.addTab(self.view_original, "Original")
        self.tabs.addTab(self.view_panel, "Badge")
        self.picture_stats = QLabel()
        self.picture_stats.setWordWrap(True)
        save_png = QPushButton("Save preview PNG…")
        save_png.clicked.connect(self.save_preview)
        save_bin = QPushButton("Save frame .bin…")
        save_bin.clicked.connect(self.save_bin)
        self.save_btns = (save_png, save_bin)
        saves = QHBoxLayout()
        saves.addWidget(self.picture_stats, 1)
        saves.addWidget(save_png)
        saves.addWidget(save_bin)

        pic_box = QGroupBox("Picture")
        pv = QVBoxLayout(pic_box)
        pv.addLayout(opts)
        pv.addWidget(self.tabs, 1)
        pv.addLayout(saves)

        # ---- device (right)
        self.info_labels = {k: QLabel("–") for k in
                            ("Firmware", "Panel", "Stored image", "Temperature", "MTU")}
        info_form = QFormLayout()
        for k, lab in self.info_labels.items():
            lab.setTextInteractionFlags(Qt.TextSelectableByMouse)
            info_form.addRow(k + ":", lab)
        self.info_btn = QPushButton("Get info")
        self.info_btn.clicked.connect(self.get_info)
        self.show_btn = QPushButton("Redraw stored image")
        self.show_btn.clicked.connect(self.redraw)
        self.clear_color = QComboBox()
        for name, _, code in imaging.PALETTE:
            pm = QPixmap(14, 14)
            pm.fill(QColor(SWATCHES[name]))
            self.clear_color.addItem(pm, name, code)
        self.clear_color.setCurrentIndex(1)
        self.clear_btn = QPushButton("Fill panel")
        self.clear_btn.clicked.connect(self.clear_panel)
        dev_box = QGroupBox("Badge")
        dv = QVBoxLayout(dev_box)
        dv.addLayout(info_form)
        row = QHBoxLayout()
        row.addWidget(self.info_btn)
        row.addWidget(self.show_btn)
        dv.addLayout(row)
        row = QHBoxLayout()
        row.addWidget(self.clear_color)
        row.addWidget(self.clear_btn)
        dv.addLayout(row)

        self.temp_fixed = QCheckBox("Use a fixed temperature")
        self.temp_value = QSpinBox()
        self.temp_value.setRange(-20, 60)
        self.temp_value.setSuffix(" °C")
        self.temp_value.setValue(22)
        self.temp_apply = QPushButton("Apply")
        self.temp_apply.clicked.connect(self.apply_temp)
        self.temp_redraw = QPushButton("Apply and redraw")
        self.temp_redraw.clicked.connect(lambda: self.apply_temp(redraw=True))
        temp_box = QGroupBox("Temperature override (picks the refresh waveform)")
        tg = QGridLayout(temp_box)
        tg.addWidget(self.temp_fixed, 0, 0)
        tg.addWidget(self.temp_value, 0, 1)
        tg.addWidget(self.temp_apply, 1, 0)
        tg.addWidget(self.temp_redraw, 1, 1)
        self.temp_note = QLabel()
        self.temp_note.setWordWrap(True)
        self.temp_note.setStyleSheet("color: palette(dark);")
        tg.addWidget(self.temp_note, 2, 0, 1, 2)

        # experimental window test (firmware 0.5+)
        self.win_spins = {}
        for key, lo, hi, step, val in (("x", 0, 784, 8, 304), ("y", 0, 527, 1, 200),
                                       ("w", 8, 792, 8, 184), ("h", 1, 528, 1, 128)):
            sp = QSpinBox()
            sp.setRange(lo, hi)
            sp.setSingleStep(step)
            sp.setValue(val)
            self.win_spins[key] = sp
        self.win_fill = QComboBox()
        for name, _, code in imaging.PALETTE:
            pm = QPixmap(14, 14)
            pm.fill(QColor(SWATCHES[name]))
            self.win_fill.addItem(pm, name, code)
        self.win_fill.addItem("six stripes", protocol.WINDOW_STRIPES)
        self.win_codes = []
        for _ in range(2):
            cb = QComboBox()
            cb.setEditable(True)
            cb.addItems(["normal", "skip"])
            cb.setToolTip("Waveform code written to register 0xE6 for this pass: "
                          "normal (picked from the temperature), skip, or a number 1-254")
            self.win_codes.append(cb)
        self.win_full = QCheckBox("Send the whole frame (window only for the refresh)")
        self.win_btn = QPushButton("Redraw box")
        self.win_btn.clicked.connect(self.window_test)
        self.win_result = QLabel("Redraws one box over the stored image and times each pass. "
                                 "x and width snap to multiples of 8.")
        self.win_result.setWordWrap(True)
        win_box = QGroupBox("Window test (experimental, firmware 0.5)")
        wg = QGridLayout(win_box)
        for i, key in enumerate(("x", "y", "w", "h")):
            wg.addWidget(QLabel({"w": "width", "h": "height"}.get(key, key)), i // 2, (i % 2) * 2)
            wg.addWidget(self.win_spins[key], i // 2, (i % 2) * 2 + 1)
        wg.addWidget(QLabel("fill"), 2, 0)
        wg.addWidget(self.win_fill, 2, 1, 1, 3)
        wg.addWidget(QLabel("pass 1"), 3, 0)
        wg.addWidget(self.win_codes[0], 3, 1)
        wg.addWidget(QLabel("pass 2"), 3, 2)
        wg.addWidget(self.win_codes[1], 3, 3)
        wg.addWidget(self.win_full, 4, 0, 1, 4)
        wg.addWidget(self.win_btn, 5, 0, 1, 4)
        wg.addWidget(self.win_result, 6, 0, 1, 4)

        self.send_btn = QPushButton("Send to badge")
        f = self.send_btn.font()
        f.setBold(True)
        self.send_btn.setFont(f)
        self.send_btn.setMinimumHeight(36)
        self.send_btn.clicked.connect(self.send_or_cancel)
        self.safe_mode = QCheckBox("Safe mode (acknowledge every chunk)")
        self.progress = QProgressBar()
        self.progress.setRange(0, imaging.FRAME_BYTES)
        self.progress.setValue(0)
        self.progress.setFormat("%p%")
        self.send_status = QLabel()
        send_box = QGroupBox("Send")
        sv = QVBoxLayout(send_box)
        sv.addWidget(self.send_btn)
        sv.addWidget(self.safe_mode)
        sv.addWidget(self.progress)
        sv.addWidget(self.send_status)

        # simulator knobs, only shown while connected to it
        self.sim_box = QGroupBox("Simulator")
        sg = QGridLayout(self.sim_box)
        self.sim_real = QCheckBox("Realistic timing (30 s refresh)")
        self.sim_real.toggled.connect(lambda v: setattr(self.fake, "realistic", v))
        self.sim_temp = QSpinBox()
        self.sim_temp.setRange(-20, 60)
        self.sim_temp.setSuffix(" °C")
        self.sim_temp.setValue(self.fake.sensor_temp)
        self.sim_temp.valueChanged.connect(lambda v: setattr(self.fake, "sensor_temp", v))
        self.sim_corrupt = QPushButton("Corrupt next upload")
        self.sim_corrupt.clicked.connect(self._sim_corrupt)
        self.sim_old_fw = QCheckBox("Act like firmware 0.1 (no TEMP command)")
        self.sim_old_fw.toggled.connect(lambda v: setattr(self.fake, "support_temp_cmd", not v))
        sg.addWidget(self.sim_real, 0, 0, 1, 2)
        sg.addWidget(QLabel("Panel sensor reads"), 1, 0)
        sg.addWidget(self.sim_temp, 1, 1)
        sg.addWidget(self.sim_old_fw, 2, 0, 1, 2)
        sg.addWidget(self.sim_corrupt, 3, 0, 1, 2)

        # USB serial monitor
        serial_box = QGroupBox("USB serial log")
        sl = QHBoxLayout(serial_box)
        self.port_box = QComboBox()
        self.port_refresh = QPushButton("↻")
        self.port_refresh.setFixedWidth(32)
        self.port_refresh.clicked.connect(self._refresh_ports)
        self.port_btn = QPushButton("Open")
        self.port_btn.clicked.connect(self.toggle_serial)
        sl.addWidget(self.port_box, 1)
        sl.addWidget(self.port_refresh)
        sl.addWidget(self.port_btn)
        if not serial_log.available():
            serial_box.setEnabled(False)
            serial_box.setToolTip("pip install pyserial to see the badge's USB log here")
        self._refresh_ports()

        right = QWidget()
        rv = QVBoxLayout(right)
        rv.setContentsMargins(0, 0, 0, 0)
        for w in (dev_box, temp_box, send_box, win_box, self.sim_box, serial_box):
            rv.addWidget(w)
        rv.addStretch()
        scroll = QScrollArea()
        scroll.setWidget(right)
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QScrollArea.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll.setMinimumWidth(360)
        scroll.setMaximumWidth(440)

        top = QSplitter(Qt.Horizontal)
        top.addWidget(pic_box)
        top.addWidget(scroll)
        top.setStretchFactor(0, 1)

        # ---- log
        self.log_view = QPlainTextEdit(readOnly=True)
        self.log_view.setMaximumBlockCount(5000)
        mono = QFont("Consolas")
        mono.setStyleHint(QFont.Monospace)
        self.log_view.setFont(mono)
        log_box = QGroupBox("Log")
        lv = QVBoxLayout(log_box)
        lv.addWidget(self.log_view)
        row = QHBoxLayout()
        self.log_dev = QCheckBox("Show device log lines")
        self.log_dev.setChecked(True)
        clear_log = QPushButton("Clear")
        clear_log.clicked.connect(self.log_view.clear)
        save_log = QPushButton("Save log…")
        save_log.clicked.connect(self.save_log)
        row.addWidget(self.log_dev)
        row.addStretch()
        row.addWidget(clear_log)
        row.addWidget(save_log)
        lv.addLayout(row)

        split = QSplitter(Qt.Vertical)
        split.addWidget(top)
        split.addWidget(log_box)
        split.setStretchFactor(0, 3)
        split.setStretchFactor(1, 1)
        split.setSizes([600, 240])

        central = QWidget()
        cv = QVBoxLayout(central)
        cv.addLayout(bar)
        cv.addWidget(split, 1)
        self.setCentralWidget(central)

        quit_act = QAction("Quit", self, shortcut="Ctrl+Q", triggered=self.close)
        open_act = QAction("Open picture…", self, shortcut="Ctrl+O", triggered=self.open_picture)
        self.addActions([quit_act, open_act])

    def _update_controls(self):
        connected = self.client is not None
        busy = self.busy is not None
        upload = busy and self._uploading
        is_fake = connected and self.connected_name == FAKE_NAME
        self.device_box.setEnabled(not connected)
        self.scan_btn.setEnabled(not connected and not busy)
        self.connect_btn.setText("Disconnect" if connected else "Connect")
        self.connect_btn.setEnabled(not busy or connected)
        for w in (self.info_btn, self.show_btn, self.clear_btn, self.clear_color,
                  self.temp_apply, self.temp_redraw, self.win_btn):
            w.setEnabled(connected and not busy)
        self.temp_value.setEnabled(self.temp_fixed.isChecked())
        self.send_btn.setText("Cancel" if upload else "Send to badge")
        self.send_btn.setEnabled(upload or (connected and not busy and self.prepared is not None))
        self.sim_box.setVisible(is_fake)
        for b in self.save_btns:
            b.setEnabled(self.prepared is not None)
        color = "#1b8a4a" if connected else ("#d0a020" if busy else "#999")
        self.status_dot.setText(f"<span style='color:{color}; font-size:16px'>●</span>")
        self.status_text.setText(f"Connected to {self.connected_name}" if connected
                                 else ("Working…" if busy else "Not connected"))

    # ================================================== log

    def log(self, kind, text):
        if kind == "dev" and not self.log_dev.isChecked():
            return
        stamp = time.strftime("%H:%M:%S")
        line = f"{stamp}  {LOG_PREFIX.get(kind, '')}{html.escape(text)}"
        color = LOG_COLORS.get(kind)
        if kind == "rx" and text.startswith("ERROR"):
            color = LOG_COLORS["error"]
        if kind == "dev":
            if text.startswith("E ") or " error" in text.lower():
                color = "#d03030"
            elif text.startswith("W "):
                color = "#b07800"
        self.log_view.appendHtml(f"<span style='color:{color}'>{line}</span>" if color else line)

    def save_log(self):
        path, _ = QFileDialog.getSaveFileName(self, "Save log", "inktag-log.txt", "Text (*.txt)")
        if path:
            with open(path, "w", encoding="utf-8") as f:
                f.write(self.log_view.toPlainText())

    # ================================================== actions plumbing

    def _client_log(self, kind, text):
        self.runner.ui(self.log, kind, text)

    def run(self, label, coro, done=None):
        """Runs one protocol action; only one at a time."""
        if self.busy is not None:
            coro.close()
            return
        self.log("info", label)

        def ok(result):
            self.busy = None
            self._uploading = False
            if done:
                done(result)
            self._update_controls()

        def failed(e):
            self.busy = None
            if self._uploading:
                self.send_status.setText("Cancelled" if isinstance(e, CancelledError)
                                         else "Failed, see the log")
            self._uploading = False
            self._report(label, e)
            self._update_controls()

        self.busy = self.runner.submit(coro, ok, failed)
        self._update_controls()

    def _report(self, label, e):
        label = label.rstrip("…")
        if isinstance(e, CancelledError):
            self.log("info", "cancelled")
        elif isinstance(e, asyncio.TimeoutError):
            self.log("error", f"{label}: the badge didn't answer in time")
        elif isinstance(e, protocol.TagError):
            self.log("error", f"{label}: badge reported {e}")
        elif type(e) is RuntimeError:
            self.log("error", f"{label}: {e}")
        else:
            self.log("error", f"{label}: {type(e).__name__}: {e}")

    # ================================================== connection

    def scan(self):
        try:
            from . import ble_link
        except ImportError:
            self.log("error", "bleak is not installed: pip install bleak")
            return

        def found(devices):
            self.device_box.clear()
            self.device_box.addItem(f"Simulator ({FAKE_NAME})", ("fake", FAKE_ADDRESS))
            for name, addr, rssi, is_tag in devices:
                self.device_box.addItem(f"{name}  ({addr}, {rssi} dBm)", ("ble", addr))
            tags = sum(d[3] for d in devices)
            self.log("ok" if tags else "info", f"scan done: {tags} Ink Tag(s), {len(devices)} device(s) listed")
            if devices:
                self.device_box.setCurrentIndex(1)
            last = self.settings.value("last_address")
            for i in range(self.device_box.count()):
                if self.device_box.itemData(i)[1] == last:
                    self.device_box.setCurrentIndex(i)

        self.run("scanning for 5 s…", ble_link.scan(5.0, self.show_all.isChecked()), found)

    def toggle_connection(self):
        if self.client is not None:
            if self.busy is not None:
                self.busy.cancel()
            link, self.client, self.link = self.link, None, None
            self.runner.submit(link.close())
            self.log("info", f"disconnected from {self.connected_name}")
            self.connected_name = None
            self._clear_info()
            self._update_controls()
            return

        kind, address = self.device_box.currentData()
        if kind == "fake":
            link, name = FakeLink(self.fake), FAKE_NAME
        else:
            from . import ble_link
            link, name = ble_link.BleLink(address), self.device_box.currentText().split("  ")[0]
        link.on_disconnect = lambda: self.runner.ui(self._link_dropped, link)

        async def go():
            await link.connect()
            client = protocol.TagClient(link, self._client_log)
            return client, await client.info()

        def connected(result):
            self.client, info = result
            self.link, self.connected_name = link, name
            self.settings.setValue("last_address", address)
            self.log("ok", f"connected to {name}")
            self._show_info(info)

        self.run(f"connecting to {name}…", go(), connected)

    def _link_dropped(self, link):
        if link is not self.link:
            return
        self.log("error", f"{self.connected_name} disconnected")
        if self.busy is not None:
            self.busy.cancel()
        self.client = self.link = self.connected_name = None
        self._clear_info()
        self._update_controls()

    def _clear_info(self):
        for lab in self.info_labels.values():
            lab.setText("–")
        self.temp_note.setText("")

    def _show_info(self, info):
        self.info_labels["Firmware"].setText(f"{info['firmware']} (protocol {info['protocol']})")
        panel = f"{info['width']} × {info['height']}, format {info['format']}"
        answering = protocol.panel_answering(info["panel_id"])
        if answering is not None:
            panel += f", id {info['panel_id'].hex(' ')}" + ("" if answering else " (not answering: check the wiring)")
        self.info_labels["Panel"].setText(panel)
        self.info_labels["Stored image"].setText("yes" if info["has_image"] else "no")
        self.info_labels["Temperature"].setText(protocol.temp_str(info["temperature"]) + " (last refresh)")
        self.info_labels["MTU"].setText(f"{self.link.mtu} → {self.link.mtu - 3}-byte chunks")
        override = info["temp_override"]
        if override is None:
            self.temp_note.setText("This firmware can't change the temperature over Bluetooth; it "
                                   "needs 0.2.0. Until then it's a build option "
                                   "(CONFIG_INKTAG_TEMP_OVERRIDE in menuconfig).")
        elif override == protocol.TEMP_UNKNOWN:
            self.temp_fixed.setChecked(False)
            self.temp_note.setText("Now: reading the panel's sensor.")
        else:
            self.temp_fixed.setChecked(True)
            self.temp_value.setValue(override)
            self.temp_note.setText(f"Now: fixed at {override} °C.")
        self._update_controls()

    # ================================================== badge commands

    def get_info(self):
        self.run("asking for info…", self.client.info(), self._show_info)

    def redraw(self):
        self.run("redrawing the stored image…", self.client.show(), self._displayed)

    def clear_panel(self):
        name = self.clear_color.currentText()
        self.run(f"filling the panel with {name}…",
                 self.client.clear(self.clear_color.currentData()), self._displayed)

    def _displayed(self, temp):
        self.log("ok", f"panel refreshed at {protocol.temp_str(temp)}")
        self.info_labels["Temperature"].setText(protocol.temp_str(temp) + " (last refresh)")

    def apply_temp(self, redraw=False):
        value = self.temp_value.value() if self.temp_fixed.isChecked() else None
        client = self.client

        async def go():
            try:
                info = await client.set_temp_override(value)
            except protocol.TagError as e:
                if e.code == protocol.ERR_BAD_COMMAND:
                    raise RuntimeError("this firmware doesn't know the TEMP command (needs 0.2.0)") from e
                raise
            temp = await client.show() if redraw and info["has_image"] else None
            return info, temp

        def done(result):
            info, temp = result
            self._show_info(info)
            if temp is not None:
                self._displayed(temp)
            elif redraw:
                self.log("info", "nothing stored to redraw yet; send a picture first")

        what = f"{value} °C" if value is not None else "off (use the panel sensor)"
        self.run(f"setting the temperature override to {what}…", go(), done)

    def window_test(self):
        v = {k: sp.value() for k, sp in self.win_spins.items()}
        v["x"] -= v["x"] % 8
        v["w"] = max(8, v["w"] - v["w"] % 8)
        v["w"] = min(v["w"], imaging.WIDTH - v["x"])
        v["h"] = min(v["h"], imaging.HEIGHT - v["y"])
        try:
            codes = [imaging.inktag.parse_code(cb.currentText().strip().lower()) for cb in self.win_codes]
        except Exception:
            self.log("error", "pass codes must be normal, skip, or a number from 1 to 254")
            return
        if codes == [protocol.WINDOW_CODE_SKIP] * 2:
            self.log("error", "at least one pass must run")
            return
        client = self.client

        async def go():
            try:
                return await client.window_test(v["x"], v["y"], v["w"], v["h"],
                                                self.win_fill.currentData(), *codes,
                                                box_data=not self.win_full.isChecked())
            except protocol.TagError as e:
                if e.code == protocol.ERR_BAD_COMMAND:
                    raise RuntimeError("the badge refused the window test: firmware older than "
                                       "0.5.0, or a box it can't take") from e
                raise

        def done(result):
            text = protocol.window_result_str(result)
            self.win_result.setText(text)
            self.log("ok", "window test: " + text)
            self.info_labels["Temperature"].setText(protocol.temp_str(result[0]) + " (last refresh)")

        self.run(f"redrawing box {v['x']},{v['y']} {v['w']}x{v['h']}…", go(), done)

    def send_or_cancel(self):
        if self._uploading and self.busy is not None:
            self.busy.cancel()
            return
        frame = imaging.pack(self.prepared)
        self.sent_frame = frame
        self.progress.setValue(0)
        started = time.monotonic()

        def progress(sent, total):
            self.runner.ui(self._progress, sent, total, started)

        def done(result):
            secs, temp = result
            self.send_status.setText(f"Sent in {secs:.1f} s, refreshed at {protocol.temp_str(temp)}")
            self._displayed(temp)
            if self.connected_name != FAKE_NAME:   # the simulator reports its own panel
                self._panel_displayed(frame)

        self._uploading = True
        self.send_status.setText("Starting…")
        self.run(f"sending {os.path.basename(self.source_path or 'picture')}…",
                 self.client.upload(frame, progress, self.safe_mode.isChecked()), done)

    def _progress(self, sent, total, started):
        self.progress.setValue(sent)
        secs = max(time.monotonic() - started, 0.01)
        if sent >= total:
            self.send_status.setText("Data sent; waiting for the badge to check it and refresh…")
        else:
            rate = sent / secs
            left = (total - sent) / rate if rate else 0
            self.send_status.setText(f"{sent // 1024} / {total // 1024} KiB, "
                                     f"{rate / 1024:.1f} KiB/s, about {left:.0f} s left")

    def _panel_displayed(self, frame):
        portrait = self.orient_box.currentData()
        self.view_panel.set_image(imaging.frame_to_image(frame, portrait))

    def _sim_corrupt(self):
        self.fake.corrupt_next_upload = True
        self.log("info", "the simulator will flip one byte in the next upload (expect a CRC error)")

    # ================================================== serial

    def _refresh_ports(self):
        self.port_box.clear()
        for dev, label in serial_log.ports():
            self.port_box.addItem(label, dev)
        if not self.port_box.count():
            self.port_box.addItem("no ports found", None)

    def toggle_serial(self):
        if self.serial is not None:
            self.serial.close()
            return
        port = self.port_box.currentData()
        if not port:
            return
        try:
            self.serial = serial_log.SerialMonitor(
                port, lambda line: self.runner.ui(self.log, "dev", line),
                lambda: self.runner.ui(self._serial_closed))
        except Exception as e:  # noqa: BLE001
            self.log("error", f"can't open {port}: {e}")
            return
        self.log("ok", f"listening on {port}")
        self.port_btn.setText("Close")
        self.port_box.setEnabled(False)

    def _serial_closed(self):
        self.serial = None
        self.port_btn.setText("Open")
        self.port_box.setEnabled(True)

    # ================================================== picture

    def open_picture(self):
        start = self.settings.value("last_dir", os.path.expanduser("~"))
        path, _ = QFileDialog.getOpenFileName(
            self, "Open picture", start, "Pictures (*.png *.jpg *.jpeg *.bmp *.gif *.webp *.tif *.tiff)")
        if path:
            self.load_picture(path)

    def load_picture(self, path):
        try:
            self.source = imaging.load(path)
        except Exception as e:  # noqa: BLE001
            QMessageBox.warning(self, APP_NAME, f"Can't open {path}:\n{e}")
            return
        self.source_path = path
        self.settings.setValue("last_dir", os.path.dirname(path))
        self.view_original.set_image(self.source)
        self.log("info", f"loaded {os.path.basename(path)} ({self.source.width} × {self.source.height})")
        self._render()

    def dragEnterEvent(self, e):
        if e.mimeData().hasUrls():
            e.acceptProposedAction()

    def dropEvent(self, e):
        urls = e.mimeData().urls()
        if urls:
            self.load_picture(urls[0].toLocalFile())

    def _schedule_render(self):
        if self.source is not None:
            self._preview_timer.start()

    def _render(self):
        if self.source is None:
            return
        t0 = time.perf_counter()
        portrait = self.orient_box.currentData()
        self.prepared = imaging.prepare(
            self.source, portrait, self.fit_box.currentData(),
            self.bright.value() / 100, self.contrast.value() / 100, self.sat.value() / 100,
            self.dither.isChecked())
        self.view_dithered.set_image(imaging.preview(self.prepared, portrait))
        counts = imaging.color_counts(self.prepared)
        mix = ", ".join(f"{name} {share:.0%}" for name, share in counts.items() if share >= 0.005)
        self.picture_stats.setText(f"{mix}  ·  {(time.perf_counter() - t0) * 1000:.0f} ms")
        self._update_controls()

    def save_preview(self):
        path, _ = QFileDialog.getSaveFileName(self, "Save preview", "preview.png", "PNG (*.png)")
        if path:
            imaging.preview(self.prepared, self.orient_box.currentData()).save(path)
            self.log("ok", f"preview saved to {path}")

    def save_bin(self):
        path, _ = QFileDialog.getSaveFileName(self, "Save frame", "frame.bin", "Frame (*.bin)")
        if path:
            frame = imaging.pack(self.prepared)
            with open(path, "wb") as f:
                f.write(frame)
            self.log("ok", f"{len(frame)} bytes saved to {path}")

    # ================================================== shutdown

    def closeEvent(self, e):
        if self.serial is not None:
            self.serial.close()
        if self.link is not None:
            fut = asyncio.run_coroutine_threadsafe(self.link.close(), self.runner.loop)
            try:
                fut.result(timeout=3)
            except Exception:  # noqa: BLE001 - closing anyway
                pass
        super().closeEvent(e)


def main(argv=None):
    app = QApplication(sys.argv if argv is None else argv)
    app.setApplicationName(APP_NAME)
    app.setStyle("Fusion")
    win = MainWindow()
    win.show()
    args = app.arguments()[1:]
    if args and os.path.isfile(args[0]):
        win.load_picture(args[0])
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
