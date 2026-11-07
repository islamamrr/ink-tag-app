// List values for templates (to-do, shopping, a status board's choices).
// A list is kept as plain text, one item per line, so it fits the same
// Values map as every other field and survives in the library as JSON.
// "[x] " in front of an item marks it ticked; "Label | colour" gives an item
// its own colour (status boards).

import { Color, type ColorName } from '../protocol/constants';

export interface ListItem {
  text: string;
  done: boolean;
  color?: ColorName;
}

const DONE = '[x] ';
const OPEN = '[ ] ';

const isColor = (c: string): c is ColorName => Object.prototype.hasOwnProperty.call(Color, c);

export function parseList(v: unknown): ListItem[] {
  if (typeof v !== 'string') return [];
  const out: ListItem[] = [];
  for (const raw of v.split('\n')) {
    let line = raw.trim();
    if (!line) continue;
    let done = false;
    if (line.toLowerCase().startsWith(DONE)) {
      done = true;
      line = line.slice(DONE.length).trim();
    } else if (line.startsWith(OPEN)) line = line.slice(OPEN.length).trim();
    let color: ColorName | undefined;
    const bar = line.lastIndexOf('|');
    if (bar > 0) {
      const c = line.slice(bar + 1).trim().toLowerCase();
      if (isColor(c)) {
        color = c;
        line = line.slice(0, bar).trim();
      }
    }
    if (line) out.push(color ? { text: line, done, color } : { text: line, done });
  }
  return out;
}

export function formatList(items: ListItem[]): string {
  return items
    .filter((i) => i.text.trim())
    .map((i) => `${i.done ? DONE : ''}${i.text.trim()}${i.color ? ` | ${i.color}` : ''}`)
    .join('\n');
}
