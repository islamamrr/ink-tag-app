# Dithering and tone mapping for photos

**Problem:** realistic photos look washed out on the six-colour panel. The panel's
white is light grey (185, 202, 205) and its black is dark purple (26, 13, 35), so a
photo drawn as is spends its light tones on grey dots.

## Looks tried (app: `app/src/core/imaging/look.ts`)

| Look | What it does |
|---|---|
| today | the picture as given (the old behaviour) |
| boost | contrast 1.15, saturation 1.4, in Oklab |
| strong | contrast 1.1, saturation 1.8 |
| fit | squeezes brightness into the panel's black to white range, saturation 1.5 |
| fit-curve | fit, plus a gentle S-curve and dither error carried in Oklab |

## Results on the real panel (astronaut photo, 2026-11-18)

- **A-D** (`quad_astronaut.png`): **boost (B) looked best.** The "fit" looks, which
  looked good on screen, looked flatter on the tag.
- **E-H round** (Islam's laptop session): B as reference against a stronger look with
  sharpening (E), Jarvis + Oklab error (F), and fewer white dots with 85% error (G).
  Result: pending; H (a brighter palette) not yet sent.

## Options now in the app's test screen

Look, Dither (Floyd-Steinberg, Atkinson, Jarvis, Stucki, Sierra, Burkes, none), Error
space (auto, sRGB, Oklab), Less white (0 to 0.01), Sharpen (0 to 1). Remove the ones that
lose once more photos are tested.

## Files

- `quad_astronaut.png`, `quad_chelsea.png`: 528 x 792, one photo four times labelled
  A to D. Send with `python firmware/tools/inktag.py send research/dithering/quad_astronaut.png`.
- `prototype.js`, `variants.json`: the Node prototype that made the comparison sheets.
