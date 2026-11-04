# Getting started: ESP32-C3 SuperMini + TWE0368NW58 panel

Seven steps from the parts on your desk to a photo on the badge. Each step ends with how to tell it worked.

## Step 1: Buy the missing parts

The panel is a bare 24-pin ribbon (FPC). It needs a small booster circuit that makes the ±15–20 V it runs on: about 15 parts from the datasheet's application circuit (page 16). You build that circuit yourself. The full parts list, schematic and pin-by-pin connections are in [BOOSTER.md](../../hardware/booster/BOOSTER.md).

| What | Notes |
|---|---|
| The booster parts | Everything in the BOOSTER.md parts list. The "easier to hand-solder" column is all through-hole except the MOSFET. |
| 24-pin 0.5 mm FPC breakout board | Just the ribbon socket on a small board with 2.54 mm pins. No other circuitry. |
| SOT-23-to-DIP breakout | For the AO3400A MOSFET. |
| Perfboard, hookup wire, soldering iron, multimeter | The booster goes on the perfboard next to the FPC breakout. |
| USB-C **data** cable | For flashing and power. |

**Worked when:** you have every part in the list.

## Step 2: Build the booster board

Follow [BOOSTER.md](../../hardware/booster/BOOSTER.md):

1. Solder the FPC breakout and the booster parts onto one perfboard, keeping the booster as close to the FPC socket as you can.
2. Wire every panel pin as in its *Every J1 pin* table: the booster parts, the capacitors to GND, BS to GND, and leave the NC/TSCL/TSDA/VPP pins unconnected.
3. Bring out 8 wires for the SuperMini: 3.3 V, GND, and the six signal pins (9–14).
4. With nothing powered, check with a multimeter that 3.3 V and GND are not shorted, and that R2 reads about 1.1 Ω. Check the three diodes face the way BOOSTER.md says.

**Worked when:** the board passes the multimeter checks.

## Step 3: Plug in the panel

With nothing powered:

1. Open the FPC socket's latch (it flips up or slides out).
2. Slide the panel's ribbon in all the way, with the gold contacts facing the socket's contacts.
3. Close the latch. The ribbon should not pull out with a gentle tug.

Handle the panel by its edges. The glass is thin and the ribbon tears easily where it meets the glass, so don't bend it there.

## Step 4: Wire the booster board to the SuperMini

| Booster board (panel pin) | SuperMini pin |
|---|---|
| 3.3 V (pins 15, 16) | 3V3 |
| GND (pin 17) | GND |
| SCL (13) | GPIO 4 |
| SDA (14) | GPIO 6 |
| CSB (12) | GPIO 7 |
| D/C (11) | GPIO 5 |
| RSTN (10) | GPIO 10 |
| BUSYN (9) | GPIO 3 |

Use 3.3 V only, never 5 V. Double-check every wire; a swapped wire is the most common reason it won't work.

**Worked when:** all 8 wires are connected and match the table.

## Step 5: Flash the firmware from your browser

No software install is needed for this step.

1. Download [prebuilt/inktag-esp32c3.bin](../prebuilt/inktag-esp32c3.bin) to your computer.
2. In **Chrome or Edge** (Safari and Firefox can't do this), open **https://espressif.github.io/esptool-js/**.
3. Plug in the SuperMini. Set the baud rate to 460800 and click **Connect**. Pick the port named "USB JTAG/serial debug unit" or similar.
   - If no port shows up or it won't connect: unplug, **hold the BOOT button**, plug back in, release BOOT, and try again.
4. Under *Program*, set the flash address to **0x0**, choose the downloaded file and click **Program**. Wait for it to finish.
5. Press the **RESET** button on the SuperMini (or unplug and replug it).

**Worked when:** the page says the flash finished without errors.

## Step 6: Check the panel works

Right after reset, the firmware draws six color bands: **black, white, yellow, red, blue, green**. A six-color refresh is slow, so expect the panel to flicker for roughly half a minute to a minute before the bands settle. This test pattern shows on every boot until you send your first picture.

To see what the firmware is doing, open the **Console** tab on the same esptool-js page and connect at 115200. A healthy boot shows lines like:

```
store: partition 256 KB, stored image: no
epd: panel id xx xx xx
ble: advertising as InkTag-1A2B
inktag: no stored image, drawing test pattern
epd: temperature byte 0x18
epd: panel 24 C, waveform codes 32/37
epd: refresh took 15000 ms
epd: refresh took 15000 ms
inktag: test pattern drawn
```

| What you see | Likely cause |
|---|---|
| `panel busy timeout` | BUSY or RST wire wrong, ribbon not seated, or 3.3 V missing on the booster board. Recheck steps 3 and 4. |
| `refresh never started` or `refresh finished in N ms, too fast to be real`, then `test pattern NOT drawn` | The controller never pulled BUSY low, so nothing was drawn: panel not on the ribbon, booster missing or unpowered, or the BUSY wire. Firmware 0.3.1+; this is what a bare board shows. |
| Panel never flickers, no timeout | SCL, SDA, CS or D/C wire wrong, or BS (pin 8) not tied to GND. |
| Panel flickers but stays blank or the colors are faint | The booster isn't reaching its voltages. Measure VGH and VGL as described at the end of BOOSTER.md. |
| Bands in the wrong colors or garbled | Tell me what you see. It may be a driver detail I need to fix. |
| `temperature byte 0x00` or `0xff` | Most likely the SDA wire: the temperature is read back over it from the controller's own sensor. Tell me and I'll send a build with a fixed temperature. |
| `panel didn't answer` (panel id all `ff` or all `00`) | SDA, CS, D/C or RST wire, or the ribbon. Firmware 0.3+ only, and still a hint: the test pattern is drawn anyway, so check whether the bands appear. |

**Worked when:** you see the six clean bands. Send me a photo of the panel either way.

## Step 7: Send a picture from your laptop

This tests the Bluetooth upload before the phone app exists.

1. Install Python 3 (python.org) if you don't have it.
2. In a terminal: `pip install pillow bleak`
3. Download [tools/inktag.py](../tools/inktag.py).
4. With the badge powered and the laptop's Bluetooth on:
   ```
   python inktag.py info
   python inktag.py send yourphoto.jpg --preview preview.png
   ```
   `info` should print the firmware version and `stored image: no`. `send` converts the photo (open `preview.png` to see what it will look like), uploads it in a few seconds, then waits for the panel to refresh.

If the picture comes out upside down, tell me and I'll flip the rotation.

**Worked when:** your photo is on the badge. Unplug it: the picture stays. Plug it back in: it no longer shows the test pattern.

## After this

Once step 7 works, the hardware and firmware basics are proven. From there we can build the phone app, which speaks the protocol in [PROTOCOL.md](PROTOCOL.md), and go through the features list: battery and sleep, pairing, faster uploads.
