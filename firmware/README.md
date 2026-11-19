# Ink Tag firmware

ESP-IDF firmware for the Ink Tag badge: an ESP32 receives pictures from a phone over Bluetooth LE, keeps up to seven of them in flash, and draws them on the Topwin TWE0368NW58 3.68" six-color e-paper panel (528 × 792). The controller is a UC8279E according to the vendor's file name; the datasheet doesn't name it and has no command table, so the driver follows the vendor's reference code.

Built with **ESP-IDF v5.4.1** for the **ESP32-C6** (the B2 product board) and the **ESP32-C3** (SuperMini dev boards); both compile without warnings. 0.6 hasn't run on a badge yet. Firmware 0.4 adds the lock (`main/lock.c`), 0.5 an experimental window test (below), and 0.6 the launch foundation: wireless updates with rollback, seven picture slots, and the B2 board's pins.

**Moving a badge from 0.5 or older to 0.6 needs one flash over USB**, because the flash layout changed (below). After that, updates go over Bluetooth. The stored picture and the owner key are lost in the move: the merged image covers the NVS area with blank bytes, so the badge draws its colour bands once and has to be added in the app again. Updates after that go over Bluetooth and keep both.

## Layout

| Path | What it is |
|---|---|
| `main/epd_uc8279.c` | Panel driver, ported from the vendor's STM32 reference code |
| `main/image_store.c` | Picture slots in the `pictures` flash partition, metadata in NVS |
| `main/ota_update.c` | Wireless firmware updates: writes the other app slot, checks it, rolls back if it fails |
| `main/ble_service.c` | BLE peripheral (NimBLE) with the Ink Tag GATT service |
| `main/main.c` | Ties it together: upload state machine, commands, refresh, the button |
| `main/lock.c` | Lock to the owner's phone: key in NVS, challenge and HMAC check |
| `main/protocol.h` | BLE protocol constants, shared with the app spec |
| `docs/PROTOCOL.md` | Protocol description for the phone app |
| `tools/inktag.py` | PC test tool: converts pictures and sends them over BLE |
| `prebuilt/inktag-esp32c3.bin` | Ready-to-flash image for the C3 SuperMini (flash at 0x0 over USB), firmware 0.6.1 with the default pins |
| `prebuilt/inktag-esp32c6.bin` | Ready-to-flash image for the B2 board (ESP32-C6, flash at 0x0 over USB), firmware 0.6.1 |
| `prebuilt/inktag-esp32c*-update.bin` | The same firmware as an app image, for a wireless update (`tools/inktag.py update`) |
| `docs/GETTING_STARTED.md` | Step-by-step from parts to first picture |

## Wiring

The panel's pins are listed in section 5 of the datasheet. Default GPIOs (change them with `idf.py menuconfig` → *Ink Tag* → *Panel wiring*):

| Panel pin | ESP32-C6 (B2 board) | ESP32-C3 (SuperMini style) | ESP32 (D1 mini style) |
|---|---|---|---|
| SCL (13) | GPIO 19 | GPIO 4 | GPIO 18 |
| SDA (14) | GPIO 18 | GPIO 6 | GPIO 23 |
| CSB (12) | GPIO 20 | GPIO 7 | GPIO 5 |
| D/C (11) | GPIO 21 | GPIO 5 | GPIO 17 |
| RSTN (10) | GPIO 22 | GPIO 10 | GPIO 16 |
| BUSYN (9) | GPIO 14 | GPIO 3 | GPIO 4 |
| BS (8) | GND (4-wire SPI) | GND | GND |
| VDD / VDDIO | 3.3 V through the panel switch on GPIO 23 (low = on) | 3.3 V | 3.3 V |
| Button | GPIO 2 | GPIO 9 (BOOT) | GPIO 0 (BOOT) |

The B2 board's full pin plan is in `hardware/product-pcb/b2-board/README.md` in the project's shared files. Firmware 0.6 turns the panel supply on at start and leaves it on; switching it off between refreshes comes with deep sleep. The battery reading (GPIO 4, enabled by GPIO 5), accelerometer, NFC tag, buzzer and USB sense aren't used yet.

