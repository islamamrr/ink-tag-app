// Templates as data. A spec is plain JSON: the fields the person fills in,
// sample content, and one to three layouts, each a column of blocks (text, a
// list, a QR code, a photo, a bar, a rule). specTemplate() turns a spec into
// a TemplateDef, so the same form, preview and send path serve both the
// templates written in code (templates.ts) and the ones that ship as data.
// New templates and packs can therefore arrive as a catalogue file, without
// an app update (catalog.ts).
//
// Text in a block may hold tokens, filled when the picture is drawn:
//   {{key}}                a field's value
//   {{now:FORMAT}}         the time, FORMAT from HH H mm dddd ddd D MMMM MMM YYYY
//   {{daysUntil:key}}      whole days from today to the date in field `key`
//   {{yearPercent}}        how much of the year has gone, 0–100
// Colours are ink names or tokens; "on:<colour>" is the ink that reads on it.

import type { ColorName } from '../protocol/constants';
import { Color } from '../protocol/constants';
import type { Orientation } from '../imaging/frame';
import { parseList } from './list';
import { type Box, type FrameStyle, type Layer, type Scene, estimateText, sceneSize } from './scene';
import { type Field, type TemplateDef, type Values, inkOn } from './templates';

// ---------------------------------------------------------------- the format

/** How the template is used, which picks its screen in the app. */
export type Behaviour =
  /** Fill in a form, preview, send. */
  | 'form'
  /** A list you tick in the app, then "Update my badge". */
  | 'list'
  /** A set of ready pictures: tap one and it's sent. */
  | 'board'
  /** The phone sends a fresh picture on a schedule (clock, countdown). */
  | 'live';

export type LiveRule = 'hourly' | 'quarter' | 'morning';

interface BlockBase {
  /** Share of the leftover height (default 1 for text, list, qr, photo; 0 for the rest). */
  flex?: number;
  /** Fixed height as a fraction of the badge's height. */
  h?: number;
  /** Only drawn when this field has a value (or is on). "!key": only when it hasn't. */
  if?: string;
}

export interface TextBlock extends BlockBase {
  t: 'text';
  text: string;
  /** Largest size as a fraction of the badge's long side (0.1 ≈ 79 px). */
  size?: number;
  bold?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  upper?: boolean;
  lines?: number;
  /** A filled band behind the text, edge to edge. */
  band?: string;
}

export interface ListBlock extends BlockBase {
  t: 'list';
  /** The list field. */
  from: string;
  size?: number;
  color?: string;
  /** Draw a tick box in front of each item. */
  check?: boolean;
  /** Ticked items: crossed out (default) or left off. A field key may choose. */
  done?: 'strike' | 'hide' | string;
  /** Tick and strike colour. */
  accent?: string;
}

export interface QrBlock extends BlockBase {
  t: 'qr';
  data: string;
  color?: string;
}

export interface PhotoBlock extends BlockBase {
  t: 'photo';
  /** The photo field. */
  from: string;
  circle?: boolean;
}

export interface BarBlock extends BlockBase {
  t: 'bar';
  /** 0–100, usually a token. */
  value: string;
  color?: string;
}

export interface RuleBlock extends BlockBase {
  t: 'rule';
  color?: string;
}

export interface GapBlock extends BlockBase {
  t: 'gap';
}

export type Block = TextBlock | ListBlock | QrBlock | PhotoBlock | BarBlock | RuleBlock | GapBlock;

export interface SpecLayout {
  name?: string;
  background?: string;
  frame?: { style: FrameStyle; color?: string };
  /** Margin as a fraction of the short side (default 0.07). */
  pad?: number;
  blocks: Block[];
}

export interface TemplateSpec {
  id: string;
  title: string;
  description: string;
  behaviour: Behaviour;
  /** Category ids (see catalog.ts). */
  category: string[];
  tags?: string[];
  /** What a person fills in. "Note" one line that sits under the title in the preview. */
  fills?: string;
  fields: Field[];
  /** Realistic content for the preview and the shelf. */
  sample: Values;
  layouts: SpecLayout[];
  /** board: the list field whose items are the pictures to tap. */
  board?: { from: string };
  /** live: the update rules offered, the first is the default. */
  live?: { rules: LiveRule[] };
  /** Lowest firmware the badge needs, e.g. "0.5". Absent: any badge. */
  firmware?: string;
  /** Needs internet data (none in this version). */
  online?: boolean;
}

