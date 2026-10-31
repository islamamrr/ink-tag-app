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
// (tens of seconds) and leaves the panel in deep sleep.
esp_err_t epd_show(epd_reader_t reader, void *ctx);

// Fills the whole panel with one color.
esp_err_t epd_clear(uint8_t color);

// Temperature read during the last refresh, in C (INT8_MIN if none yet).
int8_t epd_last_temperature(void);

// Fixed temperature for the next refreshes instead of reading the panel,
// INT8_MIN to read the panel again. Starts from CONFIG_INKTAG_TEMP_OVERRIDE_C
// when that is set; not kept across reboots.
void epd_set_temp_override(int8_t celsius);
int8_t epd_get_temp_override(void);
