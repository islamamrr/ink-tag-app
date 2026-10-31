import {
  applyTone,
  colorShares,
  computeFit,
  convert,
  convertFitted,
  crc32,
  dither,
  fitImage,
  frameToRgba,
  FRAME_BYTES,
  packFrame,
  PALETTE,
  PANEL_HEIGHT,
  PANEL_WIDTH,
  PORTRAIT_HEIGHT,
  PORTRAIT_WIDTH,
} from '../src/core';
import { golden, goldenMeta, rgbToRgba } from './helpers';

const W = PORTRAIT_WIDTH;
const H = PORTRAIT_HEIGHT;

test('the palette matches firmware/tools/inktag.py', () => {
  expect(PALETTE.map((p) => [p.name, p.rgb, p.code])).toEqual(goldenMeta.palette);
});

describe('golden files from the Python pipeline', () => {
  const indices = golden('photo_indices_portrait');
  const frame = golden('photo_frame');

  test('rotate + pack matches byte for byte', () => {
    const ours = packFrame(indices, 'portrait', 'ccw');
    expect(ours.length).toBe(FRAME_BYTES);
    expect(Buffer.from(ours).equals(Buffer.from(frame))).toBe(true);
    expect(crc32(ours)).toBe(goldenMeta.photo.crc32);
  });

  test('preview decodes to the same picture as inktag.preview', () => {
    const preview = frameToRgba(frame, 'portrait', 'ccw');
    const expected = rgbToRgba(golden('photo_preview_rgb'), W, H);
    expect(preview.width).toBe(W);
    expect(Buffer.from(preview.data).equals(Buffer.from(expected.data))).toBe(true);
  });

  test("RGB-metric dithering lands within 2 points of Pillow's color shares", () => {
    const fitted = rgbToRgba(golden('photo_fitted_rgb'), W, H);
    const ours = colorShares(dither(fitted, { metric: 'rgb', serpentine: false }));
    for (const [name, share] of Object.entries(goldenMeta.photo.shares as Record<string, number>)) {
      expect(Math.abs(ours[name as keyof typeof ours] - share)).toBeLessThan(0.02);
    }
  });

  test('the vendor sample frame survives decode and re-pack', () => {
    const dtm1 = golden('vendor_dtm1');
    expect(crc32(dtm1)).toBe(goldenMeta.vendor_dtm1.crc32);
    const codes = new Set<number>();
    dtm1.forEach((b) => codes.add(b >> 4).add(b & 15));
    const known = PALETTE.map((p) => p.code);
    // Re-pack from the decoded colors; only exact if every code is a known color.
    const img = frameToRgba(dtm1, 'landscape');
    const idx = dither(img, { method: 'none', metric: 'rgb' });
    const again = packFrame(idx, 'landscape');
    if ([...codes].every((c) => known.includes(c))) {
      expect(Buffer.from(again).equals(Buffer.from(dtm1))).toBe(true);
    } else {
      expect(again.length).toBe(FRAME_BYTES);
    }
  });
});

describe('rotation', () => {
  // A portrait picture with a single black pixel at its top-left corner.
  const marker = () => {
    const idx = new Uint8Array(W * H).fill(1); // white
    idx[0] = 0; // black
    return idx;
  };
  const scanPixel = (frame: Uint8Array, x: number, y: number) => {
    const b = frame[(y * PANEL_WIDTH + x) >> 1];
    return x & 1 ? b & 15 : b >> 4;
  };

  test("ccw puts the portrait top-left at the scan's bottom-left", () => {
    const f = packFrame(marker(), 'portrait', 'ccw');
    expect(scanPixel(f, 0, PANEL_HEIGHT - 1)).toBe(0);
    expect(scanPixel(f, 0, 0)).toBe(1);
  });

  test("cw puts it at the scan's top-right", () => {
    const f = packFrame(marker(), 'portrait', 'cw');
    expect(scanPixel(f, PANEL_WIDTH - 1, 0)).toBe(0);
  });

  test('frameToRgba undoes either rotation', () => {
    for (const rot of ['ccw', 'cw'] as const) {
      const img = frameToRgba(packFrame(marker(), 'portrait', rot), 'portrait', rot);
      expect([...img.data.slice(0, 3)]).toEqual(PALETTE[0].rgb);
      expect([...img.data.slice(4, 7)]).toEqual(PALETTE[1].rgb);
    }
  });
});

describe('fit', () => {
  test('cover crops a landscape photo to the centre', () => {
    const r = computeFit(900, 600, 528, 792, 'cover');
    expect(r.src.height).toBe(600);
    expect(r.src.width).toBeCloseTo(400);
    expect(r.src.x).toBeCloseTo(250);
    expect(r.dst).toEqual({ x: 0, y: 0, width: 528, height: 792 });
  });

  test('contain pads with white', () => {
    const r = computeFit(900, 600, 528, 792, 'contain');
    expect(r.dst.width).toBe(528);
    expect(r.dst.height).toBe(352);
    expect(r.dst.y).toBe(220);
    const src = { width: 90, height: 60, data: new Uint8Array(90 * 60 * 4) }; // black
    const out = fitImage(src, 528, 792, 'contain');
    expect(out.data[0]).toBe(255); // padding
    const mid = (396 * 528 + 264) * 4;
    expect(out.data[mid]).toBe(0);
  });

  test('a flat color stays flat after resampling', () => {
    const src = { width: 1000, height: 700, data: new Uint8Array(1000 * 700 * 4).fill(77) };
    const out = fitImage(src, 528, 792, 'cover');
    expect(new Set(out.data.filter((_, i) => (i & 3) !== 3))).toEqual(new Set([77]));
  });
});

test('neutral tone is a no-op and saturation 0 gives grey', () => {
  const img = rgbToRgba(golden('photo_fitted_rgb'), W, H);
  expect(applyTone(img, {}).data).toEqual(new Uint8Array(img.data));
  const grey = applyTone(img, { saturation: 0 });
  expect(grey.data[0]).toBe(grey.data[1]);
  expect(grey.data[1]).toBe(grey.data[2]);
});

test('panel colors map to themselves without dithering', () => {
  const data = new Uint8Array(PALETTE.length * 4);
  PALETTE.forEach((p, i) => data.set([...p.rgb, 255], i * 4));
  const idx = dither({ width: PALETTE.length, height: 1, data }, { method: 'none' });
  expect([...idx]).toEqual(PALETTE.map((_, i) => i));
});

test('full pipeline on a photo, with timings', () => {
  const src = rgbToRgba(golden('photo_fitted_rgb'), W, H);
  for (const method of ['floyd-steinberg', 'atkinson'] as const) {
    const r = convertFitted(src, { tone: { saturation: 1.2 }, dither: { method } });
    expect(r.frame.length).toBe(FRAME_BYTES);
    expect(r.crc32).toBe(crc32(r.frame));
    expect(r.preview.width).toBe(W);
    const total = Object.values(r.shares).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1);
    console.log(`${method}: ${JSON.stringify(r.timings)} ms on Node`);
  }
  const big = { width: 1200, height: 900, data: new Uint8Array(1200 * 900 * 4).fill(200) };
  expect(convert(big, { fit: 'cover' }).frame.length).toBe(FRAME_BYTES);
});
