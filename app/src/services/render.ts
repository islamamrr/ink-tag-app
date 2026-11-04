// Draws a scene with Skia: the SceneRenderer the InkTag service uses on the
// phone. compile() (src/core/design/scene.ts) already decided where
// everything goes; this file only paints the operations, in the panel's
// measured colours, so solid areas map exactly onto the six inks.
//
// Runs in Jest too: Skia ships CanvasKit for Node (test/render.test.ts).

import {
  AlphaType,
  ClipOp,
  ColorType,
  FilterMode,
  ImageFormat,
  MipmapMode,
  PaintStyle,
  Skia,
  type SkCanvas,
  type SkFont,
  type SkImage,
  StrokeCap,
  StrokeJoin,
  type SkTypeface,
} from '@shopify/react-native-skia';

import {
  applyTone,
  type ColorName,
  computeFit,
  type DrawOp,
  type FontWeight,
  PALETTE,
  type PhotoLayer,
  type RgbaImage,
  type Scene,
  type SceneRenderer,
  sceneSize,
} from '../core';

export interface Fonts {
  regular: SkTypeface;
  bold: SkTypeface;
}

const RGB = Object.fromEntries(PALETTE.map((p) => [p.name, p.rgb])) as Record<ColorName, [number, number, number]>;
const color = (c: ColorName) => {
  const [r, g, b] = RGB[c];
  return Skia.Color(`rgb(${r}, ${g}, ${b})`);
};

/** Preview size for the library grid: a third of the badge. */
const PREVIEW_SCALE = 1 / 3;

export function createSkiaRenderer(fonts: Fonts): SceneRenderer {
  const fontCache = new Map<string, SkFont>();
  const font = (size: number, weight: FontWeight) => {
    const key = `${weight}:${size}`;
    let f = fontCache.get(key);
    if (!f) {
      f = Skia.Font(weight === 'bold' ? fonts.bold : fonts.regular, size);
      fontCache.set(key, f);
      if (fontCache.size > 200) fontCache.delete(fontCache.keys().next().value!);
    }
    return f;
  };

  const measure = (text: string, size: number, weight: FontWeight) => {
    if (!text) return 0;
    const f = font(size, weight);
    return f.getGlyphWidths(f.getGlyphIDs(text)).reduce((a, b) => a + b, 0);
  };

  return {
    measure,

    async draw(scene, ops, loadPhoto) {
      const { width, height } = sceneSize(scene);
      const surface = Skia.Surface.MakeOffscreen(width, height) ?? Skia.Surface.Make(width, height);
      if (!surface) throw new Error('Out of memory drawing the picture.');
      const canvas = surface.getCanvas();
      for (const op of ops) await drawOp(canvas, op, font, loadPhoto);
      surface.flush();
      return readRgba(surface.makeImageSnapshot(), width, height);
    },

    async encodePreview(img) {
      const w = Math.round(img.width * PREVIEW_SCALE);
      const h = Math.round(img.height * PREVIEW_SCALE);
      const src = toSkImage(img);
      const surface = Skia.Surface.MakeOffscreen(w, h) ?? Skia.Surface.Make(w, h);
      if (!src || !surface) throw new Error("Couldn't make the preview.");
      surface
        .getCanvas()
        .drawImageRectOptions(src, Skia.XYWHRect(0, 0, img.width, img.height), Skia.XYWHRect(0, 0, w, h), FilterMode.Linear, MipmapMode.None, null);
      surface.flush();
      return surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG);
    },
  };
}

