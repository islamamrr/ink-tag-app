// Picture slots (firmware 0.6+): the protocol on the simulated badge, and the
// app keeping pictures on the badge so sending one again needs no upload.

import {
  buildTemplate,
  createRgba,
  crc32,
  encodeBegin,
  encodeShow,
  estimateText,
  FakeTag,
  FRAME_BYTES,
  InkTag,
  MemoryStorage,
  parseInfo,
  pickSlot,
  type Scene,
  type SceneRenderer,
  sceneSize,
  type SendProgress,
  type SlotRecord,
  TagError,
} from '../src/core';
import { simBadge } from './helpers';

const frame = (seed: number) => {
  const f = new Uint8Array(FRAME_BYTES).fill(0x11);
  f[0] = seed & 0xff;
  f[1] = (seed >> 8) & 0xff;
  return f;
};

describe('slot protocol on the simulated badge', () => {
  test('BEGIN with a slot and no draw flag stores without drawing, then SLOT', async () => {
    const { client, tag } = await simBadge({ firmware: [0, 6, 1] });
    const a = frame(1);
    const up = await client.upload(a, { slot: 3, draw: false });
    expect(await up.displayed).toEqual({ status: 'stored' });
    expect(tag.slots[3]).toEqual(a);
    expect(tag.shown).toBeNull();
    const info = await client.info();
    expect(info.slots).toEqual({ count: 7, usedMask: 0b1000, current: null });
    expect(info.hasImage).toBe(false);

    const s = await client.slot(3);
    expect(s).toMatchObject({ slot: 3, used: true, length: FRAME_BYTES, crc32: crc32(a) });
    expect((await client.slot(0)).used).toBe(false);
  });

  test('SHOW a slot draws it and makes it current; DELETE empties it', async () => {
    const { client, tag } = await simBadge({ firmware: [0, 6, 1] });
    await (await client.upload(frame(1), { slot: 0 })).displayed;
    await (await client.upload(frame(2), { slot: 5, draw: false })).displayed;
    await client.show(5);
    expect(tag.shown).toEqual(frame(2));
    expect((await client.info()).slots!.current).toBe(5);

    const info = await client.deleteSlot(5);
    expect(info.slots).toEqual({ count: 7, usedMask: 0b1, current: null });
    await expect(client.show(5)).rejects.toBeInstanceOf(TagError);
    await expect(client.slot(7)).rejects.toBeInstanceOf(TagError); // no such slot
  });

  test('BEGIN without a slot replaces the current picture, as older apps expect', async () => {
    const { client, tag } = await simBadge({ firmware: [0, 6, 1] });
    await (await client.upload(frame(1), { slot: 4 })).displayed;
    await (await client.upload(frame(2))).displayed;
    expect(tag.slots[4]).toEqual(frame(2));
    expect(parseInfo(tag.info()).slots!.usedMask).toBe(0b10000);
  });

  test('encoders', () => {
    expect([...encodeBegin(FRAME_BYTES)]).toEqual([0x01, 0x01, 0xc0, 0x30, 0x03, 0x00]);
    expect([...encodeBegin(FRAME_BYTES, 1, 3, 0)]).toEqual([0x01, 0x01, 0xc0, 0x30, 0x03, 0x00, 0x03, 0x00]);
    expect([...encodeShow()]).toEqual([0x03]);
    expect([...encodeShow(3)]).toEqual([0x03, 0x03]);
  });

  test('firmware before 0.6 keeps one picture and ignores slots', async () => {
    const tag = new FakeTag({ firmware: [0, 5, 0] });
    expect(parseInfo(tag.info()).slots).toBeUndefined();
  });
});

describe('pickSlot', () => {
  const rec = (usedAt: number): SlotRecord => ({ crc32: usedAt, usedAt });
  test('an empty slot first, else the oldest that is not on screen', () => {
    expect(pickSlot({ slots: [rec(5), null, rec(1)], current: 0 })).toBe(1);
    expect(pickSlot({ slots: [rec(5), rec(9), rec(1)], current: 2 })).toBe(0);
    expect(pickSlot({ slots: [rec(5), rec(9), rec(1)], current: null })).toBe(2);
  });
});

// ------------------------------------------------------------------ the app

