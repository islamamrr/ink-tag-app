# Partial and fast refresh (clock idea)

**Question:** can the badge redraw only part of the screen, or refresh fast, so a
clock could tick?

**Answer: not usefully.**

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
