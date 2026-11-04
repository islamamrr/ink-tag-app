// Templates: fill in a short form, pick a layout and a highlight colour, get
// a scene. Every template lays itself out from the canvas size, so it works
// upright and sideways. The Create tiles (Text, QR code, Collage) are
// templates too, and so is the "Hello" picture drawn when a badge is added.

import type { ColorName } from '../protocol/constants';
import type { Orientation } from '../imaging/frame';
import { normalizeUrl, vcard, wifiPayload, type WifiSecurity } from './qr';
import { type Box, type Layer, type Scene, sceneSize } from './scene';

export type BadgeUse = 'lanyard' | 'bag' | 'desk' | 'gift';

export type FieldKind =
  | 'text'
  | 'multiline'
  | 'url'
  | 'phone'
  | 'email'
  | 'password'
  | 'photo'
  | 'choice'
  | 'toggle';

export interface Field {
  key: string;
  label: string;
  kind: FieldKind;
  default?: string | boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  /** The scene is still drawn without it, but the form should ask. */
  required?: boolean;
}

export type Values = Record<string, string | boolean | undefined>;

export interface BuildOptions {
  orientation?: Orientation;
  /** 0-based; see TemplateDef.layouts. */
  layout?: number;
}

export interface TemplateDef {
  id: string;
  title: string;
  description: string;
  /** Uses this template is shown first for. */
  uses: BadgeUse[];
  /** Number of layouts to pick from. */
  layouts: number;
  fields: Field[];
  build(values: Values, opts?: BuildOptions): Scene;
}

export const HIGHLIGHTS: { value: ColorName | 'none'; label: string }[] = [
  { value: 'red', label: 'Red' },
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'none', label: 'None' },
];

const highlightField: Field = {
  key: 'highlight',
  label: 'Highlight colour',
  kind: 'choice',
  default: 'red',
  options: HIGHLIGHTS,
};

/** Text that reads on a highlight: black on yellow, white on the darker colours. */
export const inkOn = (bg: ColorName): ColorName =>
  bg === 'white' || bg === 'yellow' ? 'black' : 'white';

// ---------------------------------------------------------------- helpers

const str = (v: Values, k: string, fallback = '') => {
  const x = v[k];
  return typeof x === 'string' ? x.trim() : fallback;
};
const bool = (v: Values, k: string) => v[k] === true || v[k] === 'true';
const hl = (v: Values): ColorName => {
  const h = str(v, 'highlight', 'red');
  return h === 'none' ? 'black' : (h as ColorName);
};

/** Fills unset values with field defaults, so build() and the form agree. */
export function withDefaults(t: TemplateDef, values: Values): Values {
  const out: Values = {};
  for (const f of t.fields) out[f.key] = values[f.key] ?? f.default;
  return { ...out, ...Object.fromEntries(Object.entries(values).filter(([, x]) => x !== undefined)) };
}

class Canvas {
  readonly W: number;
  readonly H: number;
  readonly landscape: boolean;
  /** Margin: 6% of the short side. */
  readonly m: number;
  readonly layers: Layer[] = [];
  constructor(readonly orientation: Orientation) {
    const { width, height } = sceneSize({ orientation });
    this.W = width;
    this.H = height;
    this.landscape = orientation === 'landscape';
    this.m = Math.round(Math.min(width, height) * 0.06);
  }
  box(x: number, y: number, width: number, height: number): Box {
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  }
  add(...l: Layer[]) {
    this.layers.push(...l);
    return this;
  }
  scene(background: ColorName = 'white'): Scene {
    return { version: 1, orientation: this.orientation, background, layers: this.layers };
  }
}

const text = (
  box: Box,
  t: string,
  size: number,
  color: ColorName,
  more: Partial<Extract<Layer, { type: 'text' }>> = {},
): Layer => ({ type: 'text', text: t, box, size, color, ...more });

// ---------------------------------------------------------------- name badge

