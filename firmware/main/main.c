// Ink Tag firmware: receives images over BLE, keeps the last one in flash
// and draws it on the six-color e-ink panel.

#include <string.h>
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/stream_buffer.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "nvs_flash.h"

#include "ble_service.h"
#include "epd_uc8279.h"
#include "image_store.h"
#include "lock.h"
#include "protocol.h"

static const char *TAG = "inktag";

#define DATA_STREAM_BYTES 16384
#define DRAIN_CHUNK 4096

typedef enum {
    STATE_IDLE,
    STATE_RECEIVING,
} app_state_t;

static QueueHandle_t s_events;
static StreamBufferHandle_t s_data;
static app_state_t s_state = STATE_IDLE;
static uint8_t s_drain[DRAIN_CHUNK];

static uint32_t rd32(const uint8_t *p)
{
    return p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24);
}

static void notify(uint8_t event, uint8_t status)
{
    uint8_t msg[2] = {event, status};
    ble_service_notify(msg, sizeof(msg));
}

static void notify_error(uint8_t status, uint8_t cmd)
{
    uint8_t msg[3] = {INKTAG_EVT_ERROR, status, cmd};
    ble_service_notify(msg, sizeof(msg));
    ESP_LOGW(TAG, "command 0x%02x failed: %u", cmd, status);
}

static void notify_displayed(void)
{
    uint8_t msg[3] = {INKTAG_EVT_DISPLAYED, INKTAG_OK, (uint8_t)epd_last_temperature()};
    ble_service_notify(msg, sizeof(msg));
}

static void notify_info(void)
{
    inktag_info_t info = {
        .event = INKTAG_EVT_INFO,
        .status = INKTAG_OK,
        .protocol = INKTAG_PROTOCOL_VERSION,
        .fw_major = INKTAG_FW_VERSION_MAJOR,
        .fw_minor = INKTAG_FW_VERSION_MINOR,
        .fw_patch = INKTAG_FW_VERSION_PATCH,
        .width = EPD_WIDTH,
        .height = EPD_HEIGHT,
        .native_format = INKTAG_FMT_NATIVE_4BPP,
        .has_image = image_store_has_image(),
        .temperature = epd_last_temperature(),
        .max_length = EPD_FRAME_BYTES,
        .temp_override = epd_get_temp_override(),
        .lock_flags = (lock_is_locked() ? INKTAG_LOCK_LOCKED : 0) |
                      (lock_allowed() ? INKTAG_LOCK_AUTHORIZED : 0),
    };
    memcpy(info.panel_id, epd_panel_id(), sizeof(info.panel_id));
    ble_service_notify(&info, sizeof(info));
}

// Moves received bytes from the BLE stream buffer into flash. Bytes that
// arrive outside an upload are discarded.
static bool s_overflow;

static size_t drain_data(TickType_t wait)
{
    size_t n = xStreamBufferReceive(s_data, s_drain, sizeof(s_drain), wait);
    if (n == 0 || s_state != STATE_RECEIVING) {
        return n;
    }
    if (image_store_append(s_drain, n) != ESP_OK) {
        s_overflow = true;
    }
    return n;
}

static void drain_all(void)
{
    while (drain_data(0) > 0) {
    }
}

// Six bands of 88 rows: black, white, yellow, red, blue, green.
static esp_err_t test_pattern_reader(void *ctx, size_t offset, uint8_t *buf, size_t len)
{
    static const uint8_t BANDS[6] = {EPD_BLACK, EPD_WHITE, EPD_YELLOW, EPD_RED, EPD_BLUE, EPD_GREEN};
    for (size_t i = 0; i < len; i++) {
        size_t row = (offset + i) / (EPD_WIDTH / 2);
        uint8_t c = BANDS[row * 6 / EPD_HEIGHT];
        buf[i] = (c << 4) | c;
    }
    return ESP_OK;
}

// ESP_ERR_TIMEOUT is the panel (stuck, or not there). Anything else from a
// stored-image refresh is most likely the flash read.
static void report_show(esp_err_t err, uint8_t cmd, uint8_t other_error)
{
    if (err == ESP_OK) {
        notify_displayed();
    } else {
        notify_error(err == ESP_ERR_TIMEOUT ? INKTAG_ERR_PANEL_TIMEOUT : other_error, cmd);
    }
}

static void show_stored(uint8_t cmd)
{
    report_show(epd_show(image_store_read, NULL), cmd, INKTAG_ERR_FLASH);
}

static void notify_challenge(void)
{
    uint8_t msg[2 + LOCK_KEY_BYTES] = {INKTAG_EVT_CHALLENGE, INKTAG_OK};
    lock_challenge(&msg[2]);
    ble_service_notify(msg, sizeof(msg));
}

