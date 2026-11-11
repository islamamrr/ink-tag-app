// The Skia scene renderer on CanvasKit: text, QR codes, photos, stickers,
// and a whole design sent to a demo badge.

import { readFileSync } from 'fs';
import { join } from 'path';

import { ColorType, AlphaType, ImageFormat, Skia } from '@shopify/react-native-skia';

import {
  buildTemplate,
  compile,
  convertFitted,
  emptyScene,
  InkTag,
  MemoryStorage,
  PALETTE,
  qrMatrix,
  type RgbaImage,
  type Scene,
  STYLES,
  PREVIEW_VERSION,
} from '../src/core';
import { createSkiaRenderer, typefacesFrom } from '../src/services/render';

const font = (f: string) => new Uint8Array(readFileSync(join(__dirname, '..', 'assets', 'fonts', f)));
const renderer = createSkiaRenderer(typefacesFrom(font('Inter-Regular.ttf'), font('Inter-Bold.ttf')));
const RGB = Object.fromEntries(PALETTE.map((p) => [p.name, p.rgb]));

const px = (img: RgbaImage, x: number, y: number) => {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
const draw = (scene: Scene, photos: Record<string, Uint8Array> = {}) =>
  renderer.draw(scene, compile(scene, renderer.measure), async (id) => photos[id] ?? null);

/** A 200 × 100 PNG: left half red, right half blue. */
function testPhoto(): Uint8Array {
  const s = Skia.Surface.MakeOffscreen(200, 100) ?? Skia.Surface.Make(200, 100)!;
  const c = s.getCanvas();
  const p = Skia.Paint();
  p.setColor(Skia.Color('rgb(255, 0, 0)'));
  c.drawRect(Skia.XYWHRect(0, 0, 100, 100), p);
  p.setColor(Skia.Color('rgb(0, 0, 255)'));
  c.drawRect(Skia.XYWHRect(100, 0, 100, 100), p);
  s.flush();
  return s.makeImageSnapshot().encodeToBytes(ImageFormat.PNG);
}

test('measures with the real font', () => {
  const w = renderer.measure('Hello', 100, 'bold');
  expect(w).toBeGreaterThan(220);
  expect(w).toBeLessThan(320);
  expect(renderer.measure('Hello', 100, 'regular')).toBeLessThan(w);
  expect(renderer.measure('', 50, 'regular')).toBe(0);
});

test('a status sign is green with white words, and maps onto the inks exactly', async () => {
  const scene = buildTemplate('status-sign', { status: 'free' });
  const img = await draw(scene);
  expect(img.width).toBe(528);
  expect(img.height).toBe(792);
  expect(px(img, 5, 5)).toEqual(RGB.green);
  const { shares } = convertFitted(img, { dither: STYLES.poster.dither });
  expect(shares.green).toBeGreaterThan(0.7);
  expect(shares.white).toBeGreaterThan(0.02);
  expect(shares.red + shares.blue + shares.yellow).toBeLessThan(0.01);
});

test('text stays inside its box', async () => {
  const box = { x: 100, y: 200, width: 300, height: 150 };
  const scene: Scene = {
    ...emptyScene(),
    layers: [{ type: 'text', text: 'Make it work, make it right, make it fast', box, size: 80, color: 'black', weight: 'bold' }],
  };
  const img = await draw(scene);
  let inside = 0;
  let outside = 0;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const dark = px(img, x, y)[0] < 100;
      if (!dark) continue;
      const inBox = x >= box.x - 2 && x < box.x + box.width + 2 && y >= box.y - 2 && y < box.y + box.height + 12;
      if (inBox) inside++;
      else outside++;
    }
  expect(inside).toBeGreaterThan(1000);
  expect(outside).toBe(0);
});

