#include "image_store.h"

#include "esp_check.h"
#include "esp_log.h"
#include "esp_partition.h"
#include "esp_rom_crc.h"
#include "nvs.h"

static const char *TAG = "store";

#define PARTITION_SUBTYPE 0x40
#define PARTITION_LABEL "pictures"
#define NVS_NS "pictures"
#define NVS_CURRENT "cur"

static const esp_partition_t *s_part;
static uint8_t s_count;
static image_slot_info_t s_slots[IMAGE_SLOTS_MAX];
static uint8_t s_current = IMAGE_SLOT_NONE;

// Upload in progress
static uint8_t s_slot = IMAGE_SLOT_NONE;
static size_t s_expected;
static size_t s_written;
static uint8_t s_pending_format;

// NVS key for a slot's metadata: "s0" ... "s7".
static void slot_key(uint8_t slot, char key[4])
{
    key[0] = 's';
    key[1] = (char)('0' + slot % 10);
    key[2] = '\0';
}

static size_t slot_offset(uint8_t slot)
{
    return (size_t)slot * IMAGE_SLOT_BYTES;
}

static esp_err_t slot_save(uint8_t slot)
{
    char key[4];
    slot_key(slot, key);
    nvs_handle_t h;
    ESP_RETURN_ON_ERROR(nvs_open(NVS_NS, NVS_READWRITE, &h), TAG, "nvs open");
    esp_err_t err = nvs_set_blob(h, key, &s_slots[slot], sizeof(s_slots[slot]));
    if (err == ESP_OK) {
        err = nvs_commit(h);
    }
    nvs_close(h);
    return err;
}

esp_err_t image_store_init(void)
{
    s_part = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, PARTITION_SUBTYPE, PARTITION_LABEL);
    ESP_RETURN_ON_FALSE(s_part, ESP_ERR_NOT_FOUND, TAG, "no pictures partition");
    size_t n = s_part->size / IMAGE_SLOT_BYTES;
    s_count = n > IMAGE_SLOTS_MAX ? IMAGE_SLOTS_MAX : n;

    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READONLY, &h) == ESP_OK) {
        for (uint8_t i = 0; i < s_count; i++) {
            char key[4];
            slot_key(i, key);
            size_t len = sizeof(s_slots[i]);
            if (nvs_get_blob(h, key, &s_slots[i], &len) != ESP_OK || len != sizeof(s_slots[i])) {
                s_slots[i] = (image_slot_info_t){0};
            }
        }
        if (nvs_get_u8(h, NVS_CURRENT, &s_current) != ESP_OK || s_current >= s_count) {
            s_current = IMAGE_SLOT_NONE;
        }
        nvs_close(h);
    }
    ESP_LOGI(TAG, "%u slots of %u KB, used mask 0x%02x, showing slot %d",
             s_count, IMAGE_SLOT_BYTES / 1024, image_store_used_mask(),
             s_current == IMAGE_SLOT_NONE ? -1 : s_current);
    return ESP_OK;
}

uint8_t image_store_slot_count(void)
{
    return s_count;
}

size_t image_store_capacity(void)
{
    return IMAGE_SLOT_BYTES;
}

uint8_t image_store_used_mask(void)
{
    uint8_t mask = 0;
    for (uint8_t i = 0; i < s_count; i++) {
        if (s_slots[i].valid) {
            mask |= 1u << i;
        }
    }
    return mask;
}

esp_err_t image_store_slot_info(uint8_t slot, image_slot_info_t *out)
{
    ESP_RETURN_ON_FALSE(slot < s_count, ESP_ERR_INVALID_ARG, TAG, "slot %u", slot);
    *out = s_slots[slot];
    return ESP_OK;
}

uint8_t image_store_current(void)
{
    return s_current;
}

esp_err_t image_store_set_current(uint8_t slot)
{
    ESP_RETURN_ON_FALSE(slot < s_count || slot == IMAGE_SLOT_NONE, ESP_ERR_INVALID_ARG, TAG,
                        "slot %u", slot);
    if (slot == s_current) {
        return ESP_OK;
    }
    nvs_handle_t h;
    ESP_RETURN_ON_ERROR(nvs_open(NVS_NS, NVS_READWRITE, &h), TAG, "nvs open");
    esp_err_t err = nvs_set_u8(h, NVS_CURRENT, slot);
    if (err == ESP_OK) {
        err = nvs_commit(h);
    }
    nvs_close(h);
    if (err == ESP_OK) {
        s_current = slot;
    }
    return err;
}

