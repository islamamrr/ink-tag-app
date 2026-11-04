// A design: what the person made, as data. Photos, text, shapes, QR codes,
// drawings, stickers and frames stacked on a badge-sized canvas. It is kept
// in the library as JSON so a picture can be edited or sent again later.
//
// compile() turns a scene into a short list of drawing operations (rect,
// path, text line, image). Layout decisions live here, in plain TypeScript,
// so they are tested on a laptop; the phone only executes the operations
// with Skia (src/services/render.ts).

import type { ColorName } from '../protocol/constants';
import type { FitMode, Rect } from '../imaging/fit';
import type { Orientation } from '../imaging/frame';
import { targetSize } from '../imaging/pipeline';
import type { Tone } from '../imaging/tone';
import { qrMatrix, type QrLevel } from './qr';
import { STICKERS, type StickerName } from './stickers';

export type Box = Rect;
export type FontWeight = 'regular' | 'bold';
export type Align = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';

export interface PhotoLayer {
  type: 'photo';
  /** Photo id in the library's photo store (or a file URI while editing). */
  photo: string;
  box: Box;
  fit?: FitMode;
  /** 0..1 position of the crop window, 0.5 = centred. */
  crop?: { x: number; y: number };
  /** 1 = the whole photo fills the box; 2 = zoomed in twice. */
  zoom?: number;
  tone?: Partial<Tone>;
  /** Clip to a circle (profile pictures) or rounded corners in px. */
  shape?: 'circle' | { radius: number };
}

export interface TextLayer {
  type: 'text';
  text: string;
  box: Box;
  /** Largest font size in px; shrunk to fit the box unless fixedSize. */
  size: number;
  minSize?: number;
  fixedSize?: boolean;
  weight?: FontWeight;
  color: ColorName;
  align?: Align;
  valign?: VAlign;
  /** Line height as a multiple of the size. */
  lineHeight?: number;
  maxLines?: number;
  uppercase?: boolean;
  /** Filled band behind the text, the box's size. */
  background?: ColorName;
}

export interface RectLayer {
  type: 'rect';
  box: Box;
  color: ColorName;
  radius?: number;
  /** Outline width; fills when absent. */
  stroke?: number;
}

export interface QrLayer {
  type: 'qr';
  data: string;
  /** The code is square: the largest square that fits, centred in the box. */
  box: Box;
  color?: ColorName;
  background?: ColorName;
  level?: QrLevel;
  /** Quiet zone in modules. The spec asks for 4; 2 still scans on a badge. */
  margin?: number;
}

export interface Stroke {
  color: ColorName;
  width: number;
  /** x0, y0, x1, y1, ... in scene pixels. */
  points: number[];
}

export interface StrokesLayer {
  type: 'strokes';
  strokes: Stroke[];
}

export interface StickerLayer {
  type: 'sticker';
  sticker: StickerName;
  box: Box;
  color: ColorName;
}

export type FrameStyle = 'line' | 'double' | 'rounded' | 'corners' | 'dashed';

export interface FrameLayer {
  type: 'frame';
  style: FrameStyle;
  color: ColorName;
  /** Line width in px. */
  width?: number;
  /** Distance from the edge in px. */
  inset?: number;
}

export type Layer =
  | PhotoLayer
  | TextLayer
  | RectLayer
  | QrLayer
  | StrokesLayer
  | StickerLayer
  | FrameLayer;

export interface Scene {
  version: 1;
  orientation: Orientation;
  background: ColorName;
  layers: Layer[];
}

export const sceneSize = (s: Pick<Scene, 'orientation'>) => targetSize(s.orientation);

export const emptyScene = (
  orientation: Orientation = 'portrait',
  background: ColorName = 'white',
): Scene => ({ version: 1, orientation, background, layers: [] });

/** Photo ids a scene refers to, so the library can keep their files. */
export const scenePhotos = (s: Scene) =>
  s.layers.filter((l): l is PhotoLayer => l.type === 'photo').map((l) => l.photo);

// ---------------------------------------------------------------- compile

