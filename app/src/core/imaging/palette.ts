// The six panel colors: measured RGB used to pick colors and draw previews,
// and the code written into the frame. Same values as PALETTE in
// firmware/tools/inktag.py (measured on a Spectra 6 panel). Replace both with
// measurements of our own panel once it runs.

import { Color, type ColorName } from '../protocol/constants';

export interface PaletteEntry {
  name: ColorName;
  rgb: [number, number, number];
  code: number;
}

export const PALETTE: readonly PaletteEntry[] = [
  { name: 'black', rgb: [26, 13, 35], code: Color.black },
  { name: 'white', rgb: [185, 202, 205], code: Color.white },
  { name: 'yellow', rgb: [202, 184, 0], code: Color.yellow },
  { name: 'red', rgb: [121, 9, 0], code: Color.red },
  { name: 'blue', rgb: [0, 69, 139], code: Color.blue },
  { name: 'green', rgb: [40, 82, 57], code: Color.green },
];

// ------------------------------------------------------------ Oklab

/** sRGB byte → linear light, 0..1. */
export const SRGB_TO_LINEAR = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();

/** Writes the Oklab coordinates of an sRGB color (0..255 each) into out[0..2]. */
export function rgbToOklab(r: number, g: number, b: number, out: Float32Array | number[]) {
  const lr = SRGB_TO_LINEAR[r];
  const lg = SRGB_TO_LINEAR[g];
  const lb = SRGB_TO_LINEAR[b];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  out[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}
