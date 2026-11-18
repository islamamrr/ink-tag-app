// Four looks of one photo on one screen, labelled A to D, for judging them on
// the real panel. Each quarter is 264 × 396 and is dithered on its own.

import { crc32 } from '../protocol/crc32';
import { colorShares, dither } from './dither';
import { frameToRgba, packFrame, PORTRAIT_HEIGHT, PORTRAIT_WIDTH } from './frame';
import { applyLook, COMPARE_LOOKS, lookDither } from './look';
import type { Converted } from './pipeline';
import type { RgbaImage } from './rgba';

export const QUAD_WIDTH = PORTRAIT_WIDTH / 2;
export const QUAD_HEIGHT = PORTRAIT_HEIGHT / 2;

const BLACK = 0;
const WHITE = 1;

// 5 × 7 letters, one row per string.
const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
};

/** Draws a white badge with a black letter at the quarter's top-left corner. */
function stamp(idx: Uint8Array, stride: number, ox: number, oy: number, letter: string) {
  const s = 6;
  const g = GLYPHS[letter];
  const pad = 6;
  for (let y = 0; y < 7 * s + 2 * pad; y++)
    for (let x = 0; x < 5 * s + 2 * pad; x++) {
      const gx = Math.floor((x - pad) / s);
      const gy = Math.floor((y - pad) / s);
      const on = gx >= 0 && gx < 5 && gy >= 0 && gy < 7 && g[gy][gx] === '1';
      idx[(oy + 4 + y) * stride + ox + 4 + x] = on ? BLACK : WHITE;
    }
}

/**
 * `img` is one 264 × 396 picture; the result is a full portrait frame with
 * the looks A (today), B, C, D in reading order.
 */
export function convertCompare(img: RgbaImage): Converted {
  if (img.width !== QUAD_WIDTH || img.height !== QUAD_HEIGHT)
    throw new Error(`expected ${QUAD_WIDTH}×${QUAD_HEIGHT}, got ${img.width}×${img.height}`);
  const t0 = Date.now();
  const full = new Uint8Array(PORTRAIT_WIDTH * PORTRAIT_HEIGHT);
  COMPARE_LOOKS.forEach((look, n) => {
    const ox = (n % 2) * QUAD_WIDTH;
    const oy = Math.floor(n / 2) * QUAD_HEIGHT;
    const part = dither(applyLook(img, look), lookDither(look));
    for (let y = 0; y < QUAD_HEIGHT; y++)
      full.set(part.subarray(y * QUAD_WIDTH, (y + 1) * QUAD_WIDTH), (oy + y) * PORTRAIT_WIDTH + ox);
    stamp(full, PORTRAIT_WIDTH, ox, oy, 'ABCD'[n]);
  });
  const tDither = Date.now() - t0;
  const frame = packFrame(full);
  return {
    frame,
    crc32: crc32(frame),
    preview: frameToRgba(frame),
    shares: colorShares(full),
    timings: { tone: 0, dither: tDither, pack: 0, preview: 0 },
  };
}
