#include "epd_uc8279.h"

#include <string.h>
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

static const char *TAG = "epd";

#define PIN_SCK  CONFIG_INKTAG_PIN_SCK
#define PIN_SDA  CONFIG_INKTAG_PIN_SDA
#define PIN_CS   CONFIG_INKTAG_PIN_CS
#define PIN_DC   CONFIG_INKTAG_PIN_DC
#define PIN_RST  CONFIG_INKTAG_PIN_RST
#define PIN_BUSY CONFIG_INKTAG_PIN_BUSY

#define EPD_HOST SPI2_HOST
#define BUSY_TIMEOUT_MS 60000
// Longest wait for BUSYN to go low after a command that starts work. FreeInk
// and ESPHome wait 10-50 ms for this on the UC8279.
#define BUSY_START_MS 50
// A refresh must pull BUSYN low within this long, and keep it low for at
// least REFRESH_MIN_MS. A six-color pass takes seconds, so a refresh that
// never goes busy, or finishes almost at once, means no panel is driving
// BUSYN (panel unplugged, booster missing, BUSY not wired): the pin's pull-up
// reads "idle" and nothing was drawn. Reported as ESP_ERR_TIMEOUT.
#define REFRESH_START_MS 500
#define REFRESH_MIN_MS 1000
// BUSYN after a reset only stays low for milliseconds.
#define RESET_BUSY_TIMEOUT_MS 5000

// Datasheet p.11: read cycle >= 350 ns, so reads run far slower than writes.
#define READ_CLOCK_HZ 1000000

// Input bytes processed per SPI chunk; each yields IN_CHUNK / 2 output bytes.
#define IN_CHUNK 2048

static spi_device_handle_t s_spi;       // writes, at CONFIG_INKTAG_SPI_CLOCK_HZ
static spi_device_handle_t s_spi_read;  // reads, at READ_CLOCK_HZ
static int8_t s_last_temp = INT8_MIN;
static uint8_t s_panel_id[EPD_PANEL_ID_LEN];
#if CONFIG_INKTAG_TEMP_OVERRIDE
static int8_t s_temp_override = CONFIG_INKTAG_TEMP_OVERRIDE_C;
#else
static int8_t s_temp_override = INT8_MIN;
#endif
static uint8_t s_in[IN_CHUNK];
static DMA_ATTR uint8_t s_out[IN_CHUNK / 2];

// The panel draws six colors in two refreshes of four levels each (2 bpp).
// These tables map a 4-bit panel color to the 2-bit level for each pass,
// exactly as in the vendor code.
static const uint8_t PASS1_MAP[16] = {1, 1, 2, 3, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1};
static const uint8_t PASS2_MAP[16] = {0, 1, 1, 3, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1};

// ---------------------------------------------------------------- bus

// CS is driven by hand so the write and read devices can share it. Each
// command or data block is one CS-low frame; the datasheet's Fig 10-4-2 shows
// several data bytes per frame are allowed.
static esp_err_t spi_tx(const uint8_t *data, size_t len)
{
    spi_transaction_t t = {
        .length = len * 8,
        .tx_buffer = data,
    };
    gpio_set_level(PIN_CS, 0);
    esp_err_t err = spi_device_polling_transmit(s_spi, &t);
    gpio_set_level(PIN_CS, 1);
    return err;
}

static esp_err_t write_cmd(uint8_t cmd)
{
    gpio_set_level(PIN_DC, 0);
    return spi_tx(&cmd, 1);
}

static esp_err_t write_data(const uint8_t *data, size_t len)
{
    gpio_set_level(PIN_DC, 1);
    return spi_tx(data, len);
}

static esp_err_t write_cmd_data(uint8_t cmd, const uint8_t *data, size_t len)
{
    ESP_RETURN_ON_ERROR(write_cmd(cmd), TAG, "cmd 0x%02x", cmd);
    return len ? write_data(data, len) : ESP_OK;
}