export type DrawOp =
  | { op: 'fill'; color: ColorName }
  | { op: 'rect'; box: Box; color: ColorName; radius?: number; stroke?: number }
  | {
      op: 'path';
      /** SVG path data in the coordinates of `viewBox`, scaled into `box`. */
      d: string;
      viewBox: number;
      box: Box;
      color: ColorName;
      /** Stroke width in scene px; fills when absent. */
      stroke?: number;
    }
  | { op: 'polyline'; points: number[]; color: ColorName; width: number }
  | {
      op: 'text';
      text: string;
      /** Left end of the baseline. */
      x: number;
      y: number;
      size: number;
      weight: FontWeight;
      color: ColorName;
    }
  | { op: 'photo'; layer: PhotoLayer };

/** Width of `text` at `size` px, from the real font (Skia) or an estimate in tests. */
export type MeasureText = (text: string, size: number, weight: FontWeight) => number;

/** A rough Inter-like measure for tests and for laying out before fonts load. */
export const estimateText: MeasureText = (text, size, weight) =>
  text.length * size * (weight === 'bold' ? 0.6 : 0.55);

export function compile(scene: Scene, measure: MeasureText): DrawOp[] {
  const ops: DrawOp[] = [{ op: 'fill', color: scene.background }];
  const { width, height } = sceneSize(scene);
  for (const l of scene.layers) {
    switch (l.type) {
      case 'photo':
        ops.push({ op: 'photo', layer: l });
        break;
      case 'rect':
        ops.push({ op: 'rect', box: l.box, color: l.color, radius: l.radius, stroke: l.stroke });
        break;
      case 'text':
        if (l.background) ops.push({ op: 'rect', box: l.box, color: l.background });
        ops.push(...layoutText(l, measure));
        break;
      case 'qr':
        ops.push(...compileQr(l));
        break;
      case 'strokes':
        for (const s of l.strokes)
          if (s.points.length >= 2)
            ops.push({ op: 'polyline', points: s.points, color: s.color, width: s.width });
        break;
      case 'sticker':
        ops.push({
          op: 'path',
          d: STICKERS[l.sticker],
          viewBox: 24,
          box: square(l.box),
          color: l.color,
        });
        break;
      case 'frame':
        ops.push(...compileFrame(l, width, height));
        break;
    }
  }
  return ops;
}

const square = (b: Box): Box => {
  const s = Math.min(b.width, b.height);
  return { x: b.x + (b.width - s) / 2, y: b.y + (b.height - s) / 2, width: s, height: s };
};

// ---------------------------------------------------------------- text

/**
 * Word-wraps text into the box, shrinking the size (down to minSize) until it
 * fits in height and maxLines. Explicit newlines are kept. A word wider than
 * the box at the smallest size is broken by characters.
 */
export function layoutText(l: TextLayer, measure: MeasureText): DrawOp[] {
  const text = l.uppercase ? l.text.toUpperCase() : l.text;
  if (!text.trim()) return [];
  const weight = l.weight ?? 'regular';
  const lh = l.lineHeight ?? 1.2;
  const minSize = l.fixedSize ? l.size : (l.minSize ?? Math.max(10, Math.round(l.size / 4)));
  const maxLines = l.maxLines ?? Infinity;

  let size = l.size;
  let lines: string[] = [];
  for (;;) {
    lines = wrap(text, l.box.width, size, weight, measure, size <= minSize);
    const fits =
      lines.length <= maxLines &&
      lines.length * size * lh <= l.box.height + size * (lh - 1) &&
      lines.every((ln) => measure(ln, size, weight) <= l.box.width + 0.5);
    if (fits || size <= minSize) break;
    size = Math.max(minSize, Math.floor(size * 0.92));
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = ellipsize(lines[maxLines - 1], l.box.width, size, weight, measure);
  }

  const blockH = (lines.length - 1) * size * lh + size;
  const valign = l.valign ?? 'top';
  const top =
    valign === 'top'
      ? l.box.y
      : valign === 'middle'
        ? l.box.y + (l.box.height - blockH) / 2
        : l.box.y + l.box.height - blockH;
  // Cap height sits about 0.8 of the size above the baseline in Inter.
  return lines.map((ln, i) => {
    const w = measure(ln, size, weight);
    const align = l.align ?? 'left';
    const x =
      align === 'left'
        ? l.box.x
        : align === 'center'
          ? l.box.x + (l.box.width - w) / 2
          : l.box.x + l.box.width - w;
    return {
      op: 'text' as const,
      text: ln,
      x,
      y: top + i * size * lh + size * 0.8,
      size,
      weight,
      color: l.color,
    };
  });
}

