// Picture styles, named by how they look rather than by algorithm, and the
// Adjust sliders. Each style is a dithering choice plus a small tone nudge.

import type { DitherOptions } from '../imaging/dither';
import { NEUTRAL_TONE, type Tone } from '../imaging/tone';

export type PictureStyle = 'smooth' | 'poster' | 'sketch';

export interface StyleSpec {
  label: string;
  description: string;
  dither: DitherOptions;
  /** Multiplied into the person's own adjustments. */
  tone: Tone;
}

export const STYLES: Record<PictureStyle, StyleSpec> = {
  smooth: {
    label: 'Smooth',
    description: 'Fine dots blend the six colours. Best for photos.',
    dither: { method: 'floyd-steinberg', metric: 'oklab', serpentine: true },
    tone: NEUTRAL_TONE,
  },
  poster: {
    label: 'Poster',
    description: 'Flat areas of solid colour. Best for text, logos and drawings.',
    dither: { method: 'none', metric: 'oklab' },
    tone: { brightness: 1, contrast: 1.15, saturation: 1.3 },
  },
  sketch: {
    label: 'Sketch',
    description: 'Crisp, grainy and high-contrast, like a print.',
    dither: { method: 'atkinson', metric: 'oklab' },
    tone: { brightness: 1.05, contrast: 1.1, saturation: 1 },
  },
};

export const STYLE_NAMES = Object.keys(STYLES) as PictureStyle[];

/** The Adjust sliders, each −50…+50, 0 = unchanged. */
export interface Adjustments {
  brightness: number;
  contrast: number;
  /** "Colour boost": saturation. */
  colour: number;
}

export const NO_ADJUSTMENTS: Adjustments = { brightness: 0, contrast: 0, colour: 0 };

const clampSlider = (v: number) => Math.max(-50, Math.min(50, Number.isFinite(v) ? v : 0));

/** Slider values → tone factors: ±50 is ×0.5…×1.5 (×0…×2 for colour). */
export function toneFor(adj: Partial<Adjustments>, style: PictureStyle = 'smooth'): Tone {
  const base = STYLES[style].tone;
  const b = clampSlider(adj.brightness ?? 0);
  const c = clampSlider(adj.contrast ?? 0);
  const s = clampSlider(adj.colour ?? 0);
  return {
    brightness: base.brightness * (1 + b / 100),
    contrast: base.contrast * (1 + c / 100),
    saturation: base.saturation * (1 + s / 50),
  };
}
