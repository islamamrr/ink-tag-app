// Stickers: simple filled shapes in a 24 × 24 box, as SVG path data. Drawn
// for this app (no icon set to license), and kept bold because the panel has
// no grey: thin detail would vanish.

const r = (n: number) => Math.round(n * 100) / 100;

/** A regular star with `points` tips. */
function star(points: number, outer: number, inner: number, cx = 12, cy = 12) {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    d += `${i ? 'L' : 'M'}${r(cx + rad * Math.cos(a))} ${r(cy + rad * Math.sin(a))}`;
  }
  return `${d}Z`;
}

const circle = (cx: number, cy: number, rad: number) =>
  `M${r(cx - rad)} ${r(cy)}a${r(rad)} ${r(rad)} 0 1 0 ${r(rad * 2)} 0a${r(rad)} ${r(rad)} 0 1 0 ${r(-rad * 2)} 0Z`;

function sun() {
  let d = circle(12, 12, 5);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // A thin kite from radius 7 to 11.
    const p = (rad: number, off: number) =>
      `${r(12 + rad * c - off * s)} ${r(12 + rad * s + off * c)}`;
    d += `M${p(7, -1.2)}L${p(11, 0)}L${p(7, 1.2)}Z`;
  }
  return d;
}

function flower() {
  let d = '';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    d += circle(12 + 5.5 * Math.cos(a), 12 + 5.5 * Math.sin(a), 4.5);
  }
  return d + circle(12, 12, 3.5);
}

export const STICKERS = {
  heart: 'M12 21C5 15.5 2 12.2 2 8.2A5 5 0 0 1 12 6A5 5 0 0 1 22 8.2C22 12.2 19 15.5 12 21Z',
  star: star(5, 11, 4.6),
  sparkle: star(4, 11, 2.8),
  bolt: 'M13.5 2L4 14H11L9.5 22L20 9.5H13L13.5 2Z',
  check: 'M3.5 12.5L9 18L20.5 6.5L18.4 4.4L9 13.8L5.6 10.4Z',
  arrow: 'M2 9.5H13V4.5L22 12L13 19.5V14.5H2Z',
  bubble: 'M3 4H21V16H10L5 20.5V16H3Z',
  sun: sun(),
  flower: flower(),
  dot: circle(12, 12, 10),
} as const;

export type StickerName = keyof typeof STICKERS;
export const STICKER_NAMES = Object.keys(STICKERS) as StickerName[];