function wrap(
  text: string,
  width: number,
  size: number,
  weight: FontWeight,
  measure: MeasureText,
  breakWords: boolean,
): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next, size, weight) <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      if (breakWords && measure(word, size, weight) > width) {
        let part = '';
        for (const ch of word) {
          if (part && measure(part + ch, size, weight) > width) {
            out.push(part);
            part = '';
          }
          part += ch;
        }
        line = part;
      } else {
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

function ellipsize(line: string, width: number, size: number, weight: FontWeight, m: MeasureText) {
  let s = line;
  while (s && m(`${s}…`, size, weight) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

// ---------------------------------------------------------------- QR

function compileQr(l: QrLayer): DrawOp[] {
  if (!l.data) return [];
  const m = qrMatrix(l.data, l.level ?? 'M');
  const margin = l.margin ?? 2;
  const box = square(l.box);
  const n = m.length + margin * 2;
  // Whole pixels per module keep every module the same width on the panel.
  const cell = Math.max(1, Math.floor(box.width / n));
  const side = cell * n;
  const x0 = Math.round(box.x + (box.width - side) / 2);
  const y0 = Math.round(box.y + (box.height - side) / 2);
  const ops: DrawOp[] = [
    { op: 'rect', box: { x: x0, y: y0, width: side, height: side }, color: l.background ?? 'white' },
  ];
  // One path for all dark modules: runs of modules in a row become one rect.
  let d = '';
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m.length; c++) {
      if (!m[r][c]) continue;
      let e = c;
      while (e + 1 < m.length && m[r][e + 1]) e++;
      const x = (c + margin) * cell;
      const y = (r + margin) * cell;
      d += `M${x} ${y}h${(e - c + 1) * cell}v${cell}h${-(e - c + 1) * cell}z`;
      c = e;
    }
  }
  ops.push({
    op: 'path',
    d,
    viewBox: side,
    box: { x: x0, y: y0, width: side, height: side },
    color: l.color ?? 'black',
  });
  return ops;
}

// ---------------------------------------------------------------- frames

function compileFrame(l: FrameLayer, W: number, H: number): DrawOp[] {
  const w = l.width ?? 8;
  const inset = l.inset ?? 16;
  const box = { x: inset, y: inset, width: W - inset * 2, height: H - inset * 2 };
  const c = l.color;
  switch (l.style) {
    case 'line':
      return [{ op: 'rect', box, color: c, stroke: w }];
    case 'rounded':
      return [{ op: 'rect', box, color: c, stroke: w, radius: 32 }];
    case 'double': {
      const gap = w * 1.5;
      const inner = {
        x: box.x + w + gap,
        y: box.y + w + gap,
        width: box.width - (w + gap) * 2,
        height: box.height - (w + gap) * 2,
      };
      return [
        { op: 'rect', box, color: c, stroke: w },
        { op: 'rect', box: inner, color: c, stroke: Math.max(2, w / 2) },
      ];
    }
    case 'dashed': {
      const ops: DrawOp[] = [];
      const dash = w * 4;
      const step = dash * 2;
      for (let x = box.x; x < box.x + box.width; x += step) {
        const len = Math.min(dash, box.x + box.width - x);
        ops.push({ op: 'rect', box: { x, y: box.y, width: len, height: w }, color: c });
        ops.push({
          op: 'rect',
          box: { x, y: box.y + box.height - w, width: len, height: w },
          color: c,
        });
      }
      for (let y = box.y; y < box.y + box.height; y += step) {
        const len = Math.min(dash, box.y + box.height - y);
        ops.push({ op: 'rect', box: { x: box.x, y, width: w, height: len }, color: c });
        ops.push({
          op: 'rect',
          box: { x: box.x + box.width - w, y, width: w, height: len },
          color: c,
        });
      }
      return ops;
    }
    case 'corners': {
      const len = Math.min(box.width, box.height) / 5;
      const { x, y, width: bw, height: bh } = box;
      const r = (rx: number, ry: number, rw: number, rh: number): DrawOp => ({
        op: 'rect',
        box: { x: rx, y: ry, width: rw, height: rh },
        color: c,
      });
      return [
        r(x, y, len, w),
        r(x, y, w, len),
        r(x + bw - len, y, len, w),
        r(x + bw - w, y, w, len),
        r(x, y + bh - w, len, w),
        r(x, y + bh - len, w, len),
        r(x + bw - len, y + bh - w, len, w),
        r(x + bw - w, y + bh - len, w, len),
      ];
    }
  }
}
