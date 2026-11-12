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
| `0x08` | LOCK | 16-byte owner key | locks the badge to the phone holding the key (or changes the key), then INFO. Firmware 0.4+ |
| `0x09` | AUTH | none, or 16-byte answer | none: CHALLENGE. With an answer: INFO if it's right, ERROR locked if not. Firmware 0.4+ |
| `0x0A` | UNLOCK | – | erases the owner key, then INFO. Firmware 0.4+ |
| `0x0B` | WINDOW | u16 x, u16 y, u16 w, u16 h, u8 fill, u8 code1, u8 code2, u8 flags | experimental: redraws one box over the stored image, then WINDOW. Firmware 0.5+, see [Window test](#window-test-firmware-05-experimental) |

## Notifications (from Control)

Every notification starts with `[event][status]`.

| Event | Name | Extra bytes |
|---|---|---|
| `0x81` | READY | – |
| `0x82` | RECEIVED | – |
| `0x83` | DISPLAYED | i8 panel temperature in °C |
| `0x84` | INFO | u8 protocol, u8 fw major, u8 minor, u8 patch, u16 width, u16 height, u8 native format, u8 has image, i8 temperature (−128 = unknown), u32 max upload length, then from firmware 0.2: i8 temperature override (−128 = off), then from firmware 0.3: 3 bytes panel id read at boot (all `FF` or all `00` = the panel didn't answer; show a wiring warning), then from firmware 0.4: u8 lock flags (bit 0 locked, bit 1 this connection may change the badge) |
| `0x85` | CHALLENGE | 16-byte nonce (firmware 0.4+) |
| `0x86` | WINDOW | i8 panel temperature, u8 code1, u8 code2 (as used), u32 pass 1 ms, u32 pass 2 ms (0 = skipped) (firmware 0.5+) |
| `0x8F` | ERROR | u8 opcode that failed; status holds the error |

Error codes: 1 bad command, 2 bad length, 3 bad state, 4 overflow, 5 CRC mismatch, 6 flash error, 7 panel timeout (the panel stayed busy too long, or, from firmware 0.3.1, never went busy at all, which means no panel is answering; nothing was drawn), 8 no stored image, 9 bad format.

## Upload sequence

1. Subscribe to Control notifications.
2. Write BEGIN `01 01 C0 30 03 00` (format 1, 209,088 bytes). Wait for READY.
3. Write the image to Data in chunks of MTU − 3 bytes, in order. Write without response is fine; asking for a response every 32 chunks or so keeps the phone's queue from running far ahead.
4. Write END with the CRC-32. Expect RECEIVED, then DISPLAYED. A six-color refresh takes a long time (tens of seconds, longer in the cold), so give it up to two minutes.

Disconnecting mid-upload cancels it; the previous stored image is lost once BEGIN has been accepted. Commands sent during a refresh wait until it finishes.

## Lock (firmware 0.4+)

A badge can be locked to one phone so a stranger nearby can't change it.

- **Locking.** The phone makes 16 random bytes, the owner key, keeps them, and writes LOCK with the key. The badge stores it in NVS (kept across reboots and reflashes of the app partition) and answers INFO with the locked flag set. This is the only time the key crosses the air, so the app does it when the badge is added, right next to the phone.
- **Every later connection** starts unauthorized. On a locked badge, BEGIN, END, SHOW, CLEAR, TEMP, LOCK, UNLOCK and WINDOW then answer ERROR `locked` (10). INFO, ABORT and AUTH always work.
- **Proving ownership.** Write AUTH with no arguments; the badge answers CHALLENGE with a fresh 16-byte nonce. Write AUTH with the first 16 bytes of HMAC-SHA-256(key, nonce). A right answer authorizes this connection until it disconnects (INFO, bit 1 set); a wrong one answers ERROR `locked`. Each nonce takes one answer, so a wrong guess needs a new CHALLENGE. AUTH with an answer but no CHALLENGE first answers `bad state`.
- **Changing the key:** LOCK again from an authorized connection. **Turning the lock off:** UNLOCK.
- **Lost phone:** holding the badge's button (BOOT on the dev boards) for 10 seconds while it is running erases the key, and the badge draws its colour bands to confirm. Don't hold it while powering on: that starts the chip's download mode.

The lock keeps strangers from changing a badge; it doesn't encrypt pictures in flight. A badge on firmware older than 0.4 has no lock: its INFO is shorter, and the app adds it unlocked.

The PC tools (`tools/inktag.py`, the devtool) don't know the key, so they can only talk to an unlocked badge: turn the lock off in the app first, or hold the button.

## Window test (firmware 0.5, experimental)

A development command for finding out whether the panel can redraw part of the screen, and whether it has a faster waveform than the six-color one (for a clock, for example). It isn't meant for the app yet.

- **Box:** x, y, w, h in the native frame (792 × 528, controller order, as in the image format). x and w must be multiples of 8, and the box must fit; otherwise ERROR `bad command`.
- **fill:** a pixel value (`0` black, `1` white, ...) or `0x10` for six color stripes. Outside the box the stored image is sent (white if none), so the rest of the frame matches what is on the panel.
- **code1, code2:** the value written to register `0xE6` before each pass. `0x00` uses the normal code for the panel temperature (2/7 ... 42/47), `0xFF` skips the pass, anything else is forced. Codes above 47 are outside what the vendor code uses: on sibling UltraChip chips that's where fast and partial waveforms live (ESPHome uses 90 and 110 on the UC8179), but nobody knows what this panel's memory holds there.
- **flags bit 0 set:** the window (`0x83`) is narrowed to the box first and only the box's pixels are sent. **Clear:** the whole frame is sent with a full-screen window, and the window is narrowed only for the refresh. Which of the two the controller wants is one of the things to find out.
- The WINDOW answer reports how long BUSY stayed low in each pass. Unlike a normal refresh, a very short pass is reported rather than treated as a missing panel; a pass that never goes busy is still ERROR `panel timeout`.
- The stored image isn't changed. SHOW redraws the whole picture, which also clears any ghosting a test leaves behind.