const nameBadge: TemplateDef = {
  id: 'name-badge',
  title: 'Name badge',
  description: 'Your name, role and company, with an optional photo and QR code.',
  uses: ['lanyard'],
  layouts: 3,
  fields: [
    { key: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'Your name' },
    { key: 'role', label: 'Role', kind: 'text', placeholder: 'What you do' },
    { key: 'company', label: 'Company', kind: 'text' },
    { key: 'link', label: 'QR code links to', kind: 'url', placeholder: 'linkedin.com/in/…' },
    { key: 'photo', label: 'Profile photo', kind: 'photo' },
    highlightField,
  ],
  build(v, { orientation = 'portrait', layout = 0 } = {}) {
    const c = new Canvas(orientation);
    const { W, H, m } = c;
    const color = hl(v);
    const name = str(v, 'name', 'Your name');
    const role = str(v, 'role');
    const company = str(v, 'company');
    const link = str(v, 'link');
    const photo = str(v, 'photo');

    if (layout === 1) {
      // Big centred name, company in a band at the bottom.
      const band = H * 0.2;
      c.add(text(c.box(m, m, W - m * 2, H - band - m * 2), name, H * 0.2, 'black', {
        weight: 'bold', align: 'center', valign: 'middle', maxLines: 3,
      }));
      if (role)
        c.add(text(c.box(m, H - band - m - H * 0.08, W - m * 2, H * 0.07), role, H * 0.05, color === 'yellow' ? 'black' : color, {
          align: 'center', valign: 'bottom', maxLines: 1,
        }));
      c.add({ type: 'rect', box: c.box(0, H - band, W, band), color });
      c.add(text(c.box(m, H - band, W - m * 2, band), company || ' ', band * 0.4, inkOn(color), {
        weight: 'bold', align: 'center', valign: 'middle', maxLines: 1,
      }));
      return c.scene();
    }

    if (layout === 2) {
      // Photo across the top half, name in a band over its bottom edge.
      const split = c.landscape ? W * 0.45 : H * 0.5;
      if (c.landscape) {
        if (photo) c.add({ type: 'photo', photo, box: c.box(0, 0, split, H), fit: 'cover' });
        else c.add({ type: 'rect', box: c.box(0, 0, split, H), color });
        c.add(text(c.box(split + m, m, W - split - m * 2, H * 0.5), name, H * 0.16, 'black', {
          weight: 'bold', valign: 'bottom', maxLines: 3,
        }));
        c.add(text(c.box(split + m, H * 0.55, W - split - m * 2, H * 0.4), [role, company].filter(Boolean).join('\n'), H * 0.07, color === 'yellow' ? 'black' : color, { maxLines: 4 }));
        return c.scene();
      }
      if (photo) c.add({ type: 'photo', photo, box: c.box(0, 0, W, split), fit: 'cover' });
      else c.add({ type: 'rect', box: c.box(0, 0, W, split), color });
      const band = H * 0.12;
      c.add({ type: 'rect', box: c.box(0, split - band / 2, W, band), color });
      c.add(text(c.box(m, split - band / 2, W - m * 2, band), name, band * 0.6, inkOn(color), {
        weight: 'bold', valign: 'middle', maxLines: 1, minSize: 18,
      }));
      c.add(text(c.box(m, split + band / 2 + m, W - m * 2, H - split - band / 2 - m * 2), [role, company].filter(Boolean).join('\n'), H * 0.06, 'black', { maxLines: 4 }));
      return c.scene();
    }

    // Layout 0: highlight strip, round photo, name, role and company, QR in the corner.
    const strip = H * 0.06;
    c.add({ type: 'rect', box: c.box(0, 0, W, strip), color });
    let top = strip + m;
    const photoSize = Math.min(W, H) * 0.42;
    if (photo) {
      c.add({ type: 'photo', photo, box: c.box(m, top, photoSize, photoSize), fit: 'cover', shape: 'circle' });
      top += photoSize + m * 0.6;
    }
    const qrSize = link ? Math.min(W, H) * 0.34 : 0;
    const textBottom = H - m - (c.landscape ? 0 : qrSize + m * 0.5);
    const textW = c.landscape && link ? W - m * 3 - qrSize : W - m * 2;
    c.add(text(c.box(m, top, textW, (textBottom - top) * 0.5), name, H * 0.11, 'black', {
      weight: 'bold', valign: 'bottom', maxLines: 2,
    }));
    const sub = [role, company].filter(Boolean).join('\n');
    if (sub)
      c.add(text(c.box(m, top + (textBottom - top) * 0.53, textW, (textBottom - top) * 0.47), sub, H * 0.05, color === 'yellow' ? 'black' : color, { maxLines: 3 }));
    if (link)
      c.add({ type: 'qr', data: normalizeUrl(link), box: c.box(W - m - qrSize, H - m - qrSize, qrSize, qrSize) });
    return c.scene();
  },
};

