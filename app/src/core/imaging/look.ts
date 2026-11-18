// "Looks": how a photo is mapped onto what the panel can show before it is
// dithered. The panel's white is light grey and its black is dark purple, so a
// photo drawn as-is spends light tones on grey dots and looks washed out.
//
//   today      the picture as given (the long-standing behaviour)
//   boost      more colour and contrast
//   strong     much more colour and a little more contrast, no brightness squeeze
//   fit        brightness squeezed into the panel's black..white range, more colour
//   fit-curve  like fit, a gentle S-curve, and the dither error carried in Oklab
//
// All of them work in Oklab so lightness and colour move independently.

import { PALETTE, oklabToRgb, rgbToOklab } from './palette';
import type { DitherOptions } from './dither';
import { createRgba, type RgbaImage } from './rgba';

export type Look = 'today' | 'boost' | 'strong' | 'fit' | 'fit-curve';

export const LOOKS: readonly Look[] = ['today', 'boost', 'strong', 'fit', 'fit-curve'];

/** The four looks the A-D comparison shows, in reading order. */
export const COMPARE_LOOKS: readonly Look[] = ['today', 'boost', 'fit', 'fit-curve'];

interface Recipe {
  contrast: number;
  saturation: number;
  curve: number;
  fitRange: boolean;
  errorSpace: 'srgb' | 'oklab';
}

const RECIPES: Record<Look, Recipe> = {
  today: { contrast: 1, saturation: 1, curve: 0, fitRange: false, errorSpace: 'srgb' },
  boost: { contrast: 1.15, saturation: 1.4, curve: 0, fitRange: false, errorSpace: 'srgb' },
  strong: { contrast: 1.1, saturation: 1.8, curve: 0, fitRange: false, errorSpace: 'srgb' },
  fit: { contrast: 1, saturation: 1.5, curve: 0, fitRange: true, errorSpace: 'srgb' },
  'fit-curve': { contrast: 1, saturation: 1.3, curve: 0.6, fitRange: true, errorSpace: 'oklab' },
};

export function lookDither(look: Look, base: DitherOptions = {}): DitherOptions {
  return { errorSpace: RECIPES[look].errorSpace, ...base };
}

const lightness = (rgb: readonly number[]) => {
  const o = [0, 0, 0];
  rgbToOklab(rgb[0], rgb[1], rgb[2], o);
  return o[0];
};
const L_BLACK = lightness(PALETTE[0].rgb);
const L_WHITE = lightness(PALETTE[1].rgb);

/** Returns a new picture with the look applied; 'today' returns the input. */
export function applyLook(img: RgbaImage, look: Look): RgbaImage {
  const r = RECIPES[look];
  if (look === 'today') return img;
  const out = createRgba(img.width, img.height);
  const lab = [0, 0, 0];
  const px = [0, 0, 0];
  const { data } = img;
  for (let i = 0; i < img.width * img.height; i++) {
    rgbToOklab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], lab);
    let L = 0.5 + (lab[0] - 0.5) * r.contrast;
    L = L <= 0 ? 0 : L >= 1 ? 1 : L;
    if (r.curve) L += r.curve * (L - 0.5) * (1 - Math.abs(2 * L - 1));
    if (r.fitRange) L = L_BLACK + (L_WHITE - L_BLACK) * L;
    oklabToRgb(L, lab[1] * r.saturation, lab[2] * r.saturation, px);
    out.data[i * 4] = px[0];
    out.data[i * 4 + 1] = px[1];
    out.data[i * 4 + 2] = px[2];
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/** Unsharp mask on lightness: amount 0 is off, 1 is strong. Radius is one pixel. */
export function sharpen(img: RgbaImage, amount: number): RgbaImage {
  if (amount <= 0) return img;
  const { width: w, height: h, data } = img;
  const out = createRgba(w, h);
  const luma = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    luma[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const at = (x: number, y: number) => luma[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const blur = (at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) + 4 * at(x, y)) / 8;
      const d = (luma[i] - blur) * amount * 1.5;
      for (let c = 0; c < 3; c++) {
        const v = data[i * 4 + c] + d;
        out.data[i * 4 + c] = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
      }
      out.data[i * 4 + 3] = 255;
    }
  return out;
}
