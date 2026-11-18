// Picture → frame, end to end. The input is RGBA already fitted to the
// target size (Skia does that on the phone; fitImage() in tests and tools).

import { FRAME_BYTES } from '../protocol/constants';
import { crc32 } from '../protocol/crc32';
import { colorShares, dither, type DitherOptions } from './dither';
import { fitImage, type FitMode } from './fit';
import {
  frameToRgba,
  packFrame,
  PANEL_ROTATION,
  PORTRAIT_HEIGHT,
  PORTRAIT_WIDTH,
  type Orientation,
  type Rotation,
} from './frame';
import type { RgbaImage } from './rgba';
import { applyLook, lookDither, sharpen, type Look } from './look';
import { applyTone, type Tone } from './tone';

export interface ConvertOptions {
  orientation?: Orientation;
  rotation?: Rotation;
  tone?: Partial<Tone>;
  /** How tones are mapped onto the panel before dithering. Default 'today'. */
  look?: Look;
  /** Unsharp mask on lightness before dithering, 0 (off) to 1. */
  sharpen?: number;
  dither?: DitherOptions;
}

export interface Converted {
  frame: Uint8Array;
  crc32: number;
  /** Exactly what the badge will draw, decoded back from the frame. */
  preview: RgbaImage;
  shares: ReturnType<typeof colorShares>;
  /** Milliseconds per step, for tuning on slow phones. */
  timings: { tone: number; dither: number; pack: number; preview: number };
}

export const targetSize = (orientation: Orientation = 'portrait') =>
  orientation === 'portrait'
    ? { width: PORTRAIT_WIDTH, height: PORTRAIT_HEIGHT }
    : { width: PORTRAIT_HEIGHT, height: PORTRAIT_WIDTH };

const now = () => (globalThis.performance ?? Date).now();

/** `img` must already be targetSize(orientation). */
export function convertFitted(img: RgbaImage, opts: ConvertOptions = {}): Converted {
  const { orientation = 'portrait', rotation = PANEL_ROTATION } = opts;
  const size = targetSize(orientation);
  if (img.width !== size.width || img.height !== size.height)
    throw new Error(`expected ${size.width}×${size.height}, got ${img.width}×${img.height}`);

  let t = now();
  const lap = () => {
    const n = now();
    const d = n - t;
    t = n;
    return Math.round(d);
  };
  const look = opts.look ?? 'today';
  const toned = applyLook(sharpen(opts.tone ? applyTone(img, opts.tone) : img, opts.sharpen ?? 0), look);
  const tTone = lap();
  const indices = dither(toned, lookDither(look, opts.dither));
  const tDither = lap();
  const frame = packFrame(indices, orientation, rotation);
  const crc = crc32(frame);
  const tPack = lap();
  const preview = frameToRgba(frame, orientation, rotation);
  const tPreview = lap();
  if (frame.length !== FRAME_BYTES) throw new Error('internal: bad frame size');
  return {
    frame,
    crc32: crc,
    preview,
    shares: colorShares(indices),
    timings: { tone: tTone, dither: tDither, pack: tPack, preview: tPreview },
  };
}

/** Any size picture → frame, fitting in TypeScript. */
export function convert(
  img: RgbaImage,
  opts: ConvertOptions & { fit?: FitMode; crop?: { x: number; y: number } } = {},
): Converted {
  const { width, height } = targetSize(opts.orientation);
  return convertFitted(fitImage(img, width, height, opts.fit ?? 'cover', opts.crop), opts);
}
