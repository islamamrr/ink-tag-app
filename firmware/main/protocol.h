// Ink Tag BLE protocol, v1. See docs/PROTOCOL.md for the app-side description.
// All multi-byte fields are little endian.
#pragma once

#include <stdint.h>

#define INKTAG_PROTOCOL_VERSION 1
#define INKTAG_FW_VERSION_MAJOR 0
#define INKTAG_FW_VERSION_MINOR 5
#define INKTAG_FW_VERSION_PATCH 0

// 128-bit UUIDs, written here in the usual string order:
//   service  b5a10000-6e6b-4a7a-9c3e-1f2a3b4c5d6e
//   control  b5a10001-6e6b-4a7a-9c3e-1f2a3b4c5d6e  (write, notify)
//   data     b5a10002-6e6b-4a7a-9c3e-1f2a3b4c5d6e  (write, write without response)
#define INKTAG_UUID128(short16) \
    BLE_UUID128_INIT(0x6e, 0x5d, 0x4c, 0x3b, 0x2a, 0x1f, 0x3e, 0x9c, \
                     0x7a, 0x4a, 0x6b, 0x6e, (short16) & 0xff, (short16) >> 8, 0xa1, 0xb5)
#define INKTAG_UUID_SERVICE 0x0000
#define INKTAG_UUID_CONTROL 0x0001
#define INKTAG_UUID_DATA    0x0002

// Image formats
// 0x01: panel native. 792 x 528 pixels in controller scan order (rows of 792),
//       4 bits per pixel, high nibble first, 209,088 bytes.
//       Pixel values: 0 black, 1 white, 2 yellow, 3 red, 5 blue, 6 green.
#define INKTAG_FMT_NATIVE_4BPP 0x01

// Commands written to the control characteristic: [opcode][args...]
enum {
    INKTAG_CMD_BEGIN = 0x01, // u8 format, u32 length. Erases storage, then notifies READY.
    INKTAG_CMD_END   = 0x02, // u32 crc32 (zlib) of the whole image. Verifies, stores, refreshes.
    INKTAG_CMD_SHOW  = 0x03, // redraw the stored image
    INKTAG_CMD_CLEAR = 0x04, // u8 color: fill the panel with one color (storage untouched)
    INKTAG_CMD_INFO  = 0x05, // notifies INFO
    INKTAG_CMD_ABORT = 0x06, // cancel an upload in progress
    INKTAG_CMD_TEMP  = 0x07, // i8 fixed temperature in C for refreshes, -128 = read the panel. Notifies INFO.
    INKTAG_CMD_LOCK  = 0x08, // 16-byte owner key: lock to this phone, or change the key. Notifies INFO. (fw 0.4+)
    INKTAG_CMD_AUTH  = 0x09, // no args: notifies CHALLENGE. 16 bytes: HMAC-SHA-256(key, nonce)[0..15], notifies INFO. (fw 0.4+)
    INKTAG_CMD_UNLOCK = 0x0A, // erase the owner key. Notifies INFO. (fw 0.4+)
    // Experimental window test (fw 0.5+): u16 x, u16 y, u16 w, u16 h (native
    // frame, x and w multiples of 8), u8 fill (pixel value, or 0x10 for six
    // color stripes), u8 code1, u8 code2 (0xE6 waveform code per pass: 0x00 =
    // normal, 0xFF = skip the pass), u8 flags (bit 0: send only the box's
    // pixels). Redraws the box over the stored image, then notifies WINDOW.
    INKTAG_CMD_WINDOW = 0x0B,
};

// Notifications on the control characteristic: [event][status][payload...]
enum {
    INKTAG_EVT_READY     = 0x81, // BEGIN accepted, storage erased, send data now
    INKTAG_EVT_RECEIVED  = 0x82, // END accepted, CRC good, refresh starting
    INKTAG_EVT_DISPLAYED = 0x83, // refresh finished; payload: i8 panel temperature (C)
    INKTAG_EVT_INFO      = 0x84, // payload: see inktag_info_t
    INKTAG_EVT_CHALLENGE = 0x85, // payload: 16-byte nonce to answer with AUTH (fw 0.4+)
    INKTAG_EVT_WINDOW    = 0x86, // window test done; payload: i8 temperature, u8 code1, u8 code2,
                                 // u32 pass 1 ms, u32 pass 2 ms (0 = skipped) (fw 0.5+)
    INKTAG_EVT_ERROR     = 0x8F, // status holds the error; payload: u8 command that failed
};

enum {
    INKTAG_OK = 0,
    INKTAG_ERR_BAD_COMMAND = 1,
    INKTAG_ERR_BAD_LENGTH = 2,
    INKTAG_ERR_BAD_STATE = 3,
    INKTAG_ERR_OVERFLOW = 4,
    INKTAG_ERR_CRC = 5,
    INKTAG_ERR_FLASH = 6,
    INKTAG_ERR_PANEL_TIMEOUT = 7,  // panel stuck busy, or never busy (no panel); nothing drawn
    INKTAG_ERR_NO_IMAGE = 8,
    INKTAG_ERR_BAD_FORMAT = 9,
    INKTAG_ERR_LOCKED = 10,        // locked to another phone, or a wrong AUTH answer (fw 0.4+)
};

// inktag_info_t.lock_flags
#define INKTAG_LOCK_LOCKED     0x01  // an owner key is set
#define INKTAG_LOCK_AUTHORIZED 0x02  // this connection may change the badge

typedef struct __attribute__((packed)) {
    uint8_t event;          // INKTAG_EVT_INFO
    uint8_t status;         // INKTAG_OK
    uint8_t protocol;       // INKTAG_PROTOCOL_VERSION
    uint8_t fw_major, fw_minor, fw_patch;
    uint16_t width;         // 792
    uint16_t height;        // 528
    uint8_t native_format;  // INKTAG_FMT_NATIVE_4BPP
    uint8_t has_image;      // 1 if a stored image exists
    int8_t temperature;     // last panel reading in C, or -128 if unknown
    uint32_t max_length;    // largest upload accepted, bytes
    int8_t temp_override;   // fixed temperature in C, or -128 when reading the panel (fw 0.2+)
    uint8_t panel_id[3];    // panel product revision read at boot; all FF or all 00 = no answer (fw 0.3+)
    uint8_t lock_flags;     // INKTAG_LOCK_* (fw 0.4+)
} inktag_info_t;