// ---------------------------------------------------------------- event ticket

const eventTicket: TemplateDef = {
  id: 'event-ticket',
  title: 'Event ticket',
  description: 'Event, date and place, who it belongs to, and a QR code for the door.',
  uses: ['lanyard'],
  layouts: 1,
  fields: [
    { key: 'event', label: 'Event', kind: 'text', required: true, placeholder: 'Event name' },
    { key: 'date', label: 'Date', kind: 'text', placeholder: '12 March' },
    { key: 'time', label: 'Time', kind: 'text', placeholder: '19:00' },
    { key: 'place', label: 'Place', kind: 'text' },
    { key: 'holder', label: 'Name on the ticket', kind: 'text' },
    { key: 'seat', label: 'Seat or ticket number', kind: 'text' },
    { key: 'code', label: 'QR code (ticket link or code)', kind: 'text' },
    highlightField,
  ],
  build(v, { orientation = 'portrait' } = {}) {
    const c = new Canvas(orientation);
    const { W, H, m } = c;
    const color = hl(v);
    const head = H * (c.landscape ? 0.26 : 0.2);
    c.add({ type: 'rect', box: c.box(0, 0, W, head), color });
    c.add(text(c.box(m, m * 0.5, W - m * 2, head - m), str(v, 'event', 'Event'), head * 0.45, inkOn(color), {
      weight: 'bold', valign: 'middle', maxLines: 2, uppercase: true,
    }));
    const when = [str(v, 'date'), str(v, 'time')].filter(Boolean).join(' · ');
    const code = str(v, 'code');
    const qr = code ? Math.min(W, H) * (c.landscape ? 0.5 : 0.42) : 0;
    const colW = c.landscape && code ? W - m * 3 - qr : W - m * 2;
    let y = head + m;
    const line = (t: string, size: number, bold = false, color: ColorName = 'black') => {
      if (!t) return;
      c.add(text(c.box(m, y, colW, size * 1.25), t, size, color, { weight: bold ? 'bold' : 'regular', maxLines: 1, minSize: 14 }));
      y += size * 1.35;
    };
    line(when, H * 0.055, true);
    line(str(v, 'place'), H * 0.045);
    y += m * 0.4;
    // A perforation, like a paper ticket.
    const perf = c.landscape ? W - qr - m * 2 : W;
    for (let x = m * 0.5; x < perf - m * 0.5; x += 24)
      c.add({ type: 'rect', box: c.box(x, y, 12, 4), color: 'black' });
    y += m * 0.8;
    const holder = str(v, 'holder');
    if (holder) {
      line('ADMIT', H * 0.025, false, color === 'yellow' ? 'black' : color);
      line(holder, H * 0.06, true);
    }
    const seat = str(v, 'seat');
    if (seat) line(seat, H * 0.045);
    if (code)
      c.add({ type: 'qr', data: code, box: c.box(W - m - qr, H - m - qr, qr, qr) });
    return c.scene();
  },
};

// ---------------------------------------------------------------- contact QR