// ---------------------------------------------------------------- tokens

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const pad2 = (n: number) => String(n).padStart(2, '0');

export function formatTime(t: number, fmt: string): string {
  const d = new Date(t);
  return fmt.replace(/HH|H|mm|dddd|ddd|D|MMMM|MMM|YYYY/g, (k) => {
    switch (k) {
      case 'HH': return pad2(d.getHours());
      case 'H': return String(d.getHours());
      case 'mm': return pad2(d.getMinutes());
      case 'dddd': return DAYS[d.getDay()];
      case 'ddd': return DAYS[d.getDay()].slice(0, 3);
      case 'D': return String(d.getDate());
      case 'MMMM': return MONTHS[d.getMonth()];
      case 'MMM': return MONTHS[d.getMonth()].slice(0, 3);
      default: return String(d.getFullYear());
    }
  });
}

/** Parses YYYY-MM-DD as a local date; null when it isn't one. */
export function parseDay(s: unknown): Date | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

/** Whole days from the day of `now` to `day` (0 on the day, negative after). */
export function daysUntil(day: Date, now: number): number {
  const a = new Date(now);
  const from = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const to = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  return Math.round((to - from) / 86_400_000);
}

export function yearPercent(now: number): number {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), 0, 1).getTime();
  const end = new Date(d.getFullYear() + 1, 0, 1).getTime();
  return Math.floor(((now - start) / (end - start)) * 100);
}

export function fillTokens(text: string, v: Values, now: number): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr: string) => {
    const [name, arg] = expr.split(/:(.*)/s, 2) as [string, string | undefined];
    if (name === 'now') return formatTime(now, arg ?? 'HH:mm');
    if (name === 'yearPercent') return String(yearPercent(now));
    if (name === 'daysUntil') {
      const d = parseDay(v[arg ?? '']);
      return d ? String(daysUntil(d, now)) : '?';
    }
    const x = v[name];
    return typeof x === 'string' ? x.trim() : '';
  });
}

const isColor = (c: string): c is ColorName => Object.prototype.hasOwnProperty.call(Color, c);

export function resolveColor(c: string | undefined, v: Values, now: number, fallback: ColorName): ColorName {
  if (!c) return fallback;
  const s = fillTokens(c, v, now).trim().toLowerCase();
  if (s.startsWith('on:')) {
    const base = s.slice(3);
    return isColor(base) ? inkOn(base) : fallback;
  }
  if (s === 'none') return 'black';
  return isColor(s) ? s : fallback;
}

function shown(cond: string | undefined, v: Values): boolean {
  if (!cond) return true;
  const neg = cond.startsWith('!');
  const x = v[neg ? cond.slice(1) : cond];
  const has = typeof x === 'string' ? x.trim() !== '' && x !== 'false' : x === true;
  return neg ? !has : has;
}

// ---------------------------------------------------------------- building

const box = (x: number, y: number, width: number, height: number): Box => ({
  x: Math.round(x),
  y: Math.round(y),
  width: Math.max(1, Math.round(width)),
  height: Math.max(1, Math.round(height)),
});

const defaultFlex = (b: Block) => (b.t === 'text' || b.t === 'list' || b.t === 'qr' || b.t === 'photo' ? 1 : 0);

const fixedHeight = (b: Block, H: number, unit: number) => {
  if (b.h !== undefined) return b.h * H;
  if (b.t === 'rule') return Math.max(4, unit * 0.006);
  if (b.t === 'bar') return unit * 0.045;
  return 0;
};

