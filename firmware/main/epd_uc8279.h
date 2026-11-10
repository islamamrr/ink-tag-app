// Driver for the Topwin TWE0368NW58 3.68" six-color panel. The controller is
// a UC8279E according to the vendor's file name; the datasheet doesn't name it
// and has no command table, so the sequence is copied from the vendor's STM32
// reference code.
#pragma once

#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

#define EPD_WIDTH  792  // source lines, controller scan direction
#define EPD_HEIGHT 528  // gate lines
#define EPD_FRAME_BYTES (EPD_WIDTH * EPD_HEIGHT / 2)  // 4 bpp input: 209,088

// Panel color codes (4-bit pixel values in the input frame)
enum {
    EPD_BLACK = 0,
    EPD_WHITE = 1,
    EPD_YELLOW = 2,
    EPD_RED = 3,
    EPD_BLUE = 5,
    EPD_GREEN = 6,
};

// Supplies `len` bytes of the 4 bpp frame starting at `offset`.
typedef esp_err_t (*epd_reader_t)(void *ctx, size_t offset, uint8_t *buf, size_t len);

esp_err_t epd_init(void);

#define EPD_PANEL_ID_LEN 3

// Resets the panel, reads its product revision (command 0x70) and puts it
// back to deep sleep. ESP_ERR_NOT_FOUND when every byte reads 0xFF or 0x00,
// which most likely means the panel isn't answering (wiring, ribbon,
// power). Unconfirmed on the UC8279E, so treat it as a hint, not a verdict.
esp_err_t epd_identify(void);

// Bytes read by the last epd_identify(), all 0xFF before the first.
const uint8_t *epd_panel_id(void);

// Full two-pass refresh from a 4 bpp frame. Blocks until the panel is done
// (tens of seconds) and leaves the panel in deep sleep. ESP_ERR_TIMEOUT when
// the panel stays busy too long, or when a refresh never goes busy or ends
// impossibly fast (no panel driving BUSY): nothing was drawn either way.
esp_err_t epd_show(epd_reader_t reader, void *ctx);

// Window test (experimental): redraws only a box of the panel, to find out
// whether the UC8279E refreshes a window by itself and whether the panel has
// a faster waveform than the six-color one. Coordinates are in the native
// frame (792 x 528, controller order); x and w must be multiples of 8.
#define EPD_WIN_CODE_NORMAL 0x00  // use the normal code for the panel temperature
#define EPD_WIN_CODE_SKIP   0xFF  // leave this pass out
#define EPD_WIN_BOX_DATA    0x01  // flags: send only the box's pixels (else the whole frame)

typedef struct {
    uint16_t x, y, w, h;
    uint8_t code1, code2;  // 0xE6 waveform code for pass 1 and 2, or EPD_WIN_CODE_*
    uint8_t flags;         // EPD_WIN_*
} epd_window_t;

typedef struct {
    uint8_t code1, code2;          // codes actually used
    uint32_t pass1_ms, pass2_ms;   // how long BUSY stayed low, 0 if skipped
} epd_window_result_t;

// `reader` supplies the whole 4 bpp frame (offsets as in epd_show); only the
// parts the mode needs are read. Unlike epd_show, a refresh that ends very
// quickly is reported, not treated as a missing panel; one that never goes
// busy is still ESP_ERR_TIMEOUT. ESP_ERR_INVALID_ARG for a bad box or two
// skipped passes. Leaves the panel in deep sleep.
esp_err_t epd_show_window(const epd_window_t *win, epd_reader_t reader, void *ctx,
                          epd_window_result_t *res);

// Fills the whole panel with one color.
esp_err_t epd_clear(uint8_t color);

// Temperature read during the last refresh, in C (INT8_MIN if none yet).
int8_t epd_last_temperature(void);

// Fixed temperature for the next refreshes instead of reading the panel,
// INT8_MIN to read the panel again. Starts from CONFIG_INKTAG_TEMP_OVERRIDE_C
// when that is set; not kept across reboots.
void epd_set_temp_override(int8_t celsius);
int8_t epd_get_temp_override(void);
