// BLE peripheral exposing the Ink Tag GATT service (see protocol.h).
#pragma once

#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/stream_buffer.h"

#define BLE_CMD_MAX 24  // AUTH and LOCK are 17 bytes

typedef enum {
    BLE_EVT_COMMAND,      // control characteristic write
    BLE_EVT_DISCONNECTED,
    BLE_EVT_DATA_OVERFLOW,
} ble_evt_type_t;

typedef struct {
    ble_evt_type_t type;
    uint8_t len;
    uint8_t data[BLE_CMD_MAX];
} ble_evt_t;

// Control writes and connection events go to `events`; image bytes written
// to the data characteristic go to `data`, in order.
esp_err_t ble_service_start(QueueHandle_t events, StreamBufferHandle_t data);

// Sends a notification on the control characteristic (dropped if nobody is
// connected or subscribed).
void ble_service_notify(const void *payload, size_t len);
