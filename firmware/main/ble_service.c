#include "ble_service.h"

#include <stdio.h>
#include <string.h>
#include "esp_log.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include "sdkconfig.h"

#include "protocol.h"

static const char *TAG = "ble";

static const ble_uuid128_t UUID_SERVICE = INKTAG_UUID128(INKTAG_UUID_SERVICE);
static const ble_uuid128_t UUID_CONTROL = INKTAG_UUID128(INKTAG_UUID_CONTROL);
static const ble_uuid128_t UUID_DATA = INKTAG_UUID128(INKTAG_UUID_DATA);

static QueueHandle_t s_events;
static StreamBufferHandle_t s_data;
static uint16_t s_conn = BLE_HS_CONN_HANDLE_NONE;
static uint16_t s_control_handle;
static uint8_t s_own_addr_type;
static char s_name[32];

static void advertise(void);

static void post(ble_evt_type_t type, const uint8_t *data, size_t len)
{
    ble_evt_t ev = {.type = type, .len = len};
    if (len) {
        memcpy(ev.data, data, len);
    }
    if (xQueueSend(s_events, &ev, pdMS_TO_TICKS(100)) != pdTRUE) {
        ESP_LOGW(TAG, "event queue full, dropped event %d", type);
    }
}

static int control_access(uint16_t conn, uint16_t attr, struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    if (ctxt->op != BLE_GATT_ACCESS_OP_WRITE_CHR) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    uint8_t buf[BLE_CMD_MAX];
    uint16_t len = OS_MBUF_PKTLEN(ctxt->om);
    if (len == 0 || len > sizeof(buf)) {
        return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    }
    ble_hs_mbuf_to_flat(ctxt->om, buf, sizeof(buf), &len);
    post(BLE_EVT_COMMAND, buf, len);
    return 0;
}

static int data_access(uint16_t conn, uint16_t attr, struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    if (ctxt->op != BLE_GATT_ACCESS_OP_WRITE_CHR) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    // Copy each mbuf segment straight into the stream buffer. The app task
    // drains it into flash; if it falls behind, the write is reported.
    for (struct os_mbuf *om = ctxt->om; om; om = SLIST_NEXT(om, om_next)) {
        size_t sent = xStreamBufferSend(s_data, om->om_data, om->om_len, pdMS_TO_TICKS(200));
        if (sent != om->om_len) {
            post(BLE_EVT_DATA_OVERFLOW, NULL, 0);
            return BLE_ATT_ERR_PREPARE_QUEUE_FULL;
        }
    }
    return 0;
}

static const struct ble_gatt_svc_def SERVICES[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &UUID_SERVICE.u,
        .characteristics = (struct ble_gatt_chr_def[]){
            {
                .uuid = &UUID_CONTROL.u,
                .access_cb = control_access,
                .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_NOTIFY,
                .val_handle = &s_control_handle,
            },
            {
                .uuid = &UUID_DATA.u,
                .access_cb = data_access,
                .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP,
            },
            {0},
        },
    },
    {0},
};

static int gap_event(struct ble_gap_event *event, void *arg)
{
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        if (event->connect.status == 0) {
            s_conn = event->connect.conn_handle;
            ESP_LOGI(TAG, "connected");
            // Ask for a short interval so uploads go fast; the phone may refuse.
            struct ble_gap_upd_params params = {
                .itvl_min = 6,   // 7.5 ms
                .itvl_max = 12,  // 15 ms
                .latency = 0,
                .supervision_timeout = 400,  // 4 s
            };
            ble_gap_update_params(s_conn, &params);
        } else {
            advertise();
        }
        break;

    case BLE_GAP_EVENT_DISCONNECT:
        ESP_LOGI(TAG, "disconnected (reason 0x%x)", event->disconnect.reason);
        s_conn = BLE_HS_CONN_HANDLE_NONE;
        post(BLE_EVT_DISCONNECTED, NULL, 0);
        advertise();
        break;

    case BLE_GAP_EVENT_ADV_COMPLETE:
        advertise();
        break;

    case BLE_GAP_EVENT_MTU:
        ESP_LOGI(TAG, "mtu %d", event->mtu.value);
        break;

    default:
        break;
    }
    return 0;
}

static void advertise(void)
{
    // Advertising packet: flags + service UUID. Scan response: name.
    struct ble_hs_adv_fields adv = {
        .flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP,
        .uuids128 = &UUID_SERVICE,
        .num_uuids128 = 1,
        .uuids128_is_complete = 1,
    };
    struct ble_hs_adv_fields rsp = {
        .name = (const uint8_t *)s_name,
        .name_len = strlen(s_name),
        .name_is_complete = 1,
    };
    int rc = ble_gap_adv_set_fields(&adv);
    if (rc == 0) {
        rc = ble_gap_adv_rsp_set_fields(&rsp);
    }
    if (rc != 0) {
        ESP_LOGE(TAG, "adv fields: %d", rc);
        return;
    }
    struct ble_gap_adv_params params = {
        .conn_mode = BLE_GAP_CONN_MODE_UND,
        .disc_mode = BLE_GAP_DISC_MODE_GEN,
    };
    rc = ble_gap_adv_start(s_own_addr_type, NULL, BLE_HS_FOREVER, &params, gap_event, NULL);
    if (rc != 0 && rc != BLE_HS_EALREADY) {
        ESP_LOGE(TAG, "adv start: %d", rc);
    }
}

static void on_sync(void)
{
    ble_hs_util_ensure_addr(0);
    ble_hs_id_infer_auto(0, &s_own_addr_type);

    uint8_t addr[6] = {0};
    ble_hs_id_copy_addr(s_own_addr_type, addr, NULL);
    snprintf(s_name, sizeof(s_name), "%s-%02X%02X", CONFIG_INKTAG_DEVICE_NAME_PREFIX, addr[1], addr[0]);
    ble_svc_gap_device_name_set(s_name);
    ESP_LOGI(TAG, "advertising as %s", s_name);
    advertise();
}

static void on_reset(int reason)
{
    ESP_LOGW(TAG, "host reset, reason %d", reason);
}

static void host_task(void *param)
{
    nimble_port_run();
    nimble_port_freertos_deinit();
}

esp_err_t ble_service_start(QueueHandle_t events, StreamBufferHandle_t data)
{
    s_events = events;
    s_data = data;

    esp_err_t err = nimble_port_init();
    if (err != ESP_OK) {
        return err;
    }
    ble_hs_cfg.sync_cb = on_sync;
    ble_hs_cfg.reset_cb = on_reset;

    ble_svc_gap_init();
    ble_svc_gatt_init();
    int rc = ble_gatts_count_cfg(SERVICES);
    if (rc == 0) {
        rc = ble_gatts_add_svcs(SERVICES);
    }
    if (rc != 0) {
        ESP_LOGE(TAG, "gatt setup: %d", rc);
        return ESP_FAIL;
    }
    nimble_port_freertos_init(host_task);
    return ESP_OK;
}

void ble_service_notify(const void *payload, size_t len)
{
    if (s_conn == BLE_HS_CONN_HANDLE_NONE) {
        return;
    }
    struct os_mbuf *om = ble_hs_mbuf_from_flat(payload, len);
    if (om) {
        ble_gatts_notify_custom(s_conn, s_control_handle, om);
    }
}