The panel is a bare FPC, so it also needs the booster circuit from datasheet section 11 (MOSFET on GDR, sense resistor on RESE, inductor, diodes and capacitors on VGH/VGL/VSH/VSL/VCOM/VDDD). Schematic, parts list and every pin's connection: [hardware/booster/BOOSTER.md](../hardware/booster/BOOSTER.md).

SDA is used in both directions: the driver reads a temperature byte back over it after command `0x40`, like the vendor code does, so keep it a plain wire (no level shifter that only goes one way).

## Build and flash

```sh
# once: install ESP-IDF v5.4 (https://docs.espressif.com/projects/esp-idf/en/v5.4.1/esp32c6/get-started/)
. $IDF_PATH/export.sh
idf.py set-target esp32c6      # B2 board; esp32c3 for the SuperMini
idf.py build flash monitor
```

To keep both chips' builds side by side: `idf.py -B build-c6 -DSDKCONFIG=build-c6/sdkconfig set-target esp32c6`, then the same `-B` and `-DSDKCONFIG` on `build`.

## Flash layout and wireless updates (firmware 0.6+)

| Partition | Offset | Size | What |
|---|---|---|---|
| nvs | 0x9000 | 24 KB | Owner key, picture slot metadata, current slot |
| otadata | 0xF000 | 8 KB | Which app slot to boot |
| ota_0, ota_1 | 0x20000, 0x150000 | 1.19 MB each | Two app slots. The app is about 0.6 MB, so there is room to grow |
| pictures | 0x280000 | 1.5 MB | Seven slots of 208 KB, one 209,088-byte frame each |

The layout can never change by wireless update, so it is sized for the launch: two app slots and seven pictures. Compressed pictures (planned) would fit more into the same space.

A wireless update writes the new app into the slot that isn't running while the badge keeps working, checks its length and CRC-32, then lets ESP-IDF check the image itself (built for this chip, header and SHA-256 intact) and that it is Ink Tag firmware. Only then does the badge switch to it and restart. The new firmware starts "on trial": once Bluetooth is up it marks itself good. If it crashes or resets before that, the bootloader goes back to the previous firmware, and INFO reports the rollback. A dropped connection mid-update leaves the running firmware untouched. On a locked badge only the owner's phone can update it.

```sh
python tools/inktag.py update prebuilt/inktag-esp32c3-update.bin   # or build-c3/inktag.bin
python tools/inktag.py info                                        # version, slot, rollback
```

The phone app carries the update images (`app/assets/firmware`, copied by `node app/tools/bundle_firmware.mjs` after a rebuild) and installs newer firmware on its own when the badge is connected and idle. Sending a picture pauses it. The badge reports its chip in INFO from 0.6.1, so the app picks the right file. A 0.6.0 badge is an ESP32-C3.