test('QR modules land exactly where the matrix says', async () => {
  const data = 'https://inktag.dev/hello';
  const scene = buildTemplate('qr', { data });
  const img = await draw(scene);
  const qr = compile(scene, renderer.measure).find((o) => o.op === 'path')!;
  if (qr.op !== 'path') throw new Error();
  const m = qrMatrix(data);
  const cell = qr.box.width / (m.length + 4);
  let wrong = 0;
  for (let r = 0; r < m.length; r++)
    for (let c = 0; c < m.length; c++) {
      const [v] = px(img, qr.box.x + (c + 2.5) * cell, qr.box.y + (r + 2.5) * cell);
      if ((v < 100) !== m[r][c]) wrong++;
    }
  expect(wrong).toBe(0);
});

test('photos are cropped, clipped to a circle and toned', async () => {
  const photo = testPhoto();
  const scene: Scene = {
    ...emptyScene(),
    layers: [
      { type: 'photo', photo: 'p', box: { x: 0, y: 0, width: 200, height: 100 }, fit: 'cover' },
      { type: 'photo', photo: 'p', box: { x: 0, y: 200, width: 100, height: 100 }, fit: 'cover', crop: { x: 0, y: 0.5 }, shape: 'circle' },
      { type: 'photo', photo: 'p', box: { x: 300, y: 0, width: 200, height: 100 }, tone: { brightness: 0.5 } },
      { type: 'photo', photo: 'missing', box: { x: 300, y: 300, width: 50, height: 50 } },
    ],
  };
  const img = await draw(scene, { p: photo });
  expect(px(img, 20, 50)).toEqual([255, 0, 0]);
  expect(px(img, 180, 50)).toEqual([0, 0, 255]);
  // Crop to the left square: all red; the circle leaves the corner white.
  expect(px(img, 50, 250)).toEqual([255, 0, 0]);
  expect(px(img, 2, 202)).toEqual(RGB.white);
  // Half brightness.
  expect(px(img, 320, 50)[0]).toBeGreaterThan(120);
  expect(px(img, 320, 50)[0]).toBeLessThan(135);
  expect(px(img, 325, 325)).toEqual(RGB.white);
});

test('every template draws in both orientations', async () => {
  for (const id of ['name-badge', 'event-ticket', 'contact-qr', 'wifi-qr', 'quote', 'text', 'collage']) {
    for (const orientation of ['portrait', 'landscape'] as const) {
      const scene = buildTemplate(id, { name: 'Islam Amr', photo: 'p', photo1: 'p', photo2: 'p', link: 'example.com', code: 'X1' }, { orientation });
      const img = await draw(scene, { p: testPhoto() });
      expect(img.width).toBe(orientation === 'portrait' ? 528 : 792);
    }
  }
});

test('a design goes through the service to a demo badge, with a preview PNG', async () => {
  const app = new InkTag({
    storage: new MemoryStorage(),
    renderer,
    randomBytes: (n) => new Uint8Array(n).fill(7),
    demoTiming: 'instant',
  });
  await app.init();
  const { badge } = await app.addDemoBadge({ hello: false });
  const photoId = await app.library.addPhoto(testPhoto());
  const scene = buildTemplate('name-badge', { name: 'Islam Amr', role: 'Maker', photo: photoId });
  const prepared = await app.prepare({ scene, style: 'smooth' });
  const { item, displayed } = await app.send(badge.id, { scene, style: 'smooth', kind: 'template', title: 'Name badge' }, { prepared });
  expect((await displayed).status).toBe('displayed');
  expect(app.demoTag(badge.id)!.shown).toEqual(prepared.converted.frame);
  const png = await app.library.preview(item.id);
  expect(Array.from(png!.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  const decoded = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(png!))!;
  expect(decoded.width()).toBe(176);
  expect(decoded.readPixels(0, 0, { width: 1, height: 1, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul })).toBeTruthy();
  expect(app.library.get(item.id)!.previewVersion).toBe(PREVIEW_VERSION);

  // An item saved before the screen inks gets its preview repainted once, from its frame.
  await app.library.setPreview(item.id, new Uint8Array([1, 2, 3]), 1);
  const thumb = await app.thumbnail(item.id);
  expect(Array.from(thumb!.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(app.library.get(item.id)!.previewVersion).toBe(PREVIEW_VERSION);
  expect(Array.from((await app.library.preview(item.id))!.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
});
