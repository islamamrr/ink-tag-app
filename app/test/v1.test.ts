// v1 product layer on a laptop: lock, designs, templates, styles, progress,
// library and the InkTag service against simulated badges.

import {
  collageCells,
  compile,
  createRgba,
  type DrawOp,
  estimateText,
  ErrorCode,
  FakeTag,
  fromHex,
  hmacSha256,
  InkTag,
  type InkTagDeps,
  Library,
  LockedError,
  MemoryStorage,
  PALETTE,
  parseInfo,
  ProgressTracker,
  DEFAULT_TIMINGS,
  qrMatrix,
  type Scene,
  type SceneRenderer,
  sha256,
  STICKER_NAMES,
  STYLES,
  TEMPLATES,
  buildTemplate,
  layoutText,
  sceneSize,
  checkScreen,
  toHex,
  toneFor,
  userMessage,
  vcard,
  wifiPayload,
  normalizeUrl,
  proximity,
  type SendProgress,
  templatesFor,
  emptyScene,
  FRAME_BYTES,
  SimLink,
  TagClient,
  TagError,
} from '../src/core';
import { simBadge } from './helpers';

const enc = (s: string) => new TextEncoder().encode(s);

// ------------------------------------------------------------------ crypto

test('SHA-256 and HMAC match the published test vectors', () => {
  expect(toHex(sha256(enc('')))).toBe(
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  expect(toHex(sha256(enc('abc')))).toBe(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  // 56 bytes: the padding spills into a second block.
  expect(toHex(sha256(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
  // RFC 4231 test case 2.
  expect(toHex(hmacSha256(enc('Jefe'), enc('what do ya want for nothing?')))).toBe(
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  );
  // RFC 4231 test case 6: a key longer than the block.
  expect(
    toHex(
      hmacSha256(
        new Uint8Array(131).fill(0xaa),
        enc('Test Using Larger Than Block-Size Key - Hash Key First'),
      ),
    ),
  ).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
  expect(toHex(fromHex('00ff10'))).toBe('00ff10');
});

// ------------------------------------------------------------------ lock protocol

describe('badge lock (firmware 0.4)', () => {
  const key = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
  const other = new Uint8Array(16).fill(9);

  test('INFO reports the lock flags', async () => {
    const { client } = await simBadge();
    let info = await client.info();
    expect(info.lock).toEqual({ locked: false, authorized: true });
    info = await client.lock(key);
    expect(info.lock).toEqual({ locked: true, authorized: true });
    // Older firmware has no lock field at all.
    expect(parseInfo(new FakeTag({ firmware: [0, 3, 0] }).info()).lock).toBeUndefined();
  });

  test('a locked badge refuses other phones and accepts the owner', async () => {
    const { client, tag, link } = await simBadge();
    await client.lock(key);
    await (await client.upload(new Uint8Array(FRAME_BYTES))).displayed;

    // A new connection starts unauthorized.
    link.drop();
    const b = await simBadge();
    const fresh = b.client;
    // Reuse the same simulated badge behind a new link.
    b.tag.ownerKey = tag.ownerKey;
    b.tag.stored = tag.stored;
    expect((await fresh.info()).lock).toEqual({ locked: true, authorized: false });
    await expect(fresh.show()).rejects.toMatchObject({ code: ErrorCode.LOCKED });
    await expect(fresh.lock(other)).rejects.toMatchObject({ code: ErrorCode.LOCKED });
    await expect(fresh.unlock()).rejects.toMatchObject({ code: ErrorCode.LOCKED });
    await expect(fresh.authenticate(other)).rejects.toBeInstanceOf(LockedError);
    // The wrong answer used up the challenge; the right key still works.
    const info = await fresh.authenticate(key);
    expect(info.lock).toEqual({ locked: true, authorized: true });
    expect(await fresh.show()).not.toBeUndefined();
    await fresh.unlock();
    expect((await fresh.info()).lock?.locked).toBe(false);
  });

  test('the key never goes over the air', async () => {
    const { client, log } = await simBadge();
    await client.lock(key);
    await client.authenticate(key);
    expect(log.join('\n')).not.toContain(toHex(key));
    expect(log.join('\n')).toContain('LOCK (16 bytes)');
  });

  test('locked errors read plainly', () => {
    expect(userMessage(new LockedError())).toMatch(/locked to another phone/);
    expect(userMessage(new TagError(ErrorCode.LOCKED, 0x01))).toMatch(/hold its button for 10 seconds/);
  });
});

// ------------------------------------------------------------------ design

describe('QR codes', () => {
  test('matrix grows with the data', () => {
    expect(qrMatrix('hi').length).toBe(21);
    expect(qrMatrix('x'.repeat(200)).length).toBeGreaterThan(21);
    expect(() => qrMatrix('x'.repeat(5000))).toThrow();
  });

  test('vCard and Wi-Fi payloads are escaped', () => {
    const v = vcard({ name: 'Islam Amr', org: 'Ink; Tag', url: 'inktag.dev' });
    expect(v).toContain('N:Amr;Islam;;;');
    expect(v).toContain('ORG:Ink\\; Tag');
    expect(v).toContain('URL:https://inktag.dev');
    expect(wifiPayload({ ssid: 'Home;Net', password: 'p:ss"w' })).toBe('WIFI:T:WPA;S:Home\\;Net;P:p\\:ss\\"w;;');
    expect(wifiPayload({ ssid: 'Cafe', security: 'none', password: 'x', hidden: true })).toBe(
      'WIFI:T:nopass;S:Cafe;H:true;;',
    );
    expect(normalizeUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
  });

  test('every module is a whole number of pixels', () => {
    const ops = compile(
      { version: 1, orientation: 'portrait', background: 'white', layers: [{ type: 'qr', data: 'hello', box: { x: 10, y: 10, width: 300, height: 400 } }] },
      estimateText,
    );
    const path = ops.find((o) => o.op === 'path') as Extract<DrawOp, { op: 'path' }>;
    expect(path.box.width).toBe(path.box.height);
    expect(path.box.width % 25).toBe(0); // 21 modules + 2 × 2 margin
  });
});

describe('text layout', () => {
  const box = { x: 0, y: 0, width: 300, height: 200 };

  test('wraps words and shrinks until it fits', () => {
    const ops = layoutText(
      { type: 'text', text: 'Hello there general Kenobi', box, size: 120, color: 'black' },
      estimateText,
    ) as Extract<DrawOp, { op: 'text' }>[];
    expect(ops.length).toBeGreaterThan(1);
    for (const o of ops) expect(estimateText(o.text, o.size, 'regular')).toBeLessThanOrEqual(300.5);
    expect(ops.at(-1)!.y).toBeLessThanOrEqual(200);
    expect(ops[0].size).toBeLessThan(120);
  });

  test('maxLines ends with an ellipsis; alignment and newlines', () => {
    const ops = layoutText(
      { type: 'text', text: 'one two three four five six seven eight nine ten', box, size: 30, fixedSize: true, maxLines: 2, color: 'black' },
      estimateText,
    ) as Extract<DrawOp, { op: 'text' }>[];
    expect(ops).toHaveLength(2);
    expect(ops[1].text.endsWith('…')).toBe(true);
    const c = layoutText({ type: 'text', text: 'a\nbb', box, size: 20, fixedSize: true, align: 'right', color: 'red' }, estimateText) as Extract<DrawOp, { op: 'text' }>[];
    expect(c.map((o) => o.text)).toEqual(['a', 'bb']);
    expect(c[0].x).toBeCloseTo(300 - estimateText('a', 20, 'regular'));
  });

  test('a single long word is broken at the smallest size', () => {
    const ops = layoutText(
      { type: 'text', text: 'Supercalifragilisticexpialidocious', box: { x: 0, y: 0, width: 100, height: 400 }, size: 40, minSize: 20, color: 'black' },
      estimateText,
    ) as Extract<DrawOp, { op: 'text' }>[];
    for (const o of ops) expect(estimateText(o.text, o.size, 'regular')).toBeLessThanOrEqual(100.5);
  });
});

describe('templates', () => {
  const sample: Record<string, string> = {
    name: 'Islam Amr',
    role: 'Hardware maker',
    company: 'Ink Tag',
    link: 'linkedin.com/in/someone',
    photo: 'p1.jpg',
    event: 'Maker Faire',
    date: '12 March',
    time: '19:00',
    place: 'Hall 3',
    holder: 'Islam Amr',
    seat: 'Row 4 · Seat 12',
    code: 'TICKET-123',
    phone: '+20 100 000 0000',
    email: 'me@example.com',
    ssid: 'Home',
    password: 'secret',
    quote: 'Make it work, make it right, make it fast.',
    author: 'Kent Beck',
    text: 'Hello',
    data: 'inktag.dev',
    caption: 'Scan me',
    photo1: 'a.jpg',
    photo2: 'b.jpg',
    photo3: 'c.jpg',
  };

  test.each(TEMPLATES.map((t) => [t.id, t] as const))('%s lays out inside the badge', (_, t) => {
    for (const orientation of ['portrait', 'landscape'] as const) {
      for (let layout = 0; layout < t.layouts; layout++) {
        const scene = buildTemplate(t.id, sample, { orientation, layout });
        const { width, height } = sceneSize(scene);
        expect(scene.layers.length).toBeGreaterThan(0);
        for (const l of scene.layers) {
          if (!('box' in l)) continue;
          expect(l.box.x).toBeGreaterThanOrEqual(-1);
          expect(l.box.y).toBeGreaterThanOrEqual(-1);
          expect(l.box.x + l.box.width).toBeLessThanOrEqual(width + 1);
          expect(l.box.y + l.box.height).toBeLessThanOrEqual(height + 1);
          expect(l.box.width).toBeGreaterThan(0);
          expect(l.box.height).toBeGreaterThan(0);
        }
        expect(() => compile(scene, estimateText)).not.toThrow();
      }
    }
  });

  test('defaults draw something even with an empty form', () => {
    for (const t of TEMPLATES.filter((x) => x.id !== 'collage')) expect(compile(buildTemplate(t.id, {}), estimateText).length).toBeGreaterThan(1);
  });

  test('templates for a lanyard come first', () => {
    expect(templatesFor('lanyard')[0].id).toBe('name-badge');
    expect(templatesFor('desk')[0].uses).toContain('desk');
    expect(templatesFor().length).toBe(6);
  });

  test('name badge QR carries the link', () => {
    const scene = buildTemplate('name-badge', sample);
    const qr = scene.layers.find((l) => l.type === 'qr');
    expect(qr).toMatchObject({ data: 'https://linkedin.com/in/someone' });
  });

  test('collage cells never overlap and fill the badge', () => {
    for (const n of [1, 2, 3, 4])
      for (const layout of [0, 1, 2]) {
        const cells = collageCells(n, layout, 528, 792, 8);
        expect(cells).toHaveLength(n);
        const area = cells.reduce((a, c) => a + c.width * c.height, 0);
        expect(area).toBeGreaterThan(528 * 792 * 0.85);
      }
  });

  test('frames and stickers compile', () => {
    const scene: Scene = {
      ...emptyScene(),
      layers: [
        ...(['line', 'double', 'rounded', 'corners', 'dashed'] as const).map((style) => ({ type: 'frame' as const, style, color: 'red' as const })),
        ...STICKER_NAMES.map((sticker) => ({ type: 'sticker' as const, sticker, box: { x: 0, y: 0, width: 50, height: 60 }, color: 'blue' as const })),
        { type: 'strokes', strokes: [{ color: 'green', width: 6, points: [0, 0, 10, 10, 20, 0] }] },
      ],
    };
    const ops = compile(scene, estimateText);
    expect(ops.filter((o) => o.op === 'path')).toHaveLength(STICKER_NAMES.length);
    expect(ops.some((o) => o.op === 'polyline')).toBe(true);
  });
});

test('styles and the Adjust sliders', () => {
  expect(toneFor({})).toEqual({ brightness: 1, contrast: 1, saturation: 1 });
  expect(toneFor({ brightness: 50, contrast: -50, colour: 50 })).toEqual({ brightness: 1.5, contrast: 0.5, saturation: 2 });
  expect(toneFor({ brightness: 999 }).brightness).toBe(1.5);
  expect(toneFor({}, 'poster').saturation).toBeGreaterThan(1);
  expect(STYLES.sketch.dither.method).toBe('atkinson');
});

test('proximity in plain words', () => {
  expect(proximity(-45, true).label).toMatch(/in your hand/);
  expect(proximity(-75).label).toBe('Across the room');
  expect(proximity(null).bars).toBe(0);
});

// ------------------------------------------------------------------ progress

test('progress reaches "safe to leave" at the refresh, with a falling time left', () => {
  let t = 0;
  const seen: SendProgress[] = [];
  const p = new ProgressTracker(DEFAULT_TIMINGS, { total: 1000, now: () => t, onChange: (x) => seen.push(x) });
  p.enter('preparing');
  t += 1000;
  p.enter('connecting');
  t += 2000;
  p.enter('erasing');
  expect(p.snapshot().safeToLeave).toBe(false);
  t += 2000;
  p.enter('sending');
  p.bytes(500);
  t += 1000;
  const mid = p.snapshot();
  p.bytes(1000);
  p.enter('verifying');
  t += 500;
  p.enter('refreshing');
  const refreshing = p.snapshot();
  expect(refreshing.safeToLeave).toBe(true);
  expect(refreshing.fraction).toBeGreaterThan(mid.fraction);
  expect(refreshing.secondsLeft!).toBeLessThanOrEqual(30);
  t += 20_000;
  p.enter('done');
  expect(p.snapshot()).toMatchObject({ fraction: 1, secondsLeft: 0, stage: 'done' });
  const learned = p.learned();
  expect(learned.refreshMs).toBeLessThan(DEFAULT_TIMINGS.refreshMs);
  expect(seen.length).toBeGreaterThan(5);
});

test('cold badges get the longer refresh estimate', () => {
  const warm = new ProgressTracker(DEFAULT_TIMINGS, { total: 1, temperature: 20, now: () => 0 });
  const cold = new ProgressTracker(DEFAULT_TIMINGS, { total: 1, temperature: 2, now: () => 0 });
  expect(cold.snapshot().secondsLeft!).toBeGreaterThan(warm.snapshot().secondsLeft!);
});

// ------------------------------------------------------------------ screen check

test('screen check', () => {
  const info = parseInfo(new FakeTag().info());
  expect(checkScreen(info).status).toBe('ok');
  const dead = parseInfo(new FakeTag({ panelId: Uint8Array.of(0xff, 0xff, 0xff) }).info());
  expect(checkScreen(dead).status).toBe('not-answering');
  expect(checkScreen(info, { status: 'failed', error: new TagError(ErrorCode.PANEL_TIMEOUT, 2) }).status).toBe('refresh-failed');
  expect(checkScreen(dead, { status: 'displayed', temperature: 20 }).status).toBe('ok');
  expect(checkScreen(parseInfo(new FakeTag({ firmware: [0, 2, 0] }).info())).status).toBe('unknown');
});

// ------------------------------------------------------------------ library

describe('library', () => {
  let t = new Date(2026, 10, 4, 12).getTime();
  const lib = () => new Library(new MemoryStorage(), { now: () => t, keep: 3 });
  const entry = (crc: number) => ({ kind: 'photo' as const, title: 'Photo', scene: emptyScene(), style: 'smooth' as const, crc32: crc });

  test('adds, dedupes, favourites, collections and sections', async () => {
    const l = lib();
    const a = await l.add(entry(1), new Uint8Array([1]));
    t += 1000;
    const b = await l.add(entry(2), new Uint8Array([2]));
    expect(await l.add(entry(1), new Uint8Array([1]))).toBe(a);
    expect(l.list().map((i) => i.id)).toEqual([b.id, a.id]);
    await l.recordSend(a.id, 'badge1');
    expect(l.list()[0].id).toBe(a.id);
    expect(l.recent(4, 'badge1').map((i) => i.id)).toEqual([a.id]);
    await l.setFavourite(b.id, true);
    expect(l.list({ kind: 'favourites' }).map((i) => i.id)).toEqual([b.id]);
    const c = await l.createCollection('Conference week', [b.id]);
    await l.addToCollection(c.id, a.id);
    await l.moveInCollection(c.id, a.id, 0);
    expect(l.list({ kind: 'collection', id: c.id }).map((i) => i.id)).toEqual([a.id, b.id]);
    expect(l.sections()[0].title).toBe('Today');
    t += 2 * 86_400_000;
    expect(l.sections()[0].title).toBe('This week');
    expect(await l.frame(a.id)).toEqual(new Uint8Array([1]));
    await l.remove(a.id);
    expect(l.collection(c.id)!.itemIds).toEqual([b.id]);
    expect(await l.frame(a.id)).toBeNull();
  });

  test('prunes old loose items but keeps favourites and collections', async () => {
    const l = lib();
    const first = await l.add(entry(10), new Uint8Array(1));
    await l.setFavourite(first.id, true);
    for (let i = 11; i < 20; i++) {
      t += 1000;
      await l.add(entry(i), new Uint8Array(1));
    }
    expect(l.list().length).toBe(4);
    expect(l.get(first.id)).toBeDefined();
  });

  test('survives a reload, and a broken file', async () => {
    const storage = new MemoryStorage();
    const l = new Library(storage);
    await l.add(entry(5), new Uint8Array(1));
    const again = new Library(storage);
    await again.load();
    expect(again.list()).toHaveLength(1);
    await storage.writeText('library/index.json', '{nope');
    await again.load();
    expect(again.list()).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ the service

/** Paints the background and filled rects in palette colours: enough to test the flow. */
const fakeRenderer: SceneRenderer = {
  measure: estimateText,
  async draw(scene, ops) {
    const { width, height } = sceneSize(scene);
    const img = createRgba(width, height);
    const rgb = (c: string) => PALETTE.find((p) => p.name === c)!.rgb;
    const fill = (x0: number, y0: number, w: number, h: number, c: string) => {
      const [r, g, b] = rgb(c);
      for (let y = Math.max(0, Math.round(y0)); y < Math.min(height, Math.round(y0 + h)); y++)
        for (let x = Math.max(0, Math.round(x0)); x < Math.min(width, Math.round(x0 + w)); x++) {
          const i = (y * width + x) * 4;
          img.data[i] = r;
          img.data[i + 1] = g;
          img.data[i + 2] = b;
          img.data[i + 3] = 255;
        }
    };
    for (const o of ops) {
      if (o.op === 'fill') fill(0, 0, width, height, o.color);
      if (o.op === 'rect' && !o.stroke) fill(o.box.x, o.box.y, o.box.width, o.box.height, o.color);
    }
    return img;
  },
  async encodePreview() {
    return new Uint8Array([0x89, 0x50]);
  },
};

let counter = 0;
const randomBytes = (n: number) => Uint8Array.from({ length: n }, () => (counter++ * 37) & 0xff);

function service(extra: Partial<InkTagDeps> = {}) {
  const storage = new MemoryStorage();
  const app = new InkTag({ storage, renderer: fakeRenderer, randomBytes, demoTiming: 'instant', ...extra });
  return { app, storage };
}

describe('InkTag service', () => {
  test('a demo badge: add with lock and hello, send, send again, redraw, blank', async () => {
    const { app } = service();
    await app.init();
    const { badge, displayed, lockUnsupported } = await app.addDemoBadge({ name: "Islam's badge" });
    expect(lockUnsupported).toBe(false);
    expect(badge.ownerKey).toMatch(/^[0-9a-f]{32}$/);
    expect(await displayed).toMatchObject({ status: 'displayed' });
    const tag = app.demoTag(badge.id)!;
    expect(tag.ownerKey).not.toBeNull();
    expect(app.library.list()[0].title).toBe('Hello');

    const progress: SendProgress[] = [];
    const scene = buildTemplate('status-sign', { status: 'free' });
    const { item, displayed: d2 } = await app.send(badge.id, { scene, style: 'poster', kind: 'template', title: 'Status sign' }, { onProgress: (p) => progress.push(p) });
    expect(progress.map((p) => p.stage)).toEqual(expect.arrayContaining(['preparing', 'erasing', 'sending', 'verifying', 'refreshing']));
    expect(progress.find((p) => p.stage === 'refreshing')!.safeToLeave).toBe(true);
    expect(await d2).toMatchObject({ status: 'displayed' });
    expect(progress.at(-1)!.stage).toBe('done');
    expect(app.badges.get(badge.id)!.shownItemId).toBe(item.id);
    // The badge shows green (code 6) where the scene is green.
    expect(tag.shown![0]).toBe(0x66);

    // Send the hello picture again from the library.
    const hello = app.library.list().find((i) => i.title === 'Hello')!;
    await (await app.send(badge.id, { itemId: hello.id })).displayed;
    expect(app.badges.get(badge.id)!.shownItemId).toBe(hello.id);

    await app.blank(badge.id);
    expect(tag.shown![0]).toBe(0x11);
    await app.redraw(badge.id);
    expect(app.badges.get(badge.id)!.screen?.status).toBe('ok');
  });

  test('reconnects after a restart and proves the key', async () => {
    const { app, storage } = service();
    await app.init();
    const { badge } = await app.addDemoBadge({ hello: false });
    const tag = app.demoTag(badge.id)!;
    await app.disconnect();
    expect(await app.reconnect()).toBe(true);
    expect(app.connection()).toMatchObject({ badgeId: badge.id, status: 'connected' });
    expect(tag.authorized).toBe(true);

    // A fresh service on the same files remembers the badge (demo badges restart blank).
    const again = new InkTag({ storage, renderer: fakeRenderer, randomBytes, demoTiming: 'instant' });
    await again.init();
    expect(again.badges.current()?.id).toBe(badge.id);
  });

  test("someone else's badge is refused, and a button reset is noticed", async () => {
    const { app } = service();
    await app.init();
    const { badge } = await app.addDemoBadge({ hello: false });
    const tag = app.demoTag(badge.id)!;
    await app.disconnect();

    // Another phone's key on the badge: this phone's key no longer matches.
    tag.ownerKey = new Uint8Array(16).fill(0xee);
    await expect(app.connect(badge.id)).rejects.toBeInstanceOf(LockedError);
    expect(app.connection().status).toBe('failed');

    // The owner holds the button: unlocked, and the app drops its stale key.
    tag.resetLock();
    await app.connect(badge.id);
    expect(app.badges.get(badge.id)!.ownerKey).toBeUndefined();
  });

  test('lock off and on again changes the key; forget unlocks', async () => {
    const { app } = service();
    await app.init();
    const { badge } = await app.addDemoBadge({ hello: false });
    const tag = app.demoTag(badge.id)!;
    const first = app.badges.get(badge.id)!.ownerKey;
    await app.setLocked(badge.id, false);
    expect(tag.ownerKey).toBeNull();
    expect(app.badges.get(badge.id)!.ownerKey).toBeUndefined();
    await app.setLocked(badge.id, true);
    expect(app.badges.get(badge.id)!.ownerKey).not.toBe(first);
    expect(await app.forget(badge.id)).toEqual({ unlocked: true });
    expect(tag.ownerKey).toBeNull();
    expect(app.badges.list()).toHaveLength(0);
  });

  test('several badges, each with its own name', async () => {
    const { app } = service();
    await app.init();
    const a = (await app.addDemoBadge({ name: 'Lanyard', hello: false })).badge;
    const b = (await app.addDemoBadge({ name: 'Desk sign', use: 'desk', orientation: 'landscape', hello: false })).badge;
    expect(app.badges.list().map((x) => x.name)).toEqual(['Desk sign', 'Lanyard']);
    const first = await app.send(a.id, { scene: buildTemplate('text', { text: 'A' }), style: 'poster', kind: 'text', title: 'Text' });
    expect(app.connection().badgeId).toBe(a.id);
    // Landscape designs go to the sideways badge.
    await app.send(b.id, { scene: buildTemplate('text', { text: 'B' }, { orientation: 'landscape' }), style: 'poster', kind: 'text', title: 'Text' });
    expect(app.connection().badgeId).toBe(b.id);
    // Switching badges closed the first link; its refresh can't be followed any more.
    expect(await first.displayed).toEqual({ status: 'unknown', reason: 'disconnected' });
    expect(app.badges.current()!.id).toBe(b.id);
    await app.rename(a.id, '  Bag tag ');
    expect(app.badges.get(a.id)!.name).toBe('Bag tag');
  });

  test('old firmware is added unlocked and says so', async () => {
    const links = {
      async scan() {
        return [{ id: 'AA:BB', name: 'InkTag-AABB', rssi: -50, lastSeen: 0 }];
      },
      async open() {
        const { client } = await simBadge({ firmware: [0, 3, 1] });
        return { client, close: () => client.close() };
      },
    };
    const { app } = service({ links });
    await app.init();
    const [found] = await app.scan();
    expect(found.proximity.level).toBe('very-close');
    const r = await app.addBadge(found, { hello: false });
    expect(r.lockUnsupported).toBe(true);
    expect(r.badge.ownerKey).toBeUndefined();
    expect((await app.scan())[0].saved?.id).toBe('AA:BB');
    await expect(app.setLocked('AA:BB', true)).rejects.toThrow(/firmware 0.4/);
  });

  test('a dead panel shows up in the screen check', async () => {
    const tag = new FakeTag({ timing: 'instant', panelId: Uint8Array.of(0, 0, 0) });
    const links = {
      async scan() {
        return [];
      },
      async open() {
        const link = new SimLink(tag);
        await link.connect();
        const client = new TagClient(link);
        return { client, close: () => client.close() };
      },
    };
    const { app } = service({ links });
    await app.init();
    tag.failNextRefresh = true;
    const { displayed } = await app.addBadge({ id: 'X', name: 'InkTag-X' });
    expect((await displayed)?.status).toBe('failed');
    expect(app.badges.get('X')!.screen?.status).toBe('not-answering');
    expect((await app.checkScreen('X')).message).toMatch(/ribbon cable/);
  });

  test('no Bluetooth: scanning explains, demo still works', async () => {
    const { app } = service();
    await app.init();
    await expect(app.scan()).rejects.toMatchObject({ problem: 'no-native-module' });
    expect(await app.reconnect()).toBe(false);
  });
});