const contactQr: TemplateDef = {
  id: 'contact-qr',
  title: 'Contact QR',
  description: 'A QR code people scan to save your contact card.',
  uses: ['lanyard', 'desk'],
  layouts: 1,
  fields: [
    { key: 'name', label: 'Name', kind: 'text', required: true },
    { key: 'title', label: 'Job title', kind: 'text' },
    { key: 'org', label: 'Company', kind: 'text' },
    { key: 'phone', label: 'Phone', kind: 'phone' },
    { key: 'email', label: 'Email', kind: 'email' },
    { key: 'url', label: 'Website', kind: 'url' },
    { key: 'caption', label: 'Caption', kind: 'text', default: 'Scan to save my contact' },
    highlightField,
  ],
  build(v, { orientation = 'portrait' } = {}) {
    const c = new Canvas(orientation);
    const { W, H, m } = c;
    const color = hl(v);
    const name = str(v, 'name', 'Your name');
    const payload = vcard({
      name,
      title: str(v, 'title') || undefined,
      org: str(v, 'org') || undefined,
      phone: str(v, 'phone') || undefined,
      email: str(v, 'email') || undefined,
      url: str(v, 'url') || undefined,
    });
    const sub = [str(v, 'title'), str(v, 'org')].filter(Boolean).join(' · ');
    if (c.landscape) {
      const q = H - m * 2;
      c.add({ type: 'qr', data: payload, box: c.box(W - m - q, m, q, q), level: 'L' });
      const tw = W - q - m * 3;
      c.add(text(c.box(m, m, tw, H * 0.5), name, H * 0.15, 'black', { weight: 'bold', valign: 'bottom', maxLines: 3 }));
      if (sub) c.add(text(c.box(m, H * 0.54, tw, H * 0.2), sub, H * 0.07, color === 'yellow' ? 'black' : color, { maxLines: 2 }));
      c.add(text(c.box(m, H - m - H * 0.12, tw, H * 0.12), str(v, 'caption'), H * 0.05, 'black', { valign: 'bottom', maxLines: 2 }));
      return c.scene();
    }
    c.add(text(c.box(m, m, W - m * 2, H * 0.17), name, H * 0.08, 'black', { weight: 'bold', align: 'center', valign: 'bottom', maxLines: 2 }));
    if (sub) c.add(text(c.box(m, m + H * 0.18, W - m * 2, H * 0.06), sub, H * 0.04, color === 'yellow' ? 'black' : color, { align: 'center', maxLines: 1, minSize: 14 }));
    const q = W - m * 2;
    c.add({ type: 'qr', data: payload, box: c.box(m, H * 0.27, q, q), level: 'L' });
    const cap = H * 0.09;
    c.add({ type: 'rect', box: c.box(0, H - cap, W, cap), color });
    c.add(text(c.box(m, H - cap, W - m * 2, cap), str(v, 'caption'), cap * 0.38, inkOn(color), { weight: 'bold', align: 'center', valign: 'middle', maxLines: 1 }));
    return c.scene();
  },
};

// ---------------------------------------------------------------- Wi-Fi QR

const wifiQr: TemplateDef = {
  id: 'wifi-qr',
  title: 'Wi-Fi QR',
  description: 'Guests scan it to join your Wi-Fi.',
  uses: ['desk', 'gift'],
  layouts: 1,
  fields: [
    { key: 'ssid', label: 'Network name', kind: 'text', required: true },
    { key: 'password', label: 'Password', kind: 'password' },
    {
      key: 'security',
      label: 'Security',
      kind: 'choice',
      default: 'WPA',
      options: [
        { value: 'WPA', label: 'WPA / WPA2 / WPA3' },
        { value: 'WEP', label: 'WEP' },
        { value: 'none', label: 'None (open)' },
      ],
    },
    { key: 'hidden', label: 'Hidden network', kind: 'toggle', default: false },
    { key: 'showPassword', label: 'Print the password too', kind: 'toggle', default: true },
    highlightField,
  ],
  build(v, { orientation = 'portrait' } = {}) {
    const c = new Canvas(orientation);
    const { W, H, m } = c;
    const color = hl(v);
    const ssid = str(v, 'ssid', 'Network');
    const password = str(v, 'password');
    const security = (str(v, 'security', 'WPA') as WifiSecurity) || 'WPA';
    const payload = wifiPayload({ ssid, password, security, hidden: bool(v, 'hidden') });
    const lines = [`Network: ${ssid}`];
    if (password && security !== 'none' && bool(v, 'showPassword')) lines.push(`Password: ${password}`);
    if (c.landscape) {
      const q = H - m * 2;
      c.add({ type: 'qr', data: payload, box: c.box(W - m - q, m, q, q) });
      const tw = W - q - m * 3;
      c.add({ type: 'rect', box: c.box(0, 0, tw + m * 1.5, H * 0.3), color });
      c.add(text(c.box(m, 0, tw, H * 0.3), 'Wi-Fi', H * 0.15, inkOn(color), { weight: 'bold', valign: 'middle' }));
      c.add(text(c.box(m, H * 0.36, tw, H * 0.6), lines.join('\n'), H * 0.08, 'black', { maxLines: 4 }));
      return c.scene();
    }
    const head = H * 0.16;
    c.add({ type: 'rect', box: c.box(0, 0, W, head), color });
    c.add(text(c.box(m, 0, W - m * 2, head), 'Wi-Fi', head * 0.55, inkOn(color), { weight: 'bold', align: 'center', valign: 'middle' }));
    const q = W - m * 2;
    c.add({ type: 'qr', data: payload, box: c.box(m, head + m * 0.6, q, q) });
    const ty = head + m * 1.2 + q;
    c.add(text(c.box(m, ty, W - m * 2, H - ty - m * 0.5), lines.join('\n'), H * 0.04, 'black', { align: 'center', maxLines: 3, minSize: 14 }));
    return c.scene();
  },
};

