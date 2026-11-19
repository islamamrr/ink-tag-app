#include "ota_update.h"

#include <string.h>
#include "esp_app_desc.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_rom_crc.h"

static const char *TAG = "ota";

static const esp_partition_t *s_target;
static esp_ota_handle_t s_handle;
static bool s_active;
static size_t s_expected;
static size_t s_written;
static uint32_t s_crc;

size_t ota_update_capacity(void)
{
    const esp_partition_t *next = esp_ota_get_next_update_partition(NULL);
    return next ? next->size : 0;
}

esp_err_t ota_update_begin(size_t size)
{
    ota_update_abort();
    s_target = esp_ota_get_next_update_partition(NULL);
    ESP_RETURN_ON_FALSE(s_target, ESP_ERR_NOT_FOUND, TAG, "no update slot");
    ESP_RETURN_ON_FALSE(size > 0 && size <= s_target->size, ESP_ERR_INVALID_SIZE, TAG,
                        "size %u, slot holds %u", (unsigned)size, (unsigned)s_target->size);
    ESP_LOGI(TAG, "erasing %s for %u bytes", s_target->label, (unsigned)size);
    ESP_RETURN_ON_ERROR(esp_ota_begin(s_target, size, &s_handle), TAG, "begin");
    s_active = true;
    s_expected = size;
    s_written = 0;
    s_crc = 0;
    return ESP_OK;
}

esp_err_t ota_update_write(const uint8_t *data, size_t len)
{
    ESP_RETURN_ON_FALSE(s_active, ESP_ERR_INVALID_STATE, TAG, "no update");
    ESP_RETURN_ON_FALSE(s_written + len <= s_expected, ESP_ERR_INVALID_SIZE, TAG, "overflow");
    ESP_RETURN_ON_ERROR(esp_ota_write(s_handle, data, len), TAG, "write");
    s_crc = esp_rom_crc32_le(s_crc, data, len);
    s_written += len;
    return ESP_OK;
}

size_t ota_update_written(void)
{
    return s_written;
}

esp_err_t ota_update_finish(uint32_t crc32)
{
    ESP_RETURN_ON_FALSE(s_active, ESP_ERR_INVALID_STATE, TAG, "no update");
    if (s_written != s_expected) {
        ESP_LOGW(TAG, "got %u of %u bytes", (unsigned)s_written, (unsigned)s_expected);
        ota_update_abort();
        return ESP_ERR_INVALID_SIZE;
    }
    if (s_crc != crc32) {
        ESP_LOGW(TAG, "crc mismatch: got %08lx, expected %08lx",
                 (unsigned long)s_crc, (unsigned long)crc32);
        ota_update_abort();
        return ESP_ERR_INVALID_CRC;
    }
    s_active = false;
    // Checks the image header, the chip it was built for and its SHA-256.
    esp_err_t err = esp_ota_end(s_handle);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "image rejected: %s", esp_err_to_name(err));
        return ESP_ERR_OTA_VALIDATE_FAILED;
    }
    esp_app_desc_t desc;
    if (esp_ota_get_partition_description(s_target, &desc) != ESP_OK ||
        strcmp(desc.project_name, esp_app_get_description()->project_name) != 0) {
        ESP_LOGW(TAG, "not Ink Tag firmware");
        return ESP_ERR_OTA_VALIDATE_FAILED;
    }
    ESP_RETURN_ON_ERROR(esp_ota_set_boot_partition(s_target), TAG, "set boot");
    ESP_LOGW(TAG, "update to %s %s written to %s, restart to run it",
             desc.project_name, desc.version, s_target->label);
    return ESP_OK;
}

void ota_update_abort(void)
{
    if (s_active) {
        esp_ota_abort(s_handle);
        s_active = false;
        ESP_LOGI(TAG, "update cancelled after %u bytes", (unsigned)s_written);
    }
}

bool ota_update_active(void)
{
    return s_active;
}

bool ota_update_confirm(void)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    esp_ota_img_states_t state;
    if (esp_ota_get_state_partition(running, &state) == ESP_OK &&
        state == ESP_OTA_IMG_PENDING_VERIFY) {
        if (esp_ota_mark_app_valid_cancel_rollback() == ESP_OK) {
            ESP_LOGW(TAG, "new firmware in %s confirmed", running->label);
            return true;
        }
    }
    return false;
}

uint8_t ota_update_running_slot(void)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    return running && running->subtype == ESP_PARTITION_SUBTYPE_APP_OTA_1 ? 1 : 0;
}

bool ota_update_rolled_back(void)
{
    return esp_ota_get_last_invalid_partition() != NULL;
}