export function buildSpec(
  spec: TemplateSpec,
  values: Values,
  opts: { orientation?: Orientation; layout?: number; now?: number } = {},
): Scene {
  const orientation = opts.orientation ?? 'portrait';
  const now = opts.now ?? Date.now();
  const L = spec.layouts[Math.max(0, Math.min(spec.layouts.length - 1, opts.layout ?? 0))];
  const { width: W, height: H } = sceneSize({ orientation });
  const short = Math.min(W, H);
  // Sizes are relative to the long side, so text keeps its size sideways.
  const unit = Math.max(W, H);
  const m = Math.round(short * (L.pad ?? 0.07));
  const v = values;
  const bg = resolveColor(L.background, v, now, 'white');
  const ink = inkOn(bg);
  const layers: Layer[] = [];
  if (L.frame)
    layers.push({
      type: 'frame',
      style: L.frame.style,
      color: resolveColor(L.frame.color, v, now, ink),
      width: Math.round(short * 0.022),
      inset: Math.round(m * 0.45),
    });

  const blocks = L.blocks.filter((b) => shown(b.if, v));
  const gap = Math.round(m * 0.35);
  const innerH = H - m * 2 - gap * Math.max(0, blocks.length - 1);
  const fixed = blocks.reduce((a, b) => a + fixedHeight(b, H, unit), 0);
  const flexSum = blocks.reduce((a, b) => a + (fixedHeight(b, H, unit) ? 0 : (b.flex ?? defaultFlex(b))), 0);
  const left = Math.max(0, innerH - fixed);
  let y = m;
  const x = m;
  const w = W - m * 2;
  for (const b of blocks) {
    const fh = fixedHeight(b, H, unit);
    const h = fh || (flexSum ? (left * (b.flex ?? defaultFlex(b))) / flexSum : 0);
    const bx = box(x, y, w, h);
    layers.push(...buildBlock(b, bx, { v, now, ink, unit, W }));
    y += h + gap;
  }
  return { version: 1, orientation, background: bg, layers };
}

interface Ctx {
  v: Values;
  now: number;
  ink: ColorName;
  unit: number;
  W: number;
}

function buildBlock(b: Block, bx: Box, c: Ctx): Layer[] {
  const { v, now, ink, unit } = c;
  switch (b.t) {
    case 'gap':
      return [];
    case 'rule':
      return [{ type: 'rect', box: bx, color: resolveColor(b.color, v, now, ink) }];
    case 'bar': {
      const color = resolveColor(b.color, v, now, ink);
      const pct = Math.max(0, Math.min(100, Number(fillTokens(b.value, v, now)) || 0));
      const stroke = Math.max(3, Math.round(bx.height * 0.12));
      const out: Layer[] = [{ type: 'rect', box: bx, color, stroke, radius: Math.round(bx.height / 2) }];
      const inner = Math.round(((bx.width - stroke * 4) * pct) / 100);
      if (inner > 0)
        out.push({
          type: 'rect',
          box: box(bx.x + stroke * 2, bx.y + stroke * 2, inner, bx.height - stroke * 4),
          color,
          radius: Math.round((bx.height - stroke * 4) / 2),
        });
      return out;
    }
    case 'text': {
      const text = fillTokens(b.text, v, now);
      if (!text) return [];
      const color = resolveColor(b.color, v, now, b.band ? inkOn(resolveColor(b.band, v, now, 'black')) : ink);
      const out: Layer[] = [];
      let tb = bx;
      if (b.band) {
        const band = resolveColor(b.band, v, now, 'black');
        // Edge to edge, the text keeps its margins.
        out.push({ type: 'rect', box: box(0, bx.y, c.W, bx.height), color: band });
        tb = box(bx.x, bx.y + bx.height * 0.12, bx.width, bx.height * 0.76);
      }
      out.push({
        type: 'text',
        text,
        box: tb,
        size: Math.round((b.size ?? 0.06) * unit),
        minSize: 14,
        weight: b.bold ? 'bold' : 'regular',
        color,
        align: b.align ?? 'left',
        valign: b.valign ?? 'middle',
        uppercase: b.upper,
        maxLines: b.lines,
        lineHeight: 1.1,
      });
      return out;
    }
    case 'qr': {
      const data = fillTokens(b.data, v, now);
      if (!data) return [];
      return [{ type: 'qr', data, box: bx, color: resolveColor(b.color, v, now, 'black'), background: 'white', margin: 2 }];
    }
    case 'photo': {
      const id = v[b.from];
      if (typeof id !== 'string' || !id) return [];
      const side = Math.min(bx.width, bx.height);
      const pb = b.circle ? box(bx.x + (bx.width - side) / 2, bx.y + (bx.height - side) / 2, side, side) : bx;
      return [{ type: 'photo', photo: id, box: pb, fit: 'cover', shape: b.circle ? 'circle' : { radius: Math.round(unit * 0.012) } }];
    }
    case 'list':
      return buildList(b, bx, c);
  }
}