#define CMD(c, ...) write_cmd_data((c), (const uint8_t[]){__VA_ARGS__}, \
                                   sizeof((const uint8_t[]){__VA_ARGS__}))

// Reads one byte back over the shared SDA line (CS low, DC high, 8 clocks,
// MSB first), as the vendor code does after command 0x40. The datasheet says
// the serial interface is write-only (p.9) but its timing table has read
// figures (p.11); the vendor code relies on reads working.
static esp_err_t read_byte(uint8_t *out)
{
    gpio_set_level(PIN_DC, 1);
    spi_transaction_t t = {
        .flags = SPI_TRANS_USE_RXDATA,
        .length = 0,
        .rxlength = 8,
    };
    gpio_set_level(PIN_CS, 0);
    esp_err_t err = spi_device_polling_transmit(s_spi_read, &t);
    gpio_set_level(PIN_CS, 1);
    ESP_RETURN_ON_ERROR(err, TAG, "read");
    *out = t.rx_data[0];
    return ESP_OK;
}

// BUSYN is low while the controller is working.
static esp_err_t wait_busy_ms(int timeout_ms)
{
    int waited = 0;
    while (gpio_get_level(PIN_BUSY) == 0) {
        if (waited >= timeout_ms) {
            ESP_LOGE(TAG, "panel busy timeout");
            return ESP_ERR_TIMEOUT;
        }
        vTaskDelay(pdMS_TO_TICKS(10));
        waited += 10;
    }
    return ESP_OK;
}

static esp_err_t wait_busy(void)
{
    return wait_busy_ms(BUSY_TIMEOUT_MS);
}

// For commands that start work (refresh, temperature sensing): BUSYN can take
// a moment to go low, and polling for "not busy" straight away would return
// before the work has begun. Waits up to BUSY_START_MS for it to drop, then
// for it to rise. A command that finishes faster than that costs at most
// BUSY_START_MS.
static esp_err_t wait_busy_started(void)
{
    for (int waited = 0; waited < BUSY_START_MS && gpio_get_level(PIN_BUSY) == 1; waited++) {
        esp_rom_delay_us(1000);
    }
    return wait_busy();
}

// ---------------------------------------------------------------- panel

static esp_err_t panel_reset(void)
{
    gpio_set_level(PIN_RST, 1);
    vTaskDelay(pdMS_TO_TICKS(20));
    gpio_set_level(PIN_RST, 0);
    vTaskDelay(pdMS_TO_TICKS(100));
    gpio_set_level(PIN_RST, 1);
    vTaskDelay(pdMS_TO_TICKS(100));
    return wait_busy_ms(RESET_BUSY_TIMEOUT_MS);
}

static esp_err_t panel_init_regs(void)
{
    // Vendor "scan 3" orientation (UD=1)
    ESP_RETURN_ON_ERROR(CMD(0x00, 0x2B, 0x2A), TAG, "PSR");
    // Window: source 0..791, gate 0..527
    ESP_RETURN_ON_ERROR(CMD(0x83, 0x00, 0x00, 0x03, 0x17, 0x00, 0x00, 0x02, 0x0F, 0x01), TAG, "win");
    ESP_RETURN_ON_ERROR(CMD(0x01, 0x07, 0x00), TAG, "PWR");
    ESP_RETURN_ON_ERROR(CMD(0x03, 0x10, 0x54, 0x44), TAG, "PFS");
    ESP_RETURN_ON_ERROR(CMD(0x06, 0x25, 0x25, 0x3C, 0x17), TAG, "BTST");
    ESP_RETURN_ON_ERROR(CMD(0x30, 0x08), TAG, "PLL");
    ESP_RETURN_ON_ERROR(CMD(0x41, 0x00), TAG, "TSE");
    ESP_RETURN_ON_ERROR(CMD(0x50, 0x37), TAG, "CDI");
    ESP_RETURN_ON_ERROR(CMD(0x62, 0x02, 0x02), TAG, "0x62");
    ESP_RETURN_ON_ERROR(CMD(0xE7, 0x1C), TAG, "0xE7");
    ESP_RETURN_ON_ERROR(CMD(0xE3, 0x22), TAG, "PWS");
    ESP_RETURN_ON_ERROR(CMD(0xE9, 0x01), TAG, "0xE9");
    ESP_RETURN_ON_ERROR(CMD(0xE1, 0x02), TAG, "0xE1");
    return ESP_OK;
}

