#include "lock.h"

#include <string.h>
#include "esp_log.h"
#include "esp_random.h"
#include "mbedtls/md.h"
#include "nvs.h"

static const char *TAG = "lock";
static const char *NVS_NS = "inktag";
static const char *NVS_KEY = "owner";

static uint8_t s_key[LOCK_KEY_BYTES];
static bool s_locked;
static bool s_authorized;
static uint8_t s_nonce[LOCK_KEY_BYTES];
static bool s_nonce_valid;

esp_err_t lock_init(void)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(NVS_NS, NVS_READONLY, &h);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        s_locked = false;  // nothing stored yet
        return ESP_OK;
    }
    if (err != ESP_OK) {
        return err;
    }
    size_t len = sizeof(s_key);
    err = nvs_get_blob(h, NVS_KEY, s_key, &len);
    nvs_close(h);
    s_locked = err == ESP_OK && len == sizeof(s_key);
    ESP_LOGI(TAG, "%s", s_locked ? "locked to an owner" : "not locked");
    return err == ESP_ERR_NVS_NOT_FOUND ? ESP_OK : err;
}

bool lock_is_locked(void) { return s_locked; }
bool lock_authorized(void) { return s_authorized; }
bool lock_allowed(void) { return !s_locked || s_authorized; }

static esp_err_t store(const uint8_t *key)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(NVS_NS, NVS_READWRITE, &h);
    if (err != ESP_OK) {
        return err;
    }
    err = key ? nvs_set_blob(h, NVS_KEY, key, LOCK_KEY_BYTES) : nvs_erase_key(h, NVS_KEY);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        err = ESP_OK;  // erasing a key that isn't there
    }
    if (err == ESP_OK) {
        err = nvs_commit(h);
    }
    nvs_close(h);
    return err;
}

esp_err_t lock_set_key(const uint8_t key[LOCK_KEY_BYTES])
{
    esp_err_t err = store(key);
    if (err != ESP_OK) {
        return err;
    }
    memcpy(s_key, key, LOCK_KEY_BYTES);
    s_locked = true;
    s_authorized = true;
    ESP_LOGI(TAG, "owner key set");
    return ESP_OK;
}

esp_err_t lock_clear(void)
{
    esp_err_t err = store(NULL);
    if (err != ESP_OK) {
        return err;
    }
    memset(s_key, 0, sizeof(s_key));
    s_locked = false;
    ESP_LOGW(TAG, "owner key erased");
    return ESP_OK;
}

void lock_challenge(uint8_t nonce[LOCK_KEY_BYTES])
{
    esp_fill_random(s_nonce, sizeof(s_nonce));
    s_nonce_valid = true;
    memcpy(nonce, s_nonce, sizeof(s_nonce));
}

esp_err_t lock_answer(const uint8_t answer[LOCK_KEY_BYTES])
{
    if (!s_locked) {
        s_authorized = true;
        s_nonce_valid = false;
        return ESP_OK;
    }
    if (!s_nonce_valid) {
        return ESP_ERR_INVALID_STATE;
    }
    s_nonce_valid = false;  // one answer per challenge

    uint8_t mac[32];
    const mbedtls_md_info_t *md = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    if (mbedtls_md_hmac(md, s_key, sizeof(s_key), s_nonce, sizeof(s_nonce), mac) != 0) {
        return ESP_FAIL;
    }
    // Constant time: don't leak how many bytes matched.
    uint8_t diff = 0;
    for (int i = 0; i < LOCK_KEY_BYTES; i++) {
        diff |= mac[i] ^ answer[i];
    }
    if (diff != 0) {
        ESP_LOGW(TAG, "wrong answer");
        return ESP_FAIL;
    }
    s_authorized = true;
    ESP_LOGI(TAG, "authorized");
    return ESP_OK;
}

void lock_disconnected(void)
{
    s_authorized = false;
    s_nonce_valid = false;
}
