# Research notes

Experiments on the Spectra 6 panel (UC8279E) that are not part of the product but
that later work should be able to look back on. Each folder says what was tried,
what happened on the real panel, and what is left to try.

- [partial-refresh/](partial-refresh/README.md): can the panel redraw only a box
  (for a clock) or refresh fast? Result: partial works, ~20 s, no fast mode.
- [dithering/](dithering/README.md): making photos look less washed out on six
  colours. Includes the A-D comparison pictures and the prototype script.

The firmware command behind the partial-refresh tests (`WINDOW`, 0x0B, firmware
0.5) stays in the firmware, with its `window` and `temp` subcommands in
`firmware/tools/inktag.py` and a box in the devtool. It is a development command;
nothing in the app uses it.