// Commands that change the badge. On a locked badge they need an authorized
// connection; INFO, ABORT and AUTH are always allowed.
static bool needs_owner(uint8_t op)
{
    switch (op) {
    case INKTAG_CMD_BEGIN:
    case INKTAG_CMD_END:
    case INKTAG_CMD_SHOW:
    case INKTAG_CMD_CLEAR:
    case INKTAG_CMD_TEMP:
    case INKTAG_CMD_LOCK:
    case INKTAG_CMD_UNLOCK:
        return true;
    default:
        return false;
    }
}

static void handle_command(const uint8_t *cmd, size_t len)
{
    if (needs_owner(cmd[0]) && !lock_allowed()) {
        notify_error(INKTAG_ERR_LOCKED, cmd[0]);
        return;
    }
    switch (cmd[0]) {
    case INKTAG_CMD_BEGIN: {
        if (len < 6) {
            notify_error(INKTAG_ERR_BAD_COMMAND, cmd[0]);
            return;
        }
        uint8_t format = cmd[1];
        uint32_t length = rd32(&cmd[2]);
        if (format != INKTAG_FMT_NATIVE_4BPP) {
            notify_error(INKTAG_ERR_BAD_FORMAT, cmd[0]);
            return;
        }
        if (length != EPD_FRAME_BYTES) {
            notify_error(INKTAG_ERR_BAD_LENGTH, cmd[0]);
            return;
        }
        drain_all();  // discard anything left over from a previous attempt
        s_state = STATE_IDLE;
        if (image_store_begin(format, length) != ESP_OK) {
            notify_error(INKTAG_ERR_FLASH, cmd[0]);
            return;
        }
        s_overflow = false;
        s_state = STATE_RECEIVING;
        ESP_LOGI(TAG, "receiving %lu bytes", (unsigned long)length);
        notify(INKTAG_EVT_READY, INKTAG_OK);
        break;
    }

    case INKTAG_CMD_END: {
        if (len < 5) {
            notify_error(INKTAG_ERR_BAD_COMMAND, cmd[0]);
            return;
        }
        if (s_state != STATE_RECEIVING) {
            notify_error(INKTAG_ERR_BAD_STATE, cmd[0]);
            return;
        }
        // Every data write was queued before this command, so drain them first.
        drain_all();
        s_state = STATE_IDLE;
        if (s_overflow) {
            notify_error(INKTAG_ERR_OVERFLOW, cmd[0]);
            return;
        }
        esp_err_t err = image_store_commit(rd32(&cmd[1]));
        if (err == ESP_ERR_INVALID_SIZE) {
            notify_error(INKTAG_ERR_BAD_LENGTH, cmd[0]);
            return;
        }
        if (err != ESP_OK) {
            notify_error(err == ESP_ERR_INVALID_CRC ? INKTAG_ERR_CRC : INKTAG_ERR_FLASH, cmd[0]);
            return;
        }
        notify(INKTAG_EVT_RECEIVED, INKTAG_OK);
        show_stored(cmd[0]);
        break;
    }

    case INKTAG_CMD_SHOW:
        if (s_state != STATE_IDLE) {
            notify_error(INKTAG_ERR_BAD_STATE, cmd[0]);
        } else if (!image_store_has_image()) {
            notify_error(INKTAG_ERR_NO_IMAGE, cmd[0]);
        } else {
            show_stored(cmd[0]);
        }
        break;

    case INKTAG_CMD_CLEAR: {
        if (s_state != STATE_IDLE) {
            notify_error(INKTAG_ERR_BAD_STATE, cmd[0]);
            return;
        }
        uint8_t color = len >= 2 ? cmd[1] : EPD_WHITE;
        report_show(epd_clear(color), cmd[0], INKTAG_ERR_PANEL_TIMEOUT);
        break;
    }

    case INKTAG_CMD_INFO:
        notify_info();
        break;

    case INKTAG_CMD_ABORT:
        s_state = STATE_IDLE;
        drain_all();
        break;

    case INKTAG_CMD_TEMP:
        if (len < 2) {
            notify_error(INKTAG_ERR_BAD_COMMAND, cmd[0]);
            return;
        }
        epd_set_temp_override((int8_t)cmd[1]);
        notify_info();
        break;

    case INKTAG_CMD_LOCK:
        if (len != 1 + LOCK_KEY_BYTES) {
            notify_error(INKTAG_ERR_BAD_COMMAND, cmd[0]);
        } else if (lock_set_key(&cmd[1]) != ESP_OK) {
            notify_error(INKTAG_ERR_FLASH, cmd[0]);
        } else {
            notify_info();
        }
        break;

    case INKTAG_CMD_AUTH:
        if (len == 1) {
            notify_challenge();
        } else if (len != 1 + LOCK_KEY_BYTES) {
            notify_error(INKTAG_ERR_BAD_COMMAND, cmd[0]);
        } else {
            esp_err_t err = lock_answer(&cmd[1]);
            if (err == ESP_OK) {
                notify_info();
            } else {
                notify_error(err == ESP_ERR_INVALID_STATE ? INKTAG_ERR_BAD_STATE : INKTAG_ERR_LOCKED, cmd[0]);
            }
        }
        break;

    case INKTAG_CMD_UNLOCK:
        if (lock_clear() != ESP_OK) {
            notify_error(INKTAG_ERR_FLASH, cmd[0]);
        } else {
            notify_info();
        }
        break;

    default:
        notify_error(INKTAG_ERR_BAD_COMMAND, cmd[0]);
        break;
    }
}

