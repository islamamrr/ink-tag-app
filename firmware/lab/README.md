# Lab builds

Experimental firmware for the bench, flashed over USB. It is deliberately outside `prebuilt/`, which the app's bundle script reads, so a lab build can't reach the app's wireless updates by accident.

| File | What |
|---|---|
| `inktag-esp32c3-lab.bin` | Firmware 0.6.1 plus the custom-waveform probe and the early-stop test, for the ESP32-C3 SuperMini. Flash at 0x0: `python -m esptool --chip esp32c3 -p COMx write_flash 0x0 inktag-esp32c3-lab.bin` |

Bench steps: [PROBE.md](../docs/PROBE.md) and [EARLYSTOP.md](../docs/EARLYSTOP.md).