// Temperature read, as in the vendor code: 0x41 00, then 0x40, wait, read a
// byte. In the UC8179c datasheet 0x41 00 selects the on-chip sensor (0x41 80
// would select an LM75 on TSCL/TSDA), and 0x40 returns signed whole degrees
// C (0x19 = 25, 0xE7 = -25); we assume the UC8279E matches. If the readings
// look wrong, set a fixed temperature (CONFIG_INKTAG_TEMP_OVERRIDE, or the
// BLE TEMP command).
static esp_err_t panel_read_temperature(int8_t *out)
{
    if (s_temp_override != INT8_MIN) {
        *out = s_temp_override;
        ESP_LOGW(TAG, "temperature override: %d C", *out);
        return ESP_OK;
    }
    uint8_t raw;
    ESP_RETURN_ON_ERROR(CMD(0x41, 0x00), TAG, "TSE");
    ESP_RETURN_ON_ERROR(write_cmd(0x40), TAG, "TSC");
    ESP_RETURN_ON_ERROR(wait_busy_started(), TAG, "TSC busy");
    ESP_RETURN_ON_ERROR(read_byte(&raw), TAG, "TSC read");
    ESP_LOGI(TAG, "temperature byte 0x%02x", raw);
    *out = (int8_t)raw;  // 128..255 read as negative
    return ESP_OK;
}

// Values written to 0xE6 before each pass, after 0xE0 02. In the UC8179c
// datasheet 0xE0 bit 1 (TSFIX) makes the controller use a forced temperature
// instead of its sensor, so these are most likely forced temperatures in C
// that select a waveform slot in the panel's OTP: one slot for pass 1, and
// the slot 5 degrees up for pass 2. The vendor buckets leave exactly
// 5 and negative readings unset; as in the Arduino bring-up driver, 5 goes
// to the 6-10 bucket and negatives to the coldest.
static void temperature_codes(int8_t t, uint8_t *pass1, uint8_t *pass2)
{
    if (t < 5)        { *pass1 = 2;  *pass2 = 7; }
    else if (t <= 10) { *pass1 = 12; *pass2 = 17; }
    else if (t <= 20) { *pass1 = 22; *pass2 = 27; }
    else if (t <= 30) { *pass1 = 32; *pass2 = 37; }
    else              { *pass1 = 42; *pass2 = 47; }
}

static esp_err_t force_temperature(uint8_t code)
{
    ESP_RETURN_ON_ERROR(CMD(0xE0, 0x02), TAG, "CCSET");
    ESP_RETURN_ON_ERROR(CMD(0xE6, code), TAG, "TSSET");
    return wait_busy();
}

// Streams one 2 bpp pass (4 pixels per byte) converted from the 4 bpp frame.
static esp_err_t send_pass(const uint8_t map[16], epd_reader_t reader, void *ctx)
{
    ESP_RETURN_ON_ERROR(write_cmd(0x10), TAG, "DTM");
    for (size_t off = 0; off < EPD_FRAME_BYTES; off += IN_CHUNK) {
        size_t n = EPD_FRAME_BYTES - off;
        if (n > IN_CHUNK) {
            n = IN_CHUNK;
        }
        ESP_RETURN_ON_ERROR(reader(ctx, off, s_in, n), TAG, "frame read @%u", (unsigned)off);
        for (size_t i = 0; i < n; i += 2) {
            uint8_t a = s_in[i], b = s_in[i + 1];
            s_out[i / 2] = (map[a >> 4] << 6) | (map[a & 0x0F] << 4) |
                           (map[b >> 4] << 2) | map[b & 0x0F];
        }
        ESP_RETURN_ON_ERROR(write_data(s_out, n / 2), TAG, "DTM data");
    }
    return ESP_OK;
}

