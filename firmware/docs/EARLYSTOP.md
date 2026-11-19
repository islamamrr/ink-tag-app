# Early-stop test (lab build, experimental)

Question: the panel shows changes from the first second of a refresh. If we cut the refresh short, is what's left good enough for a to-do tick, and what does it cost?

`stop` starts the normal pass 1 of a box refresh (the 18 s part), stops it after `--ms`, then runs the short pass 2 so the box can settle (skip that with `--no-pass2`). Nothing outside the box is written.

```
python inktag.py clear white
python inktag.py stop 40 200 64 64 black --ms 2000
python inktag.py stop 40 280 64 64 black --ms 4000
python inktag.py stop 40 360 64 64 black --ms 6000
python inktag.py stop 40 440 64 64 black --ms 8000
```

Use a different box for each run so you can compare them in one photo. Add `--method reset` to stop with a hardware reset instead of power-off (the controller may ignore power-off while it is driving), and `--no-pass2` to see the raw cut-short state.

## What to note

- The printed stop time, and whether the tool says the refresh had already ended.
- How dark the box is, and whether it's a clean grey or blotchy. Compare with a normal `window` box.
- Whether anything outside the box moved.

## Afterwards (the cost)

1. `python inktag.py clear white` runs the full factory waveform over the panel. Photograph the boxes before and after.
2. If a faint square is still visible after two `clear white` runs, stop and tell me. That means the ink is holding charge, and we drop the idea.
3. Don't repeat the same box more than a few times in one session. The factory waveform pushes the ink in equal amounts each way, and stopping it early breaks that balance for the pixels in the box.
