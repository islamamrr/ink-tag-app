# Ink Tag BLE protocol (v1)

This is the contract between the badge firmware and the phone app. The firmware side lives in `main/protocol.h`; `tools/inktag.py` is a working client.

## Discovery

The badge advertises the service UUID below and names itself `InkTag-XXXX` (last two bytes of its Bluetooth address). Scan for the service UUID, not the name.

| | UUID | Properties |
|---|---|---|
| Service | `b5a10000-6e6b-4a7a-9c3e-1f2a3b4c5d6e` | |
| Control | `b5a10001-6e6b-4a7a-9c3e-1f2a3b4c5d6e` | write, notify |
| Data | `b5a10002-6e6b-4a7a-9c3e-1f2a3b4c5d6e` | write, write without response |

Request the largest MTU the phone allows (the badge accepts up to 517). All multi-byte numbers are little endian.

## Image format `0x01` (native)

- 792 × 528 pixels, in the panel controller's scan order: 528 rows of 792 pixels, top row first.
- 4 bits per pixel, two pixels per byte, the left pixel in the high nibble. 209,088 bytes in total.
- Pixel values: `0` black, `1` white, `2` yellow, `3` red, `5` blue, `6` green. Other values draw as white.
- The badge is hung in portrait (528 × 792), so the app rotates the picture 90° counter-clockwise before packing. If it comes out upside down on the real badge, rotate the other way; this depends on how the panel is mounted.
- The app does all image work: crop/fit, dither to the six colors (Floyd–Steinberg works well), rotate, pack.
- Dither against the panel's measured colors, not pure RGB (the panel's white is light grey, its red dark): use `PALETTE` in `tools/inktag.py`. The same colors make an honest preview. `epdoptimize` (JavaScript, Apache-2.0) is a good library to do this in the app.

## Commands (write to Control)

| Opcode | Name | Arguments | Result |
|---|---|---|---|
| `0x01` | BEGIN | u8 format, u32 length | storage is erased (≈1–3 s), then READY |
| `0x02` | END | u32 CRC-32 of the whole image (zlib/IEEE) | RECEIVED, then DISPLAYED when the refresh finishes |
| `0x03` | SHOW | – | redraws the stored image, then DISPLAYED |
| `0x04` | CLEAR | u8 color (pixel value) | fills the panel, then DISPLAYED (stored image kept) |
| `0x05` | INFO | – | INFO |
| `0x06` | ABORT | – | cancels an upload, no reply |
| `0x07` | TEMP | i8 °C, or −128 to read the panel again | sets a fixed temperature for the next refreshes (−20…60, not kept across reboots), then INFO. Firmware 0.2+; older firmware answers ERROR bad command |

## Notifications (from Control)

Every notification starts with `[event][status]`.

| Event | Name | Extra bytes |
|---|---|---|
| `0x81` | READY | – |
| `0x82` | RECEIVED | – |
| `0x83` | DISPLAYED | i8 panel temperature in °C |
| `0x84` | INFO | u8 protocol, u8 fw major, u8 minor, u8 patch, u16 width, u16 height, u8 native format, u8 has image, i8 temperature (−128 = unknown), u32 max upload length, then from firmware 0.2: i8 temperature override (−128 = off), then from firmware 0.3: 3 bytes panel id read at boot (all `FF` or all `00` = the panel didn't answer; show a wiring warning) |
| `0x8F` | ERROR | u8 opcode that failed; status holds the error |

Error codes: 1 bad command, 2 bad length, 3 bad state, 4 overflow, 5 CRC mismatch, 6 flash error, 7 panel timeout (the panel stayed busy too long, or, from firmware 0.3.1, never went busy at all, which means no panel is answering; nothing was drawn), 8 no stored image, 9 bad format.

## Upload sequence

1. Subscribe to Control notifications.
2. Write BEGIN `01 01 C0 30 03 00` (format 1, 209,088 bytes). Wait for READY.
3. Write the image to Data in chunks of MTU − 3 bytes, in order. Write without response is fine; asking for a response every 32 chunks or so keeps the phone's queue from running far ahead.
4. Write END with the CRC-32. Expect RECEIVED, then DISPLAYED. A six-color refresh takes a long time (tens of seconds, longer in the cold), so give it up to two minutes.

Disconnecting mid-upload cancels it; the previous stored image is lost once BEGIN has been accepted. Commands sent during a refresh wait until it finishes.

There is no pairing or ownership check yet, so any phone nearby can write to a badge. That is planned with the feature work.
