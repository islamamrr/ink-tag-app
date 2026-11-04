idf_component_register(
    SRCS "main.c" "epd_uc8279.c" "image_store.c" "ble_service.c" "lock.c"
    INCLUDE_DIRS "."
    PRIV_REQUIRES bt nvs_flash esp_driver_spi esp_driver_gpio esp_partition esp_rom mbedtls
)