function buildList(b: ListBlock, bx: Box, c: Ctx): Layer[] {
  const { v, now, ink, unit } = c;
  const color = resolveColor(b.color, v, now, ink);
  const accent = resolveColor(b.accent, v, now, color);
  const doneMode = b.done === 'strike' || b.done === 'hide' || b.done === undefined ? (b.done ?? 'strike') : String(v[b.done] ?? 'strike');
  let items = parseList(v[b.from]);
  if (doneMode === 'hide') items = items.filter((i) => !i.done);
  if (!items.length) return [];
  const want = Math.round((b.size ?? 0.045) * unit);
  const rowFor = (size: number) => size * 1.55;
  // Shrink to fit every item, down to a readable size; then cut with "+N more".
  const minSize = 22;
  let size = Math.min(want, bx.height / items.length / 1.55);
  let shownItems = items;
  if (size < minSize) {
    size = minSize;
    const fits = Math.max(1, Math.floor(bx.height / rowFor(size)));
    if (fits < items.length) shownItems = [...items.slice(0, fits - 1), { text: `+${items.length - fits + 1} more`, done: false }];
  }
  // One size for every row: the longest item sets it, so rows don't vary.
  const textW = bx.width - (b.check ? size * 1.25 : 0);
  // (The estimate runs wide for Inter; 0.82 brings it close to the real font.
  // A row that still doesn't fit is shrunk on its own when drawn.)
  const longest = Math.max(...shownItems.map((i) => estimateText(i.text, size, 'regular') * 0.82));
  if (longest > textW) size = Math.max(minSize, (size * textW) / longest);
  const row = rowFor(size);
  const out: Layer[] = [];
  shownItems.forEach((it, i) => {
    const y = bx.y + i * row;
    const more = it.text.startsWith('+') && i === shownItems.length - 1 && shownItems !== items;
    let tx = bx.x;
    if (b.check && !more) {
      const s = Math.round(size * 0.8);
      const by = Math.round(y + (row - s) / 2);
      out.push({ type: 'rect', box: box(bx.x, by, s, s), color: it.done ? accent : color, stroke: Math.max(3, Math.round(s * 0.12)), radius: Math.round(s * 0.18) });
      if (it.done) {
        const inset = Math.round(s * 0.26);
        out.push({ type: 'rect', box: box(bx.x + inset, by + inset, s - inset * 2, s - inset * 2), color: accent, radius: 2 });
      }
      tx = bx.x + s + size * 0.45;
    }
    const tw = bx.x + bx.width - tx;
    out.push({
      type: 'text',
      text: it.text,
      box: box(tx, y, tw, row),
      size: Math.round(size),
      minSize: Math.min(Math.round(size), 18),
      weight: 'regular',
      color: it.done ? accent : more ? ink : color,
      valign: 'middle',
      maxLines: 1,
    });
    if (it.done && doneMode === 'strike') {
      // Inter runs a little narrower than the estimate; a short line reads better than one that overshoots.
      const len = Math.min(tw, estimateText(it.text, size, 'regular') * 0.82);
      out.push({ type: 'rect', box: box(tx, y + row / 2 - size * 0.04, len, Math.max(3, size * 0.08)), color: accent });
    }
  });
  return out;
}

/** A spec as a TemplateDef, so the form, preview and send work as for any template. */
export function specTemplate(spec: TemplateSpec): TemplateDef {
  return {
    id: spec.id,
    title: spec.title,
    description: spec.description,
    uses: ['lanyard', 'bag', 'desk', 'gift'],
    layouts: spec.layouts.length,
    fields: spec.fields,
    build: (values, opts) => buildSpec(spec, values, opts),
  };
}

/** Basic checks on a spec from a catalogue file. Returns a reason, or null when it's fine. */
export function checkSpec(x: unknown): string | null {
  const s = x as Partial<TemplateSpec> | null;
  if (!s || typeof s !== 'object') return 'not an object';
  if (typeof s.id !== 'string' || !/^[a-z0-9-]+$/.test(s.id)) return 'bad id';
  if (typeof s.title !== 'string' || !s.title) return `${s.id}: no title`;
  if (!['form', 'list', 'board', 'live'].includes(s.behaviour as string)) return `${s.id}: bad behaviour`;
  if (!Array.isArray(s.fields)) return `${s.id}: no fields`;
  if (!Array.isArray(s.layouts) || !s.layouts.length || s.layouts.length > 3) return `${s.id}: needs 1 to 3 layouts`;
  for (const l of s.layouts) if (!l || !Array.isArray(l.blocks)) return `${s.id}: a layout has no blocks`;
  if (s.behaviour === 'board' && !s.board?.from) return `${s.id}: a board needs board.from`;
  if (s.behaviour === 'live' && !s.live?.rules?.length) return `${s.id}: a live template needs rules`;
  return null;
}
