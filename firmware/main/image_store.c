#include "image_store.h"

#include "esp_check.h"
#include "esp_log.h"
#include "esp_partition.h"
#include "esp_rom_crc.h"
#include "nvs.h"

static const char *TAG = "store";

#define PARTITION_SUBTYPE 0x40
#define NVS_NS "image"

// Metadata lives in NVS; the pixels live in the partition.
typedef struct {
    uint32_t length;
    uint32_t crc32;
    uint8_t format;
    uint8_t valid;
} image_meta_t;

static const esp_partition_t *s_part;
static image_meta_t s_meta;
static size_t s_expected;
static size_t s_written;
static uint8_t s_pending_format;

static esp_err_t meta_save(void)
{
    nvs_handle_t h;
    ESP_RETURN_ON_ERROR(nvs_open(NVS_NS, NVS_READWRITE, &h), TAG, "nvs open");
    esp_err_t err = nvs_set_blob(h, "meta", &s_meta, sizeof(s_meta));
    if (err == ESP_OK) {
        err = nvs_commit(h);
    }
    nvs_close(h);
    return err;
}

esp_err_t image_store_init(void)
{
    s_part = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, PARTITION_SUBTYPE, "image");
    ESP_RETURN_ON_FALSE(s_part, ESP_ERR_NOT_FOUND, TAG, "no image partition");

    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READONLY, &h) == ESP_OK) {
        size_t len = sizeof(s_meta);
        if (nvs_get_blob(h, "meta", &s_meta, &len) != ESP_OK || len != sizeof(s_meta)) {
            s_meta = (image_meta_t){0};
        }
        nvs_close(h);
    }
    ESP_LOGI(TAG, "partition %u KB, stored image: %s (%u bytes)",
             (unsigned)(s_part->size / 1024), s_meta.valid ? "yes" : "no",
             (unsigned)s_meta.length);
    return ESP_OK;
}

size_t image_store_capacity(void)
{
    return s_part ? s_part->size : 0;
}

esp_err_t image_store_begin(uint8_t format, size_t length)
{
    ESP_RETURN_ON_FALSE(length > 0 && length <= s_part->size, ESP_ERR_INVALID_SIZE, TAG,
                        "length %u", (unsigned)length);
    s_meta.valid = 0;
    ESP_RETURN_ON_ERROR(meta_save(), TAG, "meta");

    size_t sec = s_part->erase_size;
    size_t erase = (length + sec - 1) / sec * sec;
    ESP_RETURN_ON_ERROR(esp_partition_erase_range(s_part, 0, erase), TAG, "erase");

    s_expected = length;
    s_written = 0;
    s_pending_format = format;
    return ESP_OK;
}

esp_err_t image_store_append(const uint8_t *data, size_t len)
{
    ESP_RETURN_ON_FALSE(s_written + len <= s_expected, ESP_ERR_INVALID_SIZE, TAG, "overflow");
    ESP_RETURN_ON_ERROR(esp_partition_write(s_part, s_written, data, len), TAG, "write");
    s_written += len;
    return ESP_OK;
}

size_t image_store_written(void)
{
    return s_written;
}

esp_err_t image_store_commit(uint32_t crc32)
{
    ESP_RETURN_ON_FALSE(s_written == s_expected, ESP_ERR_INVALID_SIZE, TAG,
                        "got %u of %u bytes", (unsigned)s_written, (unsigned)s_expected);

    // CRC over what is actually in flash, so a bad write is caught too.
    static uint8_t buf[1024];
    uint32_t crc = 0;
    for (size_t off = 0; off < s_written; off += sizeof(buf)) {
        size_t n = s_written - off < sizeof(buf) ? s_written - off : sizeof(buf);
        ESP_RETURN_ON_ERROR(esp_partition_read(s_part, off, buf, n), TAG, "read");
        crc = esp_rom_crc32_le(crc, buf, n);
    }
    if (crc != crc32) {
        ESP_LOGW(TAG, "crc mismatch: got %08lx, expected %08lx",
                 (unsigned long)crc, (unsigned long)crc32);
        return ESP_ERR_INVALID_CRC;
    }

    s_meta = (image_meta_t){
        .length = s_written,
        .crc32 = crc,
        .format = s_pending_format,
        .valid = 1,
    };
    return meta_save();
}

bool image_store_has_image(void)
{
    return s_meta.valid;
}

uint8_t image_store_format(void)
{
    return s_meta.format;
}

size_t image_store_length(void)
{
    return s_meta.length;
}

esp_err_t image_store_read(void *ctx, size_t offset, uint8_t *buf, size_t len)
{
    return esp_partition_read(s_part, offset, buf, len);
}
