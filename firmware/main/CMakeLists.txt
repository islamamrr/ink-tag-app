idf_component_register(
    SRCS "main.c" "epd_uc8279.c" "image_store.c" "ble_service.c" "lock.c" "ota_update.c"
    INCLUDE_DIRS "."
    PRIV_REQUIRES bt nvs_flash esp_driver_spi esp_driver_gpio esp_partition esp_rom esp_timer mbedtls app_update esp_app_format
)