Not done yet, and needed before badges are sold: signed updates (secure boot with a signing key, so only firmware Ink Tag built is accepted, even from the owner's phone).

## Try it from a computer

```sh
pip install pillow bleak
python tools/inktag.py info
python tools/inktag.py send photo.jpg --preview preview.png
python tools/inktag.py clear white
```

`convert` does the image work without a badge, which is handy for checking the dithering.

Until a first picture is stored in any slot, the badge draws six color bands at boot as a wiring check.

Picture slots (firmware 0.6+):

```sh
python tools/inktag.py send photo.jpg --slot 3 --keep   # store without drawing
python tools/inktag.py show --slot 3
python tools/inktag.py slots
python tools/inktag.py delete 3
```

## How the panel is driven

Six colors are drawn in two refreshes. For each one, the 4-bit frame is converted on the fly to 2 bits per pixel through a per-pass table, and a key is written to register `0xE6` that picks the waveform for that pass. The keys (2/7, 12/17, 22/27, 32/37, 42/47) are most likely forced temperatures: `0xE0 02` tells UltraChip controllers to use a forced temperature instead of the sensor, so each key picks a waveform slot stored in the panel, and pass 2 uses the slot 5 degrees up. They come from the temperature byte, in five bands (below 5, 5–10, 11–20, 21–30, above). All of this is copied from the vendor code. The vendor code leaves a reading of exactly 5, and negative readings, unhandled; here 5 uses the 5–10 band and negatives use the coldest.

The temperature byte comes from the controller's on-chip sensor: in the UltraChip UC8179c datasheet, `0x41 00` selects the internal sensor and `0x40` returns signed whole degrees (`0x19` = 25 °C, `0xE7` = −25 °C), and other UC8279 drivers read it the same way. The optional external sensor on TSCL/TSDA isn't needed. If the log still shows `temperature byte 0x00` or `0xff`, suspect the SDA wire, and turn on *Ink Tag* → *Use a fixed temperature* in menuconfig meanwhile.

At boot the firmware also reads the controller's product revision (command `0x70`, three bytes, read back over SDA like the temperature) and logs `panel id xx xx xx`. All `ff` or all `00` means the panel didn't answer, which usually points at wiring. The app gets the same bytes in INFO. The UC8279E's expected answer isn't documented, so this is a hint, not a verdict, and the test pattern is attempted either way. Since 0.3.1 a refresh that never pulls BUSY low, or ends in under a second, fails with "panel timeout" (ERROR 7) instead of reporting DISPLAYED, so a bare board no longer claims it drew anything.

After commands that start work (refresh, temperature sensing) the driver waits up to 50 ms for BUSY to go low before waiting for it to go high again, so a slow BUSY can't make pass 2 start while pass 1 is still drawing.

SPI writes run at 8 MHz by default (datasheet p.11 allows up to 10 MHz) and the temperature read at 1 MHz (the read cycle must be at least 350 ns).

The frame is streamed from flash in 2 KB pieces, so the firmware never holds the 209 KB image in RAM. That is why a plain ESP32 or ESP32-C3 without PSRAM is enough.

## Window test (0.5, experimental)

To find out whether the panel can update only part of the screen (a clock, say) and whether it has a faster waveform than the six-color one, 0.5 adds a WINDOW command that redraws one box and times each pass. Details are in [docs/PROTOCOL.md](docs/PROTOCOL.md#window-test-firmware-05-experimental). It is also in the devtool (*Window test* box) and in `tools/inktag.py`:

```
# 1. Does only the box change? Normal waveform, only the box's pixels sent.
python tools/inktag.py window 304 200 184 128 black
# 2. Same, but the whole frame is sent and the window narrowed only for the refresh.
python tools/inktag.py window 304 200 184 128 white --full-frame
# 3. Hunting for a fast waveform: one pass, a forced code, black then white.
python tools/inktag.py window 304 200 184 128 black --code1 skip --code2 90
python tools/inktag.py window 304 200 184 128 white --code1 skip --code2 90
```

What to look for: whether only the box flashes (the rest of the picture stays still), whether the box lands where expected or mirrored, and the pass times. Normal passes take seconds; a pass well under 2–3 seconds with a clean black/white change would mean a fast waveform exists at that code. Try a handful of codes (for example 50, 60, 90, 110, 127), not a sweep, and redraw the whole picture with `show` afterwards to clear any ghosting. Nothing here writes to the panel's memory, so a bad code can only leave a messy picture.

## Not done yet

- Battery power: the radio advertises all the time and the chip never sleeps. Waking on a button and advertising for a while is the usual pattern.
- Pairing / ownership, so only the owner's phone can change the badge.
- Compression for faster uploads (209 KB takes several seconds over BLE).
- OTA firmware updates (the partition table has room to add them).

## Lock (0.4)

The app locks a badge to its phone when it's added, so a stranger nearby can't change it. How it works is in [docs/PROTOCOL.md](docs/PROTOCOL.md#lock-firmware-04). To unlock a badge without its phone, hold the button (BOOT on the dev boards; `idf.py menuconfig` → *Ink Tag* → *Button GPIO*) for 10 seconds while the badge is running; it redraws its colour bands when done. A locked badge refuses `tools/inktag.py` and the devtool (including the window test), so unlock it first to use them.
