// Picture store: numbered slots in the "pictures" flash partition, one frame
// per slot, so the badge can hold several pictures and change between them
// by itself (playlists, schedules, the button). Slot metadata lives in NVS.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

// Size of one slot in flash: a 209,088-byte native frame rounded up to the
// 4 KB erase size.
#define IMAGE_SLOT_BYTES 0x34000
// Slot numbers fit a u8 bitmask in INFO.
#define IMAGE_SLOTS_MAX 8
#define IMAGE_SLOT_NONE 0xFF

typedef struct {
    uint32_t length;
    uint32_t crc32;
    uint8_t format;
    uint8_t valid;
} image_slot_info_t;

esp_err_t image_store_init(void);

// Number of slots the partition holds (7 on the 4 MB layout).
uint8_t image_store_slot_count(void);

// Largest picture one slot holds.
size_t image_store_capacity(void);

// Bit n set: slot n holds a picture.
uint8_t image_store_used_mask(void);

// ESP_ERR_INVALID_ARG for a slot number out of range.
esp_err_t image_store_slot_info(uint8_t slot, image_slot_info_t *out);

// The slot the panel shows (or last showed), or IMAGE_SLOT_NONE.
uint8_t image_store_current(void);
esp_err_t image_store_set_current(uint8_t slot);

// True when the current slot holds a picture.
bool image_store_has_image(void);

// Invalidates `slot` and erases room for `length` bytes in it.
esp_err_t image_store_begin(uint8_t slot, uint8_t format, size_t length);

// Appends bytes at the current write position of the slot being written.
esp_err_t image_store_append(const uint8_t *data, size_t len);

// Bytes appended since image_store_begin().
size_t image_store_written(void);

// Checks that exactly `length` bytes arrived and that their CRC-32 (zlib)
// matches, then marks the slot valid. Returns the slot that was written.
esp_err_t image_store_commit(uint32_t crc32, uint8_t *slot_out);

// Forgets the picture in `slot` (the flash is erased on the next upload).
// If it was the current slot, there is no current slot afterwards.
esp_err_t image_store_delete(uint8_t slot);

// epd_reader_t compatible: reads slot IMAGE_STORE_CTX(slot).
#define IMAGE_STORE_CTX(slot) ((void *)(uintptr_t)(slot))
esp_err_t image_store_read(void *ctx, size_t offset, uint8_t *buf, size_t len);