// ---------------------------------------------------------------- quote

const quote: TemplateDef = {
  id: 'quote',
  title: 'Quote',
  description: 'A favourite line, as large as it fits.',
  uses: ['desk', 'gift', 'bag'],
  layouts: 2,
  fields: [
    { key: 'quote', label: 'Quote', kind: 'multiline', required: true },
    { key: 'author', label: 'Who said it', kind: 'text' },
    highlightField,
  ],
  build(v, { orientation = 'portrait', layout = 0 } = {}) {
    const c = new Canvas(orientation);
    const { W, H, m } = c;
    const color = hl(v);
    const author = str(v, 'author');
    const inverted = layout === 1;
    const bg: ColorName = inverted ? color : 'white';
    const ink: ColorName = inverted ? inkOn(color) : 'black';
    const accent: ColorName = inverted ? ink : color === 'yellow' ? 'black' : color;
    c.add(text(c.box(m, m * 0.4, W * 0.4, H * 0.18), '“', H * 0.25, accent, { weight: 'bold', fixedSize: true }));
    const authorH = author ? H * 0.1 : 0;
    c.add(text(c.box(m, m + H * 0.12, W - m * 2, H - m * 2 - H * 0.12 - authorH), str(v, 'quote', 'Your quote'), H * 0.12, ink, {
      weight: 'bold', valign: 'middle', lineHeight: 1.15,
    }));
    if (author)
      c.add(text(c.box(m, H - m - authorH, W - m * 2, authorH), `— ${author}`, H * 0.045, accent, { align: 'right', valign: 'bottom', maxLines: 2, minSize: 14 }));
    return c.scene(bg);
  },
};

// ---------------------------------------------------------------- status sign

export const STATUSES: Record<string, { label: string; color: ColorName }> = {
  busy: { label: 'Busy', color: 'red' },
  free: { label: 'Free', color: 'green' },
  meeting: { label: 'In a meeting', color: 'blue' },
  back: { label: 'Back soon', color: 'yellow' },
  dnd: { label: 'Do not disturb', color: 'red' },
  custom: { label: 'Custom', color: 'black' },
};

const statusSign: TemplateDef = {
  id: 'status-sign',
  title: 'Status sign',
  description: 'Busy, free, back soon: one big word anyone can read from the door.',
  uses: ['desk'],
  layouts: 2,
  fields: [
    {
      key: 'status',
      label: 'Status',
      kind: 'choice',
      default: 'busy',
      options: Object.entries(STATUSES).map(([value, s]) => ({ value, label: s.label })),
    },
    { key: 'custom', label: 'Your own words (for Custom)', kind: 'text' },
    { key: 'note', label: 'Small print', kind: 'text', placeholder: 'Back at 14:00' },
  ],
  build(v, { orientation = 'portrait', layout = 0 } = {}) {
    const c = new Canvas(orientation);
    const { W, H, m } = c;
    const key = str(v, 'status', 'busy');
    const st = STATUSES[key] ?? STATUSES.busy;
    const label = key === 'custom' ? str(v, 'custom', 'Custom') : st.label;
    const note = str(v, 'note');
    // Layout 0: the whole badge in the status colour. Layout 1: white with a coloured word.
    const filled = layout === 0;
    const bg: ColorName = filled ? st.color : 'white';
    const ink: ColorName = filled ? inkOn(st.color) : st.color === 'yellow' ? 'black' : st.color;
    const noteH = note ? H * 0.14 : 0;
    if (!filled) c.add({ type: 'frame', style: 'line', color: st.color === 'yellow' ? 'black' : st.color, width: 14, inset: m * 0.6 });
    c.add(text(c.box(m * 1.5, m * 1.5, W - m * 3, H - m * 3 - noteH), label, H * 0.25, ink, {
      weight: 'bold', align: 'center', valign: 'middle', uppercase: true, lineHeight: 1.05,
    }));
    if (note)
      c.add(text(c.box(m * 1.5, H - m * 1.5 - noteH, W - m * 3, noteH), note, H * 0.055, ink, { align: 'center', valign: 'middle', maxLines: 2, minSize: 14 }));
    return c.scene(bg);
  },
};

