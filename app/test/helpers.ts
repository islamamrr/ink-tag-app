import { readFileSync } from 'fs';
import { join } from 'path';
import { gunzipSync } from 'zlib';

import { FakeTag, type FakeTagOptions, SimLink, type SimLinkOptions, TagClient } from '../src/core';

export const golden = (name: string) =>
  new Uint8Array(gunzipSync(readFileSync(join(__dirname, 'golden', `${name}.gz`))));

export const goldenMeta = JSON.parse(
  readFileSync(join(__dirname, 'golden', 'golden.json'), 'utf8'),
);

export const rgbToRgba = (rgb: Uint8Array, width: number, height: number) => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgb[i * 3];
    data[i * 4 + 1] = rgb[i * 3 + 1];
    data[i * 4 + 2] = rgb[i * 3 + 2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
};

/** A connected client on a simulated badge with no delays. */
export async function simBadge(tagOpts: FakeTagOptions = {}, linkOpts: SimLinkOptions = {}) {
  const lines: string[] = [];
  const tag = new FakeTag({ timing: 'instant', log: (l) => lines.push(l), ...tagOpts });
  const link = new SimLink(tag, linkOpts);
  await link.connect();
  const log: string[] = [];
  const client = new TagClient(link, (kind, text) => log.push(`${kind} ${text}`), {
    info: 500,
    ready: 500,
    received: 500,
    displayed: 2_000,
  });
  return { tag, link, client, log, serial: lines };
}
