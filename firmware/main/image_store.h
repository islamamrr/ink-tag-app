// Stores the last received image in the "image" flash partition so it
// survives reboots and can be redrawn without another upload.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

esp_err_t image_store_init(void);

// Largest image the partition can hold.
size_t image_store_capacity(void);

// Invalidates the stored image and erases room for `length` bytes.
esp_err_t image_store_begin(uint8_t format, size_t length);

// Appends bytes at the current write position.
esp_err_t image_store_append(const uint8_t *data, size_t len);

// Bytes appended since image_store_begin().
size_t image_store_written(void);

// Checks that exactly `length` bytes arrived and that their CRC-32 (zlib)
// matches, then marks the image valid.
esp_err_t image_store_commit(uint32_t crc32);

bool image_store_has_image(void);
uint8_t image_store_format(void);
size_t image_store_length(void);

// epd_reader_t compatible: reads the stored image.
esp_err_t image_store_read(void *ctx, size_t offset, uint8_t *buf, size_t len);