// ---------------------------------------------------------------- Create tiles

const bigText: TemplateDef = {
  id: 'text',
  title: 'Text',
  description: 'Big words, a quote, a status.',
  uses: ['lanyard', 'bag', 'desk', 'gift'],
  layouts: 1,
  fields: [
    { key: 'text', label: 'Text', kind: 'multiline', required: true },
    {
      key: 'color',
      label: 'Text colour',
      kind: 'choice',
      default: 'black',
      options: ['black', 'red', 'blue', 'green', 'yellow', 'white'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })),
    },
    {
      key: 'background',
      label: 'Background',
      kind: 'choice',
      default: 'white',
      options: ['white', 'black', 'red', 'blue', 'green', 'yellow'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })),
    },
    {
      key: 'align',
      label: 'Align',
      kind: 'choice',
      default: 'center',
      options: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Centre' },
        { value: 'right', label: 'Right' },
      ],
    },
  ],
  build(v, { orientation = 'portrait' } = {}) {
    const c = new Canvas(orientation);
    const { W, H, m } = c;
    const bg = str(v, 'background', 'white') as ColorName;
    let ink = str(v, 'color', 'black') as ColorName;
    if (ink === bg) ink = inkOn(bg);
    c.add(text(c.box(m, m, W - m * 2, H - m * 2), str(v, 'text', 'Hello'), H * 0.3, ink, {
      weight: 'bold', align: (str(v, 'align', 'center') as 'left') || 'center', valign: 'middle', lineHeight: 1.1,
    }));
    return c.scene(bg);
  },
};

const qrCode: TemplateDef = {
  id: 'qr',
  title: 'QR code',
  description: 'A link or any text as a QR code, with a caption.',
  uses: ['lanyard', 'desk', 'bag', 'gift'],
  layouts: 1,
  fields: [
    { key: 'data', label: 'Link or text', kind: 'url', required: true },
    { key: 'caption', label: 'Caption', kind: 'text' },
  ],
  build(v, { orientation = 'portrait' } = {}) {
    const c = new Canvas(orientation);
    const { W, H, m } = c;
    const raw = str(v, 'data', 'https://example.com');
    const data = /\s/.test(raw) || !raw.includes('.') ? raw : normalizeUrl(raw);
    const caption = str(v, 'caption');
    const capH = caption ? Math.min(W, H) * 0.2 : 0;
    const area = c.landscape
      ? c.box(m, m, W - m * 2, H - m * 2 - capH)
      : c.box(m, (H - (W - m * 2) - capH) / 2, W - m * 2, W - m * 2);
    c.add({ type: 'qr', data, box: area });
    if (caption)
      c.add(text(c.box(m, area.y + area.height + m * 0.3, W - m * 2, capH), caption, capH * 0.4, 'black', { weight: 'bold', align: 'center', maxLines: 2 }));
    return c.scene();
  },
};