async function drawOp(
  canvas: SkCanvas,
  op: DrawOp,
  font: (size: number, w: FontWeight) => SkFont,
  loadPhoto: (id: string) => Promise<Uint8Array | null>,
) {
  const paint = Skia.Paint();
  switch (op.op) {
    case 'fill':
      canvas.clear(color(op.color));
      return;
    case 'rect': {
      paint.setColor(color(op.color));
      // Rects are on whole pixels already; antialiasing would only add grey edges.
      paint.setAntiAlias(!!op.radius);
      const { x, y, width, height } = op.box;
      if (op.stroke) {
        paint.setStyle(PaintStyle.Stroke);
        paint.setStrokeWidth(op.stroke);
      }
      // A stroke is centred on the edge: inset it so it stays inside the box.
      const inset = op.stroke ? op.stroke / 2 : 0;
      const r = Skia.XYWHRect(x + inset, y + inset, width - inset * 2, height - inset * 2);
      if (op.radius) canvas.drawRRect(Skia.RRectXY(r, op.radius, op.radius), paint);
      else canvas.drawRect(r, paint);
      return;
    }
    case 'path': {
      const path = Skia.Path.MakeFromSVGString(op.d);
      if (!path) return;
      paint.setColor(color(op.color));
      paint.setAntiAlias(true);
      if (op.stroke) {
        paint.setStyle(PaintStyle.Stroke);
        paint.setStrokeWidth(op.stroke / (op.box.width / op.viewBox));
      }
      canvas.save();
      canvas.translate(op.box.x, op.box.y);
      canvas.scale(op.box.width / op.viewBox, op.box.height / op.viewBox);
      canvas.drawPath(path, paint);
      canvas.restore();
      return;
    }
    case 'polyline': {
      const p = op.points;
      let d = `M${p[0]} ${p[1]}`;
      for (let i = 2; i + 1 < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
      if (p.length === 2) d += `L${p[0] + 0.01} ${p[1]}`; // a dot
      const path = Skia.Path.MakeFromSVGString(d);
      if (!path) return;
      paint.setColor(color(op.color));
      paint.setAntiAlias(true);
      paint.setStyle(PaintStyle.Stroke);
      paint.setStrokeWidth(op.width);
      paint.setStrokeCap(StrokeCap.Round);
      paint.setStrokeJoin(StrokeJoin.Round);
      canvas.drawPath(path, paint);
      return;
    }
    case 'text':
      paint.setColor(color(op.color));
      paint.setAntiAlias(true);
      canvas.drawText(op.text, op.x, op.y, paint, font(op.size, op.weight));
      return;
    case 'photo':
      await drawPhoto(canvas, op.layer, loadPhoto);
      return;
  }
}

async function drawPhoto(
  canvas: SkCanvas,
  l: PhotoLayer,
  loadPhoto: (id: string) => Promise<Uint8Array | null>,
) {
  const bytes = await loadPhoto(l.photo);
  const img = bytes && Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
  const { x, y, width, height } = l.box;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (!img) {
    // Missing photo: a white box, so the rest of the design still sends.
    const p = Skia.Paint();
    p.setColor(color('white'));
    canvas.drawRect(Skia.XYWHRect(x, y, w, h), p);
    return;
  }

  // Fit and crop into the box's size first, so the tone maths (Pillow's,
  // which needs the mean brightness) sees exactly the visible part.
  const { src, dst } = computeFit(img.width(), img.height(), w, h, l.fit ?? 'cover', l.crop, l.zoom);
  const surface = Skia.Surface.MakeOffscreen(w, h) ?? Skia.Surface.Make(w, h);
  if (!surface) throw new Error('Out of memory drawing the photo.');
  const c = surface.getCanvas();
  c.clear(color('white'));
  c.drawImageRectOptions(
    img,
    Skia.XYWHRect(src.x, src.y, src.width, src.height),
    Skia.XYWHRect(dst.x, dst.y, dst.width, dst.height),
    FilterMode.Linear,
    MipmapMode.Linear,
    null,
  );
  surface.flush();
  let fitted: SkImage | null = surface.makeImageSnapshot();
  if (l.tone) fitted = toSkImage(applyTone(readRgba(fitted, w, h), l.tone));
  if (!fitted) return;

  canvas.save();
  if (l.shape === 'circle') {
    const path = Skia.Path.MakeFromSVGString(
      `M${x} ${y + h / 2}a${w / 2} ${h / 2} 0 1 0 ${w} 0a${w / 2} ${h / 2} 0 1 0 ${-w} 0Z`,
    );
    if (path) canvas.clipPath(path, ClipOp.Intersect, true);
  } else if (l.shape) {
    canvas.clipRRect(Skia.RRectXY(Skia.XYWHRect(x, y, w, h), l.shape.radius, l.shape.radius), ClipOp.Intersect, true);
  }
  canvas.drawImage(fitted, x, y);
  canvas.restore();
}

function readRgba(img: SkImage, width: number, height: number): RgbaImage {
  const px = img.readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!(px instanceof Uint8Array)) throw new Error("Couldn't read the picture's pixels.");
  return { width, height, data: px };
}

export function toSkImage(img: RgbaImage): SkImage | null {
  return Skia.Image.MakeImage(
    { width: img.width, height: img.height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)),
    img.width * 4,
  );
}

/** Loads the bundled typefaces from their bytes. */
export function typefacesFrom(regular: Uint8Array, bold: Uint8Array): Fonts {
  const make = (b: Uint8Array) => {
    const t = Skia.Typeface.MakeFreeTypeFaceFromData(Skia.Data.fromBytes(b));
    if (!t) throw new Error("Couldn't load the app's fonts.");
    return t;
  };
  return { regular: make(regular), bold: make(bold) };
}

export type { Scene };
