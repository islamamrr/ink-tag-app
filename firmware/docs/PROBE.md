# Custom-waveform probe (firmware 0.6, experimental)

The panel's own waveforms take about 18 s per box (measured 11 Nov: 18.3 s + 1.3 s at 22 °C), and Topwin says there is no fast or black/white mode. The only way to something faster is our own waveform, loaded into the controller's LUT registers. Nobody has documented those registers for the UC8279E, so this probe finds out step by step, on one small box.

## How the risk is kept inside the box

- **The window.** The 0.5 window test showed that a refresh only drives the box. The probe refuses boxes over 128 × 128 and always sends box-only data.
- **VCOM held at ground.** VCOM (register `0x20`) is the electrode shared by every pixel. If it moved, every pixel on the panel would see a voltage, inside the box or not. The tool always loads it with level 0 for the whole waveform.
- **No voltage changes.** The firmware only accepts LUT registers (`0x20`–`0x2F`), PSR (`0x00`) and CDI (`0x50`). It can't touch the power, booster or voltage settings, so the chip and the booster board stay safe.
- **A charge ledger.** Ink that's pushed more one way than the other keeps a charge, which shows up as a stain that won't clear. `tools/probe_ledger.json` adds up every push per box, and the tool tells you how to balance it.

The worst realistic outcome is a stained 32 × 32 square in one corner. Use a spare panel if you have one.

## Before you start

1. Flash firmware 0.6.0 and check `python inktag.py info` says 0.6.0.
2. `python inktag.py clear white` so the probe box starts white.
3. The default box is 32 × 32 at x 752, y 488 in the native frame (a corner, away from the middle seam). Find it once with `python inktag.py window 752 488 32 32 black` and note where it lands, then `clear white` again.

Look at the panel during every run, and note the busy time the tool prints.

## Step 1: does the controller use our LUT? (no risk)

`zero` loads a waveform that drives nothing (ground for 10 frames). The picture data asks for a black box, so:

- **Box stays white, busy time far below 18 s:** the controller ran our waveform. Go to step 2.
- **Box turns black in about 18 s:** it ignored the registers and ran its own waveform. Try the variants below, one at a time, with `clear white` between them.

```
python inktag.py probe zero
python inktag.py probe zero --drf               # PON + DRF instead of the AUTO refresh
python inktag.py probe zero --psr "0B 2A"       # PSR bit 5 off
python inktag.py probe zero --psr "3B 2A"       # PSR bit 4 on
python inktag.py probe zero --lut-len 49        # longer register layout
```

If none of them stays white, the UC8279E doesn't take register LUTs this way, and we stop here. Nothing has been driven, so there's nothing to undo.

## Step 2: balanced pulse (low risk)

`pulse N` drives the box one way for N frames, then the other way for N frames. The net charge is zero.

```
python inktag.py probe pulse 10
python inktag.py probe pulse 30
```

Look for a flicker in the box only. The box should end close to where it started. Note the busy time: busy ms ÷ (2 × N) is roughly the frame time. If nothing flickers at 30, try `--lut-len 49` or `--drf` (whatever worked in step 1).

## Step 3: one-way pushes (moderate risk)

Now push the box one way, then back by the same amount:

```
python inktag.py probe push 20 --dir a
python inktag.py probe push 20 --dir b
```

Note which direction turns the box darker and which turns it lighter. Then shorten the push to find the fastest one that still gives a solid result: 20, 10, 5. Always run the matching opposite push straight after. `python inktag.py probe ledger` shows the net charge per box; it should be 0 when you stop.

Stop and tell me if:

- the box looks blue, red or yellow instead of black or white (the colour particles moved, and that needs a different waveform shape);
- anything outside the box changes;
- after `python inktag.py clear white`, twice, a faint square is still visible.

## Clean-up

`python inktag.py clear white` runs the factory waveform over the whole panel. The custom registers are only loaded for a probe run. The controller is reset before every normal refresh, so pictures always use the factory waveform.
