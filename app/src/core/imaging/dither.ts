// Six-color dithering. Error is diffused in sRGB, like most ditherers and
// Pillow; the nearest panel color is chosen in Oklab by default, which keeps
// skin and skies from tipping into green or red.

import { PALETTE, rgbToOklab, type PaletteEntry } from './palette';
import type { RgbaImage } from './rgba';

export type DitherMethod =
  | 'floyd-steinberg'
  | 'atkinson'
  | 'jarvis'
  | 'stucki'
  | 'sierra'
  | 'burkes'
  | 'none';
export type ColorMetric = 'oklab' | 'rgb';
/** Where the rounding error is carried to the next pixels. */
export type ErrorSpace = 'srgb' | 'oklab';

export interface DitherOptions {
  method?: DitherMethod;
  metric?: ColorMetric;
  /** Alternate row direction (Floyd–Steinberg); avoids diagonal "worms". */
  serpentine?: boolean;
  /** 'oklab' carries error in perceptual lightness/colour: smoother tones, fewer stray dots. */
  errorSpace?: ErrorSpace;
  /**
   * Extra distance (Oklab, squared) charged for choosing white: 0 is off, ~0.002 uses
   * white a little less in coloured areas, ~0.01 a lot less. Stops colours being
   * diluted by white speckle at the price of slightly darker midtones.
   */
  whitePenalty?: number;
  palette?: readonly PaletteEntry[];
}

/** One tap of an error-diffusion kernel: dx, dy, weight. */
type Kernel = readonly (readonly [number, number, number])[];

const kernel = (taps: number[][], div: number): Kernel => taps.map(([dx, dy, w]) => [dx, dy, w / div]);

const KERNELS: Record<Exclude<DitherMethod, 'none'>, Kernel> = {
  'floyd-steinberg': [
    [1, 0, 7 / 16],
    [-1, 1, 3 / 16],
    [0, 1, 5 / 16],
    [1, 1, 1 / 16],
  ],
  // Wider kernels: smoother and less noisy, softer fine detail.
  jarvis: kernel(
    [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]],
    48,
  ),
  stucki: kernel(
    [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]],
    42,
  ),
  sierra: kernel(
    [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]],
    32,
  ),
  burkes: kernel([[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]], 32),
  // Spreads only 6/8 of the error: crisper, good for graphics and text.
  atkinson: [
    [1, 0, 1 / 8],
    [2, 0, 1 / 8],
    [-1, 1, 1 / 8],
    [0, 1, 1 / 8],
    [1, 1, 1 / 8],
    [0, 2, 1 / 8],
  ],
};

/** Returns one palette index per pixel, rows top to bottom. */
export function dither(img: RgbaImage, opts: DitherOptions = {}): Uint8Array {
  const {
    method = 'floyd-steinberg',
    metric = 'oklab',
    serpentine = true,
    errorSpace = 'srgb',
    whitePenalty = 0,
    palette = PALETTE,
  } = opts;
  const { width: w, height: h, data } = img;
  const nearest = makeNearest(palette, metric, metric === 'oklab' ? whitePenalty : 0);
  const out = new Uint8Array(w * h);

  if (method === 'none') {
    for (let i = 0; i < w * h; i++) out[i] = nearest(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    return out;
  }

  if (errorSpace === 'oklab') return ditherOklab(img, KERNELS[method], serpentine && method !== 'atkinson', palette, whitePenalty);

  const kernel = KERNELS[method];
  const buf = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    buf[i * 3] = data[i * 4];
    buf[i * 3 + 1] = data[i * 4 + 1];
    buf[i * 3 + 2] = data[i * 4 + 2];
  }
  const pr = palette.map((p) => p.rgb[0]);
  const pg = palette.map((p) => p.rgb[1]);
  const pb = palette.map((p) => p.rgb[2]);
  const snake = serpentine && method !== 'atkinson';

  for (let y = 0; y < h; y++) {
    const rtl = snake && (y & 1) === 1;
    const dir = rtl ? -1 : 1;
    for (let n = 0; n < w; n++) {
      const x = rtl ? w - 1 - n : n;
      const i = y * w + x;
      const r = clampByte(buf[i * 3]);
      const g = clampByte(buf[i * 3 + 1]);
      const b = clampByte(buf[i * 3 + 2]);
      const k = nearest(r, g, b);
      out[i] = k;
      const er = r - pr[k];
      const eg = g - pg[k];
      const eb = b - pb[k];
      for (let t = 0; t < kernel.length; t++) {
        const [dx, dy, wt] = kernel[t];
        const nx = x + dx * dir;
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny >= h) continue;
        const j = (ny * w + nx) * 3;
        buf[j] += er * wt;
        buf[j + 1] += eg * wt;
        buf[j + 2] += eb * wt;
      }
    }
  }
  return out;
}

