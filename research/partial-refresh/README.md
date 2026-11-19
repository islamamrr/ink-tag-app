# Partial and fast refresh (clock idea)

**Question:** can the badge redraw only part of the screen, or refresh fast, so a
clock could tick?

**Answer: not usefully for a clock, but a quick "tick" is possible (see the early-stop section below).**

- **Partial refresh works** with the UC8279E window register (`0x83`: source start/end,
  gate start/end, flag `01`) and the normal refresh command (`0x17 A5`). Only the box
  changes, but it still takes the full six-colour waveform: about 18.3 s for the first
  pass plus 1.3 s for the second.
- **Seam:** a faint line shows where the box crosses x = 396 on the 792-pixel side.
- **Border:** a very thin border around the box flashes during the refresh.
- **No fast mode:** forcing other waveform codes (`0xE6`) and temperature codes
  (`0xE0 02`) changed nothing visible. The panel vendor (Topwin) confirmed the panel
  has no fast refresh and no black-and-white refresh.
- **Temperature and colour:** forcing the temperature code did not change colours.
  White looks light grey because that is how this panel is.

**Decision:** the clock feature was dropped.

## What is still in the repo

- Firmware 0.5.0, command `WINDOW` (0x0B): `firmware/docs/PROTOCOL.md`.
- `python firmware/tools/inktag.py window ...` and `temp ...`.
- Devtool "Window test" box and simulator support.

If a future panel or controller supports a fast waveform, start from the same command.

## Early stop: a 1.8 s tick (lab build, 19 Nov 2026)

Idea: start the normal refresh of one small box, cut pass 1 short, then run pass 2.
Tested with the lab build (`firmware/lab/`, `inktag.py stop`), on one panel at 24 C,
judged by eye; colour does not matter for a tick, only how dark and how fast.

| Cut of pass 1 | Stop method | Result |
|---|---|---|
| 2 s | power-off (POF) | box flashed then went white; controller stayed busy 60 s until reset. Do not use. |
| 4 s | hardware reset | dark, reddish |
| 6 s | hardware reset | near-black |
| 8 s | hardware reset | darker, bluish |
| 2 s | reset | dark red |
| 1 s | reset | similar to 2 s |
| 0.5 s | reset | nearly as dark |
| 2 s, no pass 2 | reset | dark blue, fades to light blue within about 2 s, then stays |

- Pass 2 (1.3 s) is what holds the image, so a tick is **0.5 s + 1.3 s = about 1.8 s**,
  against about 20 s for a normal refresh.
- Nothing outside the box changed. No ghost after two `clear white` runs.
- **Stress test:** 25 tick/untick cycles (50 cuts of 0.5 s) on one 16x16 box left no
  residue.
- Not yet tested: other temperatures, hundreds of cycles, a bigger box, a real timer
  (planned: tick/untick every 5 minutes).
- The box positions we named did not match where boxes appeared, so the native frame
  mapping must be sorted out before this goes in the product.

## Custom waveform (dead end for now)

Loading our own LUT registers (`probe zero|pulse|push`): the controller accepts them
but does not run them as a waveform. Busy time was 18.27 s for 0, 10, 20 and 30
frames, nothing changed visibly, and the ledger stayed balanced at 0.

## Next steps (to-do tick)

1. Run the 5-minute timer test and keep it going for an hour.
2. Fix the position mapping between our x/y and the panel.
3. Test other temperatures and a larger box.
4. Build the tick into the main firmware as a normal command, with the reset-based
   stop and a limit per box.
5. Wire it to the side button and the to-do list in the app.