const collage: TemplateDef = {
  id: 'collage',
  title: 'Collage',
  description: '2 to 4 photos in a grid.',
  uses: ['gift', 'desk', 'bag'],
  layouts: 3,
  fields: [
    { key: 'photo1', label: 'Photo 1', kind: 'photo', required: true },
    { key: 'photo2', label: 'Photo 2', kind: 'photo', required: true },
    { key: 'photo3', label: 'Photo 3', kind: 'photo' },
    { key: 'photo4', label: 'Photo 4', kind: 'photo' },
    {
      key: 'gap',
      label: 'Gap colour',
      kind: 'choice',
      default: 'white',
      options: ['white', 'black', 'red', 'blue', 'green', 'yellow'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })),
    },
  ],
  build(v, { orientation = 'portrait', layout = 0 } = {}) {
    const c = new Canvas(orientation);
    const { W, H } = c;
    const photos = ['photo1', 'photo2', 'photo3', 'photo4'].map((k) => str(v, k)).filter(Boolean);
    const g = 8;
    const cells = collageCells(photos.length || 1, layout, W, H, g);
    cells.forEach((b, i) => {
      const p = photos[i];
      if (p) c.add({ type: 'photo', photo: p, box: c.box(b.x, b.y, b.width, b.height), fit: 'cover' });
    });
    return c.scene(str(v, 'gap', 'white') as ColorName);
  },
};

/** Grid cells for n photos. Layout 0: even grid; 1: one big, rest small; 2: strips. */
export function collageCells(n: number, layout: number, W: number, H: number, g: number): Box[] {
  const tall = H >= W;
  const split = (b: Box, k: number, vertical: boolean): Box[] =>
    Array.from({ length: k }, (_, i) =>
      vertical
        ? { x: b.x, y: b.y + i * ((b.height + g) / k), width: b.width, height: (b.height + g) / k - g }
        : { x: b.x + i * ((b.width + g) / k), y: b.y, width: (b.width + g) / k - g, height: b.height },
    );
  const all: Box = { x: g, y: g, width: W - g * 2, height: H - g * 2 };
  if (n <= 1) return [all];
  if (layout === 2 || n === 2) return split(all, n, tall);
  if (layout === 1) {
    const [big, rest] = split(all, 2, tall);
    return [big, ...split(rest, n - 1, !tall)];
  }
  // Even grid: two rows (portrait) of up to two.
  const rows = split(all, 2, tall);
  if (n === 3) return [rows[0], ...split(rows[1], 2, !tall)];
  return [...split(rows[0], 2, !tall), ...split(rows[1], 2, !tall)];
}

// ---------------------------------------------------------------- hello

/** Drawn when a badge is added: its name, and one stripe per colour as a screen test. */
export function helloScene(badgeName: string, orientation: Orientation = 'portrait'): Scene {
  const c = new Canvas(orientation);
  const { W, H, m } = c;
  const colors: ColorName[] = ['black', 'red', 'yellow', 'green', 'blue'];
  const stripe = H * 0.05;
  colors.forEach((col, i) =>
    c.add({ type: 'rect', box: c.box((W / colors.length) * i, H - stripe, W / colors.length + 1, stripe), color: col }),
  );
  c.add(text(c.box(m, m, W - m * 2, H * 0.5), 'Hello', H * 0.22, 'black', { weight: 'bold', align: 'center', valign: 'bottom', fixedSize: false }));
  c.add(text(c.box(m, H * 0.55, W - m * 2, H * 0.3), badgeName, H * 0.07, 'blue', { align: 'center', maxLines: 2 }));
  return c.scene();
}

// ---------------------------------------------------------------- registry

export const TEMPLATES: TemplateDef[] = [
  nameBadge,
  eventTicket,
  contactQr,
  wifiQr,
  quote,
  statusSign,
  bigText,
  qrCode,
  collage,
];

export const template = (id: string): TemplateDef => {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`no template ${id}`);
  return t;
};

/** The six "real" templates (not the Create tiles), the ones for `use` first. */
export function templatesFor(use?: BadgeUse): TemplateDef[] {
  const list = TEMPLATES.slice(0, 6);
  if (!use) return list;
  return [...list.filter((t) => t.uses.includes(use)), ...list.filter((t) => !t.uses.includes(use))];
}

/** Builds a template, with defaults filled in. */
export function buildTemplate(id: string, values: Values, opts?: BuildOptions): Scene {
  const t = template(id);
  return t.build(withDefaults(t, values), opts);
}
