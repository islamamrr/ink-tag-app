// Fitting a picture into the badge. On the phone, Skia draws the source rect
// into the destination rect of an offscreen surface (fast, native); resize()
// is the same operation in plain TypeScript, for tests and tools.

import { createRgba, type RgbaImage } from './rgba';

export type FitMode = 'cover' | 'contain';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FitRects {
  /** Part of the source to draw. */
  src: Rect;
  /** Where it lands in the target; the rest is filled with white. */
  dst: Rect;
}

/**
 * cover crops the source to the target's aspect ratio, centred (like
 * Pillow's ImageOps.fit); contain scales it to fit and pads (ImageOps.pad).
 * `crop` (0..1, cover only) moves the crop window; 0.5 is centred.
 */
export function computeFit(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  mode: FitMode,
  crop: { x: number; y: number } = { x: 0.5, y: 0.5 },
): FitRects {
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  if (mode === 'cover') {
    let w = srcW;
    let h = srcH;
    if (srcAspect > dstAspect) w = srcH * dstAspect;
    else h = srcW / dstAspect;
    return {
      src: { x: (srcW - w) * crop.x, y: (srcH - h) * crop.y, width: w, height: h },
      dst: { x: 0, y: 0, width: dstW, height: dstH },
    };
  }
  let w = dstW;
  let h = dstH;
  if (srcAspect > dstAspect) h = Math.round(dstW / srcAspect);
  else w = Math.round(dstH * srcAspect);
  return {
    src: { x: 0, y: 0, width: srcW, height: srcH },
    dst: { x: Math.floor((dstW - w) / 2), y: Math.floor((dstH - h) / 2), width: w, height: h },
  };
}

/** Separable triangle-filter resample of `src` rect, antialiased when shrinking. */
function resample(img: RgbaImage, src: Rect, outW: number, outH: number): Float32Array {
  const horiz = weights(src.x, src.width, img.width, outW);
  const vert = weights(src.y, src.height, img.height, outH);
  // Horizontal pass: rows of the image covered by the vertical taps.
  const rowsNeeded = new Set<number>();
  vert.forEach((t) => t.idx.forEach((i) => rowsNeeded.add(i)));
  const tmp = new Map<number, Float32Array>();
  for (const y of rowsNeeded) {
    const row = new Float32Array(outW * 3);
    const base = y * img.width * 4;
    for (let x = 0; x < outW; x++) {
      const { idx, w } = horiz[x];
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < idx.length; k++) {
        const p = base + idx[k] * 4;
        r += img.data[p] * w[k];
        g += img.data[p + 1] * w[k];
        b += img.data[p + 2] * w[k];
      }
      row[x * 3] = r;
      row[x * 3 + 1] = g;
      row[x * 3 + 2] = b;
    }
    tmp.set(y, row);
  }
  const out = new Float32Array(outW * outH * 3);
  for (let y = 0; y < outH; y++) {
    const { idx, w } = vert[y];
    for (let k = 0; k < idx.length; k++) {
      const row = tmp.get(idx[k])!;
      const wk = w[k];
      const o = y * outW * 3;
      for (let i = 0; i < outW * 3; i++) out[o + i] += row[i] * wk;
    }
  }
  return out;
}

function weights(start: number, length: number, limit: number, outN: number) {
  const scale = length / outN;
  const support = Math.max(1, scale);
  const taps: { idx: number[]; w: number[] }[] = [];
  for (let i = 0; i < outN; i++) {
    const center = start + (i + 0.5) * scale;
    const lo = Math.max(0, Math.floor(center - support));
    const hi = Math.min(limit - 1, Math.ceil(center + support));
    const idx: number[] = [];
    const w: number[] = [];
    let sum = 0;
    for (let j = lo; j <= hi; j++) {
      const d = Math.abs(j + 0.5 - center) / support;
      if (d < 1) {
        idx.push(j);
        w.push(1 - d);
        sum += 1 - d;
      }
    }
    if (sum === 0) {
      const j = Math.min(limit - 1, Math.max(0, Math.floor(center)));
      idx.push(j);
      w.push(1);
      sum = 1;
    }
    taps.push({ idx, w: w.map((x) => x / sum) });
  }
  return taps;
}

/** Fits `img` into a width × height picture: crop or white padding, then resample. */
export function fitImage(
  img: RgbaImage,
  width: number,
  height: number,
  mode: FitMode,
  crop?: { x: number; y: number },
): RgbaImage {
  const { src, dst } = computeFit(img.width, img.height, width, height, mode, crop);
  const out = createRgba(width, height);
  out.data.fill(255);
  const px = resample(img, src, dst.width, dst.height);
  for (let y = 0; y < dst.height; y++) {
    for (let x = 0; x < dst.width; x++) {
      const s = (y * dst.width + x) * 3;
      const d = ((y + dst.y) * width + x + dst.x) * 4;
      out.data[d] = Math.round(px[s]);
      out.data[d + 1] = Math.round(px[s + 1]);
      out.data[d + 2] = Math.round(px[s + 2]);
    }
  }
  return out;
}
