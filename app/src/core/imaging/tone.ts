// Brightness, contrast and saturation, each 1.0 = unchanged. Same maths as
// Pillow's ImageEnhance, which the devtool uses, applied in that order.

import type { RgbaImage } from './rgba';

export interface Tone {
  brightness: number;
  contrast: number;
  saturation: number;
}

export const NEUTRAL_TONE: Tone = { brightness: 1, contrast: 1, saturation: 1 };

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const luma = (r: number, g: number, b: number) => (r * 299 + g * 587 + b * 114) / 1000;

/** Returns a new image; the input is left alone. */
export function applyTone(img: RgbaImage, tone: Partial<Tone>): RgbaImage {
  const { brightness = 1, contrast = 1, saturation = 1 } = tone;
  const d = new Uint8Array(img.data);
  const n = img.width * img.height;
  if (brightness !== 1) {
    for (let i = 0; i < n * 4; i++) if ((i & 3) !== 3) d[i] = clamp(d[i] * brightness);
  }
  if (contrast !== 1) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.round(luma(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]));
    const mean = Math.round(sum / n);
    for (let i = 0; i < n * 4; i++)
      if ((i & 3) !== 3) d[i] = clamp(mean + (d[i] - mean) * contrast);
  }
  if (saturation !== 1) {
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      const l = Math.round(luma(d[p], d[p + 1], d[p + 2]));
      d[p] = clamp(l + (d[p] - l) * saturation);
      d[p + 1] = clamp(l + (d[p + 1] - l) * saturation);
      d[p + 2] = clamp(l + (d[p + 2] - l) * saturation);
    }
  }
  return { width: img.width, height: img.height, data: d };
}