/** Same diffusion, but the running error lives in Oklab (L, a, b). */
function ditherOklab(
  img: RgbaImage,
  kernel: Kernel,
  snake: boolean,
  palette: readonly PaletteEntry[],
  whitePenalty: number,
): Uint8Array {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(w * h);
  const buf = new Float32Array(w * h * 3);
  const tmp = new Float32Array(3);
  for (let i = 0; i < w * h; i++) {
    rgbToOklab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], tmp);
    buf.set(tmp, i * 3);
  }
  const ref = new Float32Array(palette.length * 3);
  palette.forEach((p, k) => {
    rgbToOklab(p.rgb[0], p.rgb[1], p.rgb[2], tmp);
    ref.set(tmp, k * 3);
  });
  for (let y = 0; y < h; y++) {
    const rtl = snake && (y & 1) === 1;
    const dir = rtl ? -1 : 1;
    for (let n = 0; n < w; n++) {
      const x = rtl ? w - 1 - n : n;
      const i = y * w + x;
      const L = Math.min(1, Math.max(0, buf[i * 3]));
      const A = Math.min(0.5, Math.max(-0.5, buf[i * 3 + 1]));
      const B = Math.min(0.5, Math.max(-0.5, buf[i * 3 + 2]));
      let k = 0;
      let bestD = Infinity;
      for (let c = 0; c < palette.length; c++) {
        const d0 = L - ref[c * 3];
        const d1 = A - ref[c * 3 + 1];
        const d2 = B - ref[c * 3 + 2];
        const d = d0 * d0 + d1 * d1 + d2 * d2 + (palette[c].name === 'white' ? whitePenalty : 0);
        if (d < bestD) {
          bestD = d;
          k = c;
        }
      }
      out[i] = k;
      const e0 = L - ref[k * 3];
      const e1 = A - ref[k * 3 + 1];
      const e2 = B - ref[k * 3 + 2];
      for (let t = 0; t < kernel.length; t++) {
        const [dx, dy, wt] = kernel[t];
        const nx = x + dx * dir;
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny >= h) continue;
        const j = (ny * w + nx) * 3;
        buf[j] += e0 * wt;
        buf[j + 1] += e1 * wt;
        buf[j + 2] += e2 * wt;
      }
    }
  }
  return out;
}

const clampByte = (v: number) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

/** Nearest palette index for an sRGB byte triple, memoised per color. */
function makeNearest(palette: readonly PaletteEntry[], metric: ColorMetric, whitePenalty = 0) {
  const n = palette.length;
  const ref = new Float32Array(n * 3);
  const tmp = new Float32Array(3);
  palette.forEach((p, k) => {
    if (metric === 'oklab') rgbToOklab(p.rgb[0], p.rgb[1], p.rgb[2], tmp);
    else tmp.set(p.rgb);
    ref.set(tmp, k * 3);
  });
  // 2^24 colors × 1 byte would be 16 MB; a 15-bit-keyed cache is plenty
  // for photos while staying exact (it stores the full key to check hits).
  const CACHE_BITS = 16;
  const keys = new Int32Array(1 << CACHE_BITS).fill(-1);
  const vals = new Uint8Array(1 << CACHE_BITS);

  return (r: number, g: number, b: number): number => {
    const key = (r << 16) | (g << 8) | b;
    const slot = ((key * 2654435761) >>> (32 - CACHE_BITS)) & ((1 << CACHE_BITS) - 1);
    if (keys[slot] === key) return vals[slot];
    let c0: number;
    let c1: number;
    let c2: number;
    if (metric === 'oklab') {
      rgbToOklab(r, g, b, tmp);
      c0 = tmp[0];
      c1 = tmp[1];
      c2 = tmp[2];
    } else {
      c0 = r;
      c1 = g;
      c2 = b;
    }
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < n; k++) {
      const d0 = c0 - ref[k * 3];
      const d1 = c1 - ref[k * 3 + 1];
      const d2 = c2 - ref[k * 3 + 2];
      const d = d0 * d0 + d1 * d1 + d2 * d2 + (palette[k].name === 'white' ? whitePenalty : 0);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    keys[slot] = key;
    vals[slot] = best;
    return best;
  };
}

/** Share of each palette entry in an index image, 0..1. */
export function colorShares(indices: Uint8Array, palette: readonly PaletteEntry[] = PALETTE) {
  const counts = new Array<number>(palette.length).fill(0);
  for (let i = 0; i < indices.length; i++) counts[indices[i]]++;
  return Object.fromEntries(palette.map((p, k) => [p.name, counts[k] / indices.length])) as Record<
    PaletteEntry['name'],
    number
  >;
}
