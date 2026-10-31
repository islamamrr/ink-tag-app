// Native frame format 0x01: 792 × 528 in controller scan order, 4 bits per
// pixel, left pixel in the high nibble. The badge hangs in portrait, so a
// portrait picture (528 × 792) is rotated into scan order while packing.

import { FRAME_BYTES, PANEL_HEIGHT, PANEL_WIDTH } from '../protocol/constants';
import { PALETTE, type PaletteEntry } from './palette';
import { createRgba, type RgbaImage } from './rgba';

/** Portrait picture size: the badge as the wearer sees it. */
export const PORTRAIT_WIDTH = PANEL_HEIGHT; // 528
export const PORTRAIT_HEIGHT = PANEL_WIDTH; // 792

/**
 * How a portrait picture turns into scan order. 'ccw' (90° counter-clockwise,
 * Pillow's ROTATE_90) per PROTOCOL.md. If pictures come out upside down on the
 * real badge, switch to 'cw': it depends on how the panel is mounted.
 */
export type Rotation = 'ccw' | 'cw';
export const PANEL_ROTATION: Rotation = 'ccw';

export type Orientation = 'portrait' | 'landscape';

/**
 * Packs palette indices into a frame. Portrait indices are 528 × 792 and are
 * rotated; landscape indices are already 792 × 528 scan order.
 */
export function packFrame(
  indices: Uint8Array,
  orientation: Orientation = 'portrait',
  rotation: Rotation = PANEL_ROTATION,
  palette: readonly PaletteEntry[] = PALETTE,
): Uint8Array {
  if (indices.length !== PANEL_WIDTH * PANEL_HEIGHT) throw new Error('wrong picture size');
  const codes = Uint8Array.from(palette, (p) => p.code);
  const out = new Uint8Array(FRAME_BYTES);
  const W = PANEL_WIDTH;
  const pw = PORTRAIT_WIDTH;
  const at =
    orientation === 'landscape'
      ? (x: number, y: number) => indices[y * W + x]
      : rotation === 'ccw'
        ? // scan (x, y) shows portrait pixel (pw − 1 − y, x)
          (x: number, y: number) => indices[x * pw + (pw - 1 - y)]
        : // scan (x, y) shows portrait pixel (y, H − 1 − x)
          (x: number, y: number) => indices[(PORTRAIT_HEIGHT - 1 - x) * pw + y];
  let o = 0;
  for (let y = 0; y < PANEL_HEIGHT; y++) {
    for (let x = 0; x < W; x += 2) {
      out[o++] = (codes[at(x, y)] << 4) | codes[at(x + 1, y)];
    }
  }
  return out;
}

/**
 * Decodes a frame into the picture the badge will show, in the measured
 * panel colors. Unknown pixel values draw as white, as on the panel.
 */
export function frameToRgba(
  frame: Uint8Array,
  orientation: Orientation = 'portrait',
  rotation: Rotation = PANEL_ROTATION,
  palette: readonly PaletteEntry[] = PALETTE,
): RgbaImage {
  const white = palette.find((p) => p.name === 'white')!.rgb;
  const lut: [number, number, number][] = Array.from({ length: 16 }, () => white);
  palette.forEach((p) => (lut[p.code] = p.rgb));

  const portrait = orientation === 'portrait';
  const img = portrait
    ? createRgba(PORTRAIT_WIDTH, PORTRAIT_HEIGHT)
    : createRgba(PANEL_WIDTH, PANEL_HEIGHT);
  const pw = PORTRAIT_WIDTH;
  for (let y = 0; y < PANEL_HEIGHT; y++) {
    for (let x = 0; x < PANEL_WIDTH; x++) {
      const byte = frame[(y * PANEL_WIDTH + x) >> 1];
      const code = x & 1 ? byte & 0x0f : byte >> 4;
      let dst: number;
      if (!portrait) dst = y * PANEL_WIDTH + x;
      else if (rotation === 'ccw') dst = x * pw + (pw - 1 - y);
      else dst = (PORTRAIT_HEIGHT - 1 - x) * pw + y;
      const c = lut[code];
      img.data[dst * 4] = c[0];
      img.data[dst * 4 + 1] = c[1];
      img.data[dst * 4 + 2] = c[2];
      img.data[dst * 4 + 3] = 255;
    }
  }
  return img;
}