// Holding the button for this long erases the owner key (lost phone).
#define UNLOCK_HOLD_MS 10000

static void button_init(void)
{
    gpio_config_t io = {
        .pin_bit_mask = 1ULL << CONFIG_INKTAG_PIN_BUTTON,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
    };
    gpio_config(&io);
}

// Called from the main loop. Pressed = low.
static void button_poll(void)
{
    static TickType_t pressed_at;
    static bool pressed, done;
    bool down = gpio_get_level(CONFIG_INKTAG_PIN_BUTTON) == 0;
    TickType_t now = xTaskGetTickCount();
    if (!down) {
        pressed = done = false;
        return;
    }
    if (!pressed) {
        pressed = true;
        pressed_at = now;
        return;
    }
    if (done || now - pressed_at < pdMS_TO_TICKS(UNLOCK_HOLD_MS)) {
        return;
    }
    done = true;
    if (!lock_is_locked()) {
        ESP_LOGI(TAG, "button held, but the badge isn't locked");
        return;
    }
    if (lock_clear() == ESP_OK) {
        ESP_LOGW(TAG, "button held 10 s: unlocked");
        // Show it worked: the colour bands, as on a fresh badge.
        epd_show(test_pattern_reader, NULL);
    }
}

void app_main(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    ESP_ERROR_CHECK(image_store_init());
    ESP_ERROR_CHECK(lock_init());
    button_init();
    ESP_ERROR_CHECK(epd_init());
    // Wiring check: logged, and reported to the app in INFO. Not fatal, and
    // the test pattern below still runs, because it isn't confirmed yet that
    // the UC8279E answers this command.
    epd_identify();

    s_events = xQueueCreate(8, sizeof(ble_evt_t));
    s_data = xStreamBufferCreate(DATA_STREAM_BYTES, 1);
    ESP_ERROR_CHECK(s_events && s_data ? ESP_OK : ESP_ERR_NO_MEM);
    ESP_ERROR_CHECK(ble_service_start(s_events, s_data));

    // The panel keeps its picture without power, so normally nothing is drawn
    // at boot. Until a first image is uploaded, draw color bands so a fresh
    // build shows straight away whether the panel is wired correctly.
    if (!image_store_has_image()) {
        ESP_LOGI(TAG, "no stored image, drawing test pattern");
        esp_err_t err = epd_show(test_pattern_reader, NULL);
        if (err == ESP_OK) {
            ESP_LOGI(TAG, "test pattern drawn");
        } else {
            ESP_LOGE(TAG, "test pattern NOT drawn: %s", esp_err_to_name(err));
        }
    }

    for (;;) {
        if (s_state == STATE_IDLE) {
            button_poll();
        }
        // While receiving, keep flash writes flowing; otherwise mostly sleep.
        size_t n = drain_data(s_state == STATE_RECEIVING ? pdMS_TO_TICKS(5) : 0);
        ble_evt_t ev;
        TickType_t wait = (n > 0 || s_state == STATE_RECEIVING) ? 0 : pdMS_TO_TICKS(50);
        if (xQueueReceive(s_events, &ev, wait) != pdTRUE) {
            continue;
        }
        switch (ev.type) {
        case BLE_EVT_COMMAND:
            handle_command(ev.data, ev.len);
            break;
        case BLE_EVT_DATA_OVERFLOW:
            s_overflow = true;
            break;
        case BLE_EVT_DISCONNECTED:
            if (s_state == STATE_RECEIVING) {
                ESP_LOGW(TAG, "disconnected mid-upload, %u bytes received",
                         (unsigned)image_store_written());
            }
            s_state = STATE_IDLE;
            lock_disconnected();
            drain_all();
            break;
        }
    }
}
