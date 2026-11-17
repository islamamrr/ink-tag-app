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
import { SCREEN_PALETTE } from './palette';
import type { RgbaImage } from './rgba';
import { applyTone, type Tone } from './tone';

export interface ConvertOptions {
  orientation?: Orientation;
  rotation?: Rotation;
  tone?: Partial<Tone>;
  dither?: DitherOptions;
}

export interface Converted {
  frame: Uint8Array;
  crc32: number;
  /** Exactly what the badge will draw, decoded back from the frame, in the measured panel colours. */
  preview: RgbaImage;
  /** The same picture in the app's bright screen inks (SCREEN_PALETTE): what the UI shows. */
  display: RgbaImage;
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
  const toned = opts.tone ? applyTone(img, opts.tone) : img;
  const tTone = lap();
  const indices = dither(toned, opts.dither);
  const tDither = lap();
  const frame = packFrame(indices, orientation, rotation);
  const crc = crc32(frame);
  const tPack = lap();
  const preview = frameToRgba(frame, orientation, rotation);
  const display = frameToRgba(frame, orientation, rotation, SCREEN_PALETTE);
  const tPreview = lap();
  if (frame.length !== FRAME_BYTES) throw new Error('internal: bad frame size');
  return {
    frame,
    crc32: crc,
    preview,
    display,
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
