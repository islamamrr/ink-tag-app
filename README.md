# Ink Tag

A small six-color e-ink badge (ESP32-C3 + 3.68" Spectra 6 panel) and the phone app that sends it pictures over Bluetooth LE.

| Folder | What |
|---|---|
| `firmware/` | ESP-IDF firmware for the badge. Protocol spec: `firmware/docs/PROTOCOL.md` |
| `app/` | React Native (Expo) phone app. See `app/README.md` |
| `devtool/` | Python desktop tool for testing the badge over BLE and serial |
| `hardware/` | Hardware notes (booster circuit) |