// Each scene draws a black bar of its own length, so every design has its own frame.
const renderer: SceneRenderer = {
  measure: estimateText,
  async draw(scene) {
    const { width, height } = sceneSize(scene);
    const img = createRgba(width, height);
    img.data.fill(255);
    const tag = (scene as Scene & { tag?: number }).tag ?? 0;
    for (let x = 0; x < 10 + tag * 7; x++)
      for (let y = 0; y < 12; y++) {
        const i = (y * width + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
      }
    return img;
  },
};

let n = 0;
const randomBytes = (k: number) => Uint8Array.from({ length: k }, () => (n++ * 31) & 0xff);

const design = (tag: number) => ({
  scene: { ...buildTemplate('status-sign', { status: 'free' }), tag } as Scene,
  style: 'poster' as const,
  kind: 'template' as const,
  title: `Picture ${tag}`,
});

async function setup() {
  const app = new InkTag({ storage: new MemoryStorage(), renderer, randomBytes, demoTiming: 'instant', autoUpdate: false });
  await app.init();
  const { badge } = await app.addDemoBadge({ hello: false });
  return { app, id: badge.id, tag: app.demoTag(badge.id)! };
}

describe('InkTag with picture slots', () => {
  test('sends fill empty slots, and a picture already kept is only redrawn', async () => {
    const { app, id, tag } = await setup();
    const a = await app.send(id, design(1));
    await a.displayed;
    const b = await app.send(id, design(2));
    await b.displayed;
    expect([a.slot, b.slot]).toEqual([0, 1]);
    expect(app.slots(id)!.slots.slice(0, 2).map((r) => r?.itemId)).toEqual([a.item.id, b.item.id]);
    expect(app.slots(id)!.current).toBe(1);

    // Again: no erase, no upload, just the refresh.
    const progress: SendProgress[] = [];
    const again = await app.send(id, { itemId: a.item.id }, { onProgress: (p) => progress.push(p) });
    expect(again).toMatchObject({ slot: 0, reused: true });
    expect(await again.displayed).toMatchObject({ status: 'displayed' });
    expect(progress.map((p) => p.stage)).not.toContain('sending');
    expect(tag.current).toBe(0);
    expect(app.badges.get(id)!.shownItemId).toBe(a.item.id);
    expect(app.slots(id)!.current).toBe(0);
  });

  test('a full badge reuses the slot used longest ago, never the one on screen', async () => {
    const { app, id } = await setup();
    const sent = [];
    for (let i = 1; i <= 7; i++) {
      const r = await app.send(id, design(i));
      await r.displayed;
      sent.push(r);
    }
    // Draw picture 1 again, so slot 0 is fresh; slot 1 (picture 2) is now the oldest.
    await (await app.send(id, { itemId: sent[0].item.id })).displayed;
    const eighth = await app.send(id, design(8));
    await eighth.displayed;
    expect(eighth.slot).toBe(1);
    expect(app.slots(id)!.slots.filter(Boolean)).toHaveLength(7);
  });

  test('store without drawing, show a slot, delete a slot', async () => {
    const { app, id, tag } = await setup();
    await (await app.send(id, design(1))).displayed;
    const shown = tag.shown;
    const kept = await app.send(id, design(2), { draw: false });
    expect(await kept.displayed).toEqual({ status: 'stored' });
    expect(tag.shown).toBe(shown);
    expect(app.slots(id)!.current).toBe(0);

    await app.showSlot(id, kept.slot!);
    expect(tag.current).toBe(kept.slot);
    expect(app.badges.get(id)!.shownItemId).toBe(kept.item.id);

    const after = await app.deleteSlot(id, kept.slot!);
    expect(after!.slots[kept.slot!]).toBeNull();
    expect(after!.current).toBeNull();
    expect(tag.slots[kept.slot!]).toBeNull();
  });

  test('syncSlots reads pictures put there by someone else and matches the library', async () => {
    const { app, id, tag } = await setup();
    const a = await app.send(id, design(1));
    await a.displayed;
    tag.slots[6] = frame(99); // e.g. the computer tool
    const s = await app.syncSlots(id);
    expect(s!.slots[0]).toMatchObject({ itemId: a.item.id });
    expect(s!.slots[6]).toMatchObject({ crc32: crc32(frame(99)), itemId: undefined });
  });

  test("'replace' (live pictures) overwrites the slot on screen", async () => {
    const { app, id } = await setup();
    await (await app.send(id, design(1))).displayed;
    await (await app.send(id, design(2))).displayed;
    const live = await app.send(id, design(3), { slot: 'replace' });
    await live.displayed;
    expect(live.slot).toBe(1);
    expect(app.slots(id)!.slots.filter(Boolean)).toHaveLength(2);
  });
});
