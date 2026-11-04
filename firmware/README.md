# Ink Tag firmware

ESP-IDF firmware for the Ink Tag badge: an ESP32 receives pictures from a phone over Bluetooth LE, keeps the last one in flash, and draws it on the Topwin TWE0368NW58 3.68" six-color e-paper panel (528 × 792). The controller is a UC8279E according to the vendor's file name; the datasheet doesn't name it and has no command table, so the driver follows the vendor's reference code.

Built and tested to compile with **ESP-IDF v5.3.2** for **ESP32** and **ESP32-C3**. Not yet run on hardware. Firmware 0.4 adds the lock (`main/lock.c`); it was written without an ESP-IDF toolchain at hand, so the first `idf.py build` of 0.4 is also its first compile.

## Layout

| Path | What it is |
|---|---|
| `main/epd_uc8279.c` | Panel driver, ported from the vendor's STM32 reference code |
| `main/image_store.c` | Stores the received image in the `image` flash partition |
| `main/ble_service.c` | BLE peripheral (NimBLE) with the Ink Tag GATT service |
| `main/main.c` | Ties it together: upload state machine, commands, refresh, the button |
| `main/lock.c` | Lock to the owner's phone: key in NVS, challenge and HMAC check |
| `main/protocol.h` | BLE protocol constants, shared with the app spec |
| `docs/PROTOCOL.md` | Protocol description for the phone app |
| `tools/inktag.py` | PC test tool: converts pictures and sends them over BLE |
| `prebuilt/inktag-esp32c3.bin` | Ready-to-flash image for the C3 SuperMini (flash at 0x0). Still firmware 0.1.0: later versions are built from source on the laptop |
| `docs/GETTING_STARTED.md` | Step-by-step from parts to first picture |

## Wiring

The panel's pins are listed in section 5 of the datasheet. Default GPIOs (change them with `idf.py menuconfig` → *Ink Tag* → *Panel wiring*):

| Panel pin | ESP32 (D1 mini style) | ESP32-C3 (SuperMini style) |
|---|---|---|
| SCL (13) | GPIO 18 | GPIO 4 |
| SDA (14) | GPIO 23 | GPIO 6 |
| CSB (12) | GPIO 5 | GPIO 7 |
| D/C (11) | GPIO 17 | GPIO 5 |
| RSTN (10) | GPIO 16 | GPIO 10 |
| BUSYN (9) | GPIO 4 | GPIO 3 |
| BS (8) | GND (4-wire SPI) | GND |
| VDD / VDDIO | 3.3 V | 3.3 V |

The panel is a bare FPC, so it also needs the booster circuit from datasheet section 11 (MOSFET on GDR, sense resistor on RESE, inductor, diodes and capacitors on VGH/VGL/VSH/VSL/VCOM/VDDD). Schematic, parts list and every pin's connection: [hardware/booster/BOOSTER.md](../hardware/booster/BOOSTER.md).

SDA is used in both directions: the driver reads a temperature byte back over it after command `0x40`, like the vendor code does, so keep it a plain wire (no level shifter that only goes one way).

## Build and flash

```sh
# once: install ESP-IDF v5.3 (https://docs.espressif.com/projects/esp-idf/en/v5.3.2/esp32/get-started/)
. $IDF_PATH/export.sh
idf.py set-target esp32c3      # or esp32
idf.py build flash monitor
```

## Try it from a computer

```sh
pip install pillow bleak
python tools/inktag.py info
python tools/inktag.py send photo.jpg --preview preview.png
python tools/inktag.py clear white
```

`convert` does the image work without a badge, which is handy for checking the dithering.

Until a first image is uploaded, the badge draws six color bands at boot as a wiring check.

## How the panel is driven

Six colors are drawn in two refreshes. For each one, the 4-bit frame is converted on the fly to 2 bits per pixel through a per-pass table, and a key is written to register `0xE6` that picks the waveform for that pass. The keys (2/7, 12/17, 22/27, 32/37, 42/47) are most likely forced temperatures: `0xE0 02` tells UltraChip controllers to use a forced temperature instead of the sensor, so each key picks a waveform slot stored in the panel, and pass 2 uses the slot 5 degrees up. They come from the temperature byte, in five bands (below 5, 5–10, 11–20, 21–30, above). All of this is copied from the vendor code. The vendor code leaves a reading of exactly 5, and negative readings, unhandled; here 5 uses the 5–10 band and negatives use the coldest.

The temperature byte comes from the controller's on-chip sensor: in the UltraChip UC8179c datasheet, `0x41 00` selects the internal sensor and `0x40` returns signed whole degrees (`0x19` = 25 °C, `0xE7` = −25 °C), and other UC8279 drivers read it the same way. The optional external sensor on TSCL/TSDA isn't needed. If the log still shows `temperature byte 0x00` or `0xff`, suspect the SDA wire, and turn on *Ink Tag* → *Use a fixed temperature* in menuconfig meanwhile.

At boot the firmware also reads the controller's product revision (command `0x70`, three bytes, read back over SDA like the temperature) and logs `panel id xx xx xx`. All `ff` or all `00` means the panel didn't answer, which usually points at wiring. The app gets the same bytes in INFO. The UC8279E's expected answer isn't documented, so this is a hint, not a verdict, and the test pattern is attempted either way. Since 0.3.1 a refresh that never pulls BUSY low, or ends in under a second, fails with "panel timeout" (ERROR 7) instead of reporting DISPLAYED, so a bare board no longer claims it drew anything.

After commands that start work (refresh, temperature sensing) the driver waits up to 50 ms for BUSY to go low before waiting for it to go high again, so a slow BUSY can't make pass 2 start while pass 1 is still drawing.

SPI writes run at 8 MHz by default (datasheet p.11 allows up to 10 MHz) and the temperature read at 1 MHz (the read cycle must be at least 350 ns).

The frame is streamed from flash in 2 KB pieces, so the firmware never holds the 209 KB image in RAM. That is why a plain ESP32 or ESP32-C3 without PSRAM is enough.

## Not done yet

- Battery power: the radio advertises all the time and the chip never sleeps. Waking on a button and advertising for a while is the usual pattern.
- Pairing / ownership, so only the owner's phone can change the badge.
- Compression for faster uploads (209 KB takes several seconds over BLE).
- OTA firmware updates (the partition table has room to add them).

## Lock (0.4)

The app locks a badge to its phone when it's added, so a stranger nearby can't change it. How it works is in [docs/PROTOCOL.md](docs/PROTOCOL.md#lock-firmware-04). To unlock a badge without its phone, hold the button (BOOT on the dev boards; `idf.py menuconfig` → *Ink Tag* → *Button GPIO*) for 10 seconds while the badge is running; it redraws its colour bands when done. A locked badge refuses `tools/inktag.py` and the devtool, so unlock it first to use them.