static esp_err_t refresh(void)
{
    ESP_RETURN_ON_ERROR(CMD(0x17, 0xA5), TAG, "refresh");
    TickType_t start = xTaskGetTickCount();
    while (gpio_get_level(PIN_BUSY) == 1) {
        if (pdTICKS_TO_MS(xTaskGetTickCount() - start) >= REFRESH_START_MS) {
            ESP_LOGE(TAG, "refresh never started (BUSY stayed high): no panel, "
                          "booster or BUSY wire?");
            return ESP_ERR_TIMEOUT;
        }
        vTaskDelay(1);
    }
    ESP_RETURN_ON_ERROR(wait_busy(), TAG, "refresh busy");
    uint32_t ms = pdTICKS_TO_MS(xTaskGetTickCount() - start);
    ESP_LOGI(TAG, "refresh took %lu ms", (unsigned long)ms);
    if (ms < REFRESH_MIN_MS) {
        ESP_LOGE(TAG, "refresh finished in %lu ms, too fast to be real: "
                      "check the panel and BUSY wire", (unsigned long)ms);
        return ESP_ERR_TIMEOUT;
    }
    return ESP_OK;
}

static esp_err_t panel_sleep(void)
{
    ESP_RETURN_ON_ERROR(write_cmd(0x02), TAG, "POF");  // sleep: DC/DC off, RAM kept (p.8)
    vTaskDelay(pdMS_TO_TICKS(100));
    ESP_RETURN_ON_ERROR(wait_busy(), TAG, "POF busy");
    return CMD(0x07, 0xA5);                              // deep sleep, RAM lost (p.8)
}

// ---------------------------------------------------------------- public

esp_err_t epd_identify(void)
{
    memset(s_panel_id, 0xFF, sizeof(s_panel_id));
    ESP_RETURN_ON_ERROR(panel_reset(), TAG, "reset");
    // Product revision: three bytes read back over SDA, like the temperature.
    // FreeInk's UC8279d driver reads 0x66 as the third byte; the UC8279E's
    // answer isn't documented, so this only tells "something answered" from
    // "nothing there" (a floating or missing panel reads 0xFF or 0x00).
    ESP_RETURN_ON_ERROR(write_cmd(0x70), TAG, "REV");
    for (int i = 0; i < EPD_PANEL_ID_LEN; i++) {
        ESP_RETURN_ON_ERROR(read_byte(&s_panel_id[i]), TAG, "REV read");
    }
    ESP_LOGI(TAG, "panel id %02x %02x %02x", s_panel_id[0], s_panel_id[1], s_panel_id[2]);
    bool all_ff = true, all_00 = true;
    for (int i = 0; i < EPD_PANEL_ID_LEN; i++) {
        all_ff &= s_panel_id[i] == 0xFF;
        all_00 &= s_panel_id[i] == 0x00;
    }
    esp_err_t err = (all_ff || all_00) ? ESP_ERR_NOT_FOUND : ESP_OK;
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "panel didn't answer: check SDA, CS, D/C, RST and the ribbon");
    }
    ESP_RETURN_ON_ERROR(CMD(0x07, 0xA5), TAG, "deep sleep");
    return err;
}

const uint8_t *epd_panel_id(void)
{
    return s_panel_id;
}

