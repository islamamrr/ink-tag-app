// Wireless firmware updates over Bluetooth. The new app is written to the
// other OTA slot while the current one keeps running; on success the badge
// restarts into it. With rollback enabled, the new app starts "pending" and
// must call ota_update_confirm() once it is healthy, or the bootloader goes
// back to the previous app at the next reset.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

// Largest firmware image accepted (the size of one OTA slot).
size_t ota_update_capacity(void);

// Erases the inactive slot for `size` bytes (a few seconds).
esp_err_t ota_update_begin(size_t size);

esp_err_t ota_update_write(const uint8_t *data, size_t len);

size_t ota_update_written(void);

// Checks the length and CRC-32 (zlib) of what arrived, validates the app
// image (chip, header, SHA-256 digest) and that it is Ink Tag firmware, then
// makes it the boot app. ESP_ERR_INVALID_SIZE: wrong length.
// ESP_ERR_INVALID_CRC: CRC mismatch. ESP_ERR_OTA_VALIDATE_FAILED: not a valid Ink
// Tag image for this chip. The caller restarts the badge afterwards.
esp_err_t ota_update_finish(uint32_t crc32);

// Cancels an update in progress (nothing changes on the badge).
void ota_update_abort(void);

bool ota_update_active(void);

// Marks the running app good if it was started as a pending update.
// Returns true when it did.
bool ota_update_confirm(void);

// 0 or 1: which OTA slot the running app is in.
uint8_t ota_update_running_slot(void);

// True if an update was rejected at boot and the badge went back to the
// previous app.
bool ota_update_rolled_back(void);