bool image_store_has_image(void)
{
    return s_current < s_count && s_slots[s_current].valid;
}

esp_err_t image_store_begin(uint8_t slot, uint8_t format, size_t length)
{
    ESP_RETURN_ON_FALSE(slot < s_count, ESP_ERR_INVALID_ARG, TAG, "slot %u", slot);
    ESP_RETURN_ON_FALSE(length > 0 && length <= IMAGE_SLOT_BYTES, ESP_ERR_INVALID_SIZE, TAG,
                        "length %u", (unsigned)length);
    s_slots[slot].valid = 0;
    ESP_RETURN_ON_ERROR(slot_save(slot), TAG, "meta");

    size_t sec = s_part->erase_size;
    size_t erase = (length + sec - 1) / sec * sec;
    ESP_RETURN_ON_ERROR(esp_partition_erase_range(s_part, slot_offset(slot), erase), TAG, "erase");

    s_slot = slot;
    s_expected = length;
    s_written = 0;
    s_pending_format = format;
    return ESP_OK;
}

esp_err_t image_store_append(const uint8_t *data, size_t len)
{
    ESP_RETURN_ON_FALSE(s_slot < s_count, ESP_ERR_INVALID_STATE, TAG, "no upload");
    ESP_RETURN_ON_FALSE(s_written + len <= s_expected, ESP_ERR_INVALID_SIZE, TAG, "overflow");
    ESP_RETURN_ON_ERROR(esp_partition_write(s_part, slot_offset(s_slot) + s_written, data, len),
                        TAG, "write");
    s_written += len;
    return ESP_OK;
}

size_t image_store_written(void)
{
    return s_written;
}

esp_err_t image_store_commit(uint32_t crc32, uint8_t *slot_out)
{
    ESP_RETURN_ON_FALSE(s_slot < s_count, ESP_ERR_INVALID_STATE, TAG, "no upload");
    ESP_RETURN_ON_FALSE(s_written == s_expected, ESP_ERR_INVALID_SIZE, TAG,
                        "got %u of %u bytes", (unsigned)s_written, (unsigned)s_expected);

    // CRC over what is actually in flash, so a bad write is caught too.
    static uint8_t buf[1024];
    uint32_t crc = 0;
    size_t base = slot_offset(s_slot);
    for (size_t off = 0; off < s_written; off += sizeof(buf)) {
        size_t n = s_written - off < sizeof(buf) ? s_written - off : sizeof(buf);
        ESP_RETURN_ON_ERROR(esp_partition_read(s_part, base + off, buf, n), TAG, "read");
        crc = esp_rom_crc32_le(crc, buf, n);
    }
    if (crc != crc32) {
        ESP_LOGW(TAG, "slot %u crc mismatch: got %08lx, expected %08lx",
                 s_slot, (unsigned long)crc, (unsigned long)crc32);
        return ESP_ERR_INVALID_CRC;
    }

    uint8_t slot = s_slot;
    s_slots[slot] = (image_slot_info_t){
        .length = s_written,
        .crc32 = crc,
        .format = s_pending_format,
        .valid = 1,
    };
    s_slot = IMAGE_SLOT_NONE;
    if (slot_out) {
        *slot_out = slot;
    }
    return slot_save(slot);
}

esp_err_t image_store_delete(uint8_t slot)
{
    ESP_RETURN_ON_FALSE(slot < s_count, ESP_ERR_INVALID_ARG, TAG, "slot %u", slot);
    s_slots[slot] = (image_slot_info_t){0};
    ESP_RETURN_ON_ERROR(slot_save(slot), TAG, "meta");
    if (slot == s_current) {
        return image_store_set_current(IMAGE_SLOT_NONE);
    }
    return ESP_OK;
}

esp_err_t image_store_read(void *ctx, size_t offset, uint8_t *buf, size_t len)
{
    uint8_t slot = (uint8_t)(uintptr_t)ctx;
    ESP_RETURN_ON_FALSE(slot < s_count && offset + len <= IMAGE_SLOT_BYTES, ESP_ERR_INVALID_ARG,
                        TAG, "read slot %u", slot);
    return esp_partition_read(s_part, slot_offset(slot) + offset, buf, len);
}