esp_err_t epd_init(void)
{
    memset(s_panel_id, 0xFF, sizeof(s_panel_id));
    gpio_config_t out = {
        .pin_bit_mask = (1ULL << PIN_DC) | (1ULL << PIN_RST) | (1ULL << PIN_CS),
        .mode = GPIO_MODE_OUTPUT,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&out), TAG, "gpio out");
    gpio_config_t in = {
        .pin_bit_mask = 1ULL << PIN_BUSY,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&in), TAG, "gpio in");
    gpio_set_level(PIN_RST, 1);
    gpio_set_level(PIN_DC, 1);
    gpio_set_level(PIN_CS, 1);

    spi_bus_config_t bus = {
        .mosi_io_num = PIN_SDA,
        .miso_io_num = -1,
        .sclk_io_num = PIN_SCK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = IN_CHUNK / 2,
    };
    ESP_RETURN_ON_ERROR(spi_bus_initialize(EPD_HOST, &bus, SPI_DMA_CH_AUTO), TAG, "bus");

    // SDA is bidirectional, so the bus runs in 3-wire half-duplex mode;
    // D/C stays a separate GPIO (4-wire protocol, BS pin tied low).
    spi_device_interface_config_t dev = {
        .clock_speed_hz = CONFIG_INKTAG_SPI_CLOCK_HZ,
        .mode = 0,
        .spics_io_num = -1,
        .queue_size = 1,
        .flags = SPI_DEVICE_3WIRE | SPI_DEVICE_HALFDUPLEX,
    };
    ESP_RETURN_ON_ERROR(spi_bus_add_device(EPD_HOST, &dev, &s_spi), TAG, "write dev");
    dev.clock_speed_hz = READ_CLOCK_HZ;
    return spi_bus_add_device(EPD_HOST, &dev, &s_spi_read);
}

static esp_err_t show_passes(epd_reader_t reader, void *ctx)
{
    int8_t temp;
    uint8_t code1, code2;

    ESP_RETURN_ON_ERROR(panel_init_regs(), TAG, "init");
    ESP_RETURN_ON_ERROR(panel_read_temperature(&temp), TAG, "temp");
    s_last_temp = temp;
    temperature_codes(temp, &code1, &code2);
    ESP_LOGI(TAG, "panel %d C, waveform codes %u/%u", temp, code1, code2);

    ESP_RETURN_ON_ERROR(force_temperature(code1), TAG, "temp1");
    ESP_RETURN_ON_ERROR(send_pass(PASS1_MAP, reader, ctx), TAG, "pass1");
    ESP_RETURN_ON_ERROR(refresh(), TAG, "refresh1");

    ESP_RETURN_ON_ERROR(force_temperature(code2), TAG, "temp2");
    ESP_RETURN_ON_ERROR(send_pass(PASS2_MAP, reader, ctx), TAG, "pass2");
    ESP_RETURN_ON_ERROR(refresh(), TAG, "refresh2");
    return ESP_OK;
}

esp_err_t epd_show(epd_reader_t reader, void *ctx)
{
    ESP_RETURN_ON_ERROR(panel_reset(), TAG, "reset");
    esp_err_t err = show_passes(reader, ctx);
    if (err != ESP_OK) {
        // Best effort: don't leave the DC/DC running on a half-done refresh.
        CMD(0x07, 0xA5);
        return err;
    }
    return panel_sleep();
}

static esp_err_t solid_reader(void *ctx, size_t offset, uint8_t *buf, size_t len)
{
    uint8_t c = *(const uint8_t *)ctx;
    memset(buf, (c << 4) | c, len);
    return ESP_OK;
}

esp_err_t epd_clear(uint8_t color)
{
    color &= 0x0F;
    return epd_show(solid_reader, &color);
}

int8_t epd_last_temperature(void)
{
    return s_last_temp;
}

void epd_set_temp_override(int8_t celsius)
{
    if (celsius != INT8_MIN) {
        celsius = celsius < -20 ? -20 : (celsius > 60 ? 60 : celsius);
    }
    s_temp_override = celsius;
    ESP_LOGI(TAG, "temperature override %s (%d)", celsius == INT8_MIN ? "off" : "on", celsius);
}

int8_t epd_get_temp_override(void)
{
    return s_temp_override;
}
