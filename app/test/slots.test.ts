// Picture slots (firmware 0.6+): the protocol, and the app keeping several
// pictures on the badge so that switching is only a redraw.

import {
  buildTemplate,
  createRgba,
  crc32,
  type DisplayOutcome,
  ErrorCode,
  estimateText,
  FakeTag,
  FRAME_BYTES,
  type BadgeLinks,
  InkTag,
  MemoryStorage,
  PALETTE,
  parseInfo,
  type SendProgress,
  type Scene,
  type SceneRenderer,
  sceneSize,
  SimLink,
  TagClient,
  TagError,
  encodeBegin,
} from '../src/core';
import { simBadge } from './helpers';

const frame = (n: number) => new Uint8Array(FRAME_BYTES).map((_, i) => (i * 7 + n) & 0xff);

describe('protocol', () => {
  test('BEGIN names a slot only when asked to', () => {
    expect(encodeBegin(FRAME_BYTES)).toHaveLength(6);
    expect([...encodeBegin(FRAME_BYTES, 1, 3)].slice(6)).toEqual([3, 1]);
    expect([...encodeBegin(FRAME_BYTES, 1, 3, false)].slice(6)).toEqual([3, 0]);
  });

  test('store pictures in slots, read them, show one, delete one', async () => {
    const { client, tag } = await simBadge({ firmware: [0, 6, 1] });
    expect(parseInfo(tag.info()).slots).toEqual({ count: 7, usedMask: 0, current: null });

    await (await client.upload(frame(1), { slot: 2 })).displayed;
    await (await client.upload(frame(2), { slot: 5 })).displayed;
    let info = await client.info();
    expect(info.slots).toEqual({ count: 7, usedMask: 0b0100100, current: 5 });
    expect(tag.slots[2]).toEqual(frame(1));
    expect(tag.shown).toEqual(frame(2));

    const s2 = await client.slot(2);
    expect(s2).toMatchObject({ slot: 2, used: true, length: FRAME_BYTES, crc32: crc32(frame(1)) });
    expect((await client.slot(3)).used).toBe(false);

    await client.show(2);
    expect(tag.shown).toEqual(frame(1));
    expect((await client.info()).slots?.current).toBe(2);

    info = await client.deleteSlot(5);
    expect(info.slots).toEqual({ count: 7, usedMask: 0b100, current: 2 });
    info = await client.deleteSlot(2); // the one on the screen: the panel keeps it
    expect(info.slots).toEqual({ count: 7, usedMask: 0, current: null });
    expect(tag.shown).toEqual(frame(1));
    await expect(client.show(2)).rejects.toMatchObject({ code: ErrorCode.NO_IMAGE });
  });

  test('a slot that does not exist is refused, and a failed upload keeps the other pictures', async () => {
    const { client, tag } = await simBadge({ firmware: [0, 6, 1] });
    await (await client.upload(frame(1), { slot: 0 })).displayed;
    await expect(client.upload(frame(2), { slot: 7 })).rejects.toMatchObject({ cause: { code: ErrorCode.BAD_SLOT } });
    await expect(client.slot(9)).rejects.toBeInstanceOf(TagError);
    tag.corruptNextUpload = true;
    await (await client.upload(frame(3), { slot: 1 })).displayed; // retried in safe mode
    expect(tag.slots[0]).toEqual(frame(1));
    expect(tag.slots[1]).toEqual(frame(3));
  });

  test('without a slot the picture replaces the one on the screen, as before', async () => {
    const { client, tag } = await simBadge({ firmware: [0, 6, 1] });
    await (await client.upload(frame(1), { slot: 4 })).displayed;
    await (await client.upload(frame(2))).displayed;
    expect(tag.slots[4]).toEqual(frame(2));
    expect(tag.slots.filter(Boolean)).toHaveLength(1);
  });

  test('older firmware has one picture and no slot commands', async () => {
    const { client, tag } = await simBadge({ firmware: [0, 5, 0] });
    expect((await client.info()).slots).toBeUndefined();
    await expect(client.slot(0)).rejects.toMatchObject({ code: ErrorCode.BAD_COMMAND });
    await (await client.upload(frame(1))).displayed;
    expect(tag.stored).toEqual(frame(1));
  });
});

// ------------------------------------------------------------------ the app

/** Paints the background colour only, so each status sign is a different picture. */
const renderer: SceneRenderer = {
  measure: estimateText,
  async draw(scene: Scene, ops) {
    const { width, height } = sceneSize(scene);
    const img = createRgba(width, height);
    for (const o of ops) {
      if (o.op !== 'fill') continue;
      const [r, g, b] = PALETTE.find((p) => p.name === o.color)!.rgb;
      for (let i = 0; i < width * height; i++) img.data.set([r, g, b, 255], i * 4);
    }
    return img;
  },
  async encodePreview() {
    return new Uint8Array([0x89, 0x50]);
  },
};

let n = 0;
const randomBytes = (k: number) => Uint8Array.from({ length: k }, () => (n++ * 37) & 0xff);

const design = (status: string) => ({
  scene: buildTemplate('status-sign', { status }),
  style: 'poster' as const,
  kind: 'template' as const,
  title: `Sign ${status}`,
});

/** An app with one Bluetooth badge that is a FakeTag underneath. */
async function setup(tagOpts: ConstructorParameters<typeof FakeTag>[0] = {}) {
  const tag = new FakeTag({ timing: 'instant', firmware: [0, 6, 1], ...tagOpts });
  const links: BadgeLinks = {
    async scan() {
      return [{ id: 'B8:D2', name: 'InkTag-B8D2', rssi: -50, lastSeen: 0 }];
    },
    async open() {
      const link = new SimLink(tag);
      await link.connect();
      const client = new TagClient(link);
      return { client, close: () => client.close() };
    },
  };
  const app = new InkTag({ storage: new MemoryStorage(), renderer, randomBytes, demoTiming: 'instant', links, autoUpdate: false });
  await app.init();
  const { badge } = await app.addBadge({ id: 'B8:D2', name: 'InkTag-B8D2' }, { hello: false });
  const send = async (status: string) => {
    const progress: SendProgress[] = [];
    const r = await app.send(badge.id, design(status), { onProgress: (p) => progress.push(p) });
    const outcome: DisplayOutcome = await r.displayed;
    expect(outcome.status).toBe('displayed');
    return { item: r.item, progress };
  };
  return { app, tag, badge, send };
}

describe('pictures on the badge', () => {
  test('each new picture goes to its own slot, and the badge page can name them', async () => {
    const { app, tag, badge, send } = await setup();
    const a = await send('busy');
    const b = await send('free');
    expect(tag.slots.filter(Boolean)).toHaveLength(2);
    expect(tag.current).toBe(1);
    const view = app.badgeSlots(badge.id)!;
    expect(view.filter((s) => s.used).map((s) => [s.slot, s.item?.id, s.current])).toEqual([
      [0, a.item.id, false],
      [1, b.item.id, true],
    ]);
    expect(app.slotOf(badge.id, a.item.id)).toBe(0);
    expect(app.badges.get(badge.id)!.shownItemId).toBe(b.item.id);
  });

  test('a picture already on the badge is only redrawn, nothing is sent', async () => {
    const { app, tag, badge, send } = await setup();
    const a = await send('busy');
    await send('free');
    const lines: string[] = [];
    tag.log = (l) => lines.push(l);
    const again = await app.send(badge.id, { itemId: a.item.id });
    expect((await again.displayed).status).toBe('displayed');
    expect(lines.some((l) => l.includes('receiving'))).toBe(false);
    expect(tag.current).toBe(0);
    expect(tag.shown).toEqual(tag.slots[0]);
    expect(app.badges.get(badge.id)!.shownItemId).toBe(a.item.id);
    expect(app.sending()!.alreadyThere).toBe(true);
    expect(tag.slots.filter(Boolean)).toHaveLength(2);
  });

  test('when every slot is full, the picture shown longest ago is replaced, never the one on the screen', async () => {
    let t = 1_000;
    const { app, tag, badge, send } = await setup({ slots: 3 });
    // A phone clock that moves, so "longest ago" means something.
    const tick = () => (t += 1_000);
    const realNow = Date.now;
    Date.now = tick;
    try {
      const busy = await send('busy'); // slot 0
      const free = await send('free'); // slot 1
      const meeting = await send('meeting'); // slot 2
      expect(tag.slots.slice(0, 3).every(Boolean)).toBe(true);
      // Show busy again, so it is no longer the oldest.
      await (await app.send(badge.id, { itemId: busy.item.id })).displayed;
      const back = await send('back'); // replaces the oldest: free (slot 1)
      expect(tag.slots[1]).toEqual(await app.library.frame(back.item.id));
      expect(tag.current).toBe(1);
      const view = app.badgeSlots(badge.id)!;
      expect(view.map((s) => s.item?.id)).toEqual([busy.item.id, back.item.id, meeting.item.id]);
      expect(app.slotOf(badge.id, free.item.id)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  test('show and delete from the badge page', async () => {
    const { app, tag, badge, send } = await setup();
    const a = await send('busy');
    const b = await send('free');
    await app.showOnBadge(badge.id, 0);
    expect(tag.current).toBe(0);
    expect(app.badges.get(badge.id)!.shownItemId).toBe(a.item.id);
    expect(app.badgeSlots(badge.id)![0].current).toBe(true);

    await app.removeFromBadge(badge.id, 1);
    expect(tag.slots[1]).toBeNull();
    expect(app.slotOf(badge.id, b.item.id)).toBeNull();
    expect(app.badgeSlots(badge.id)!.filter((s) => s.used)).toHaveLength(1);
    // The screen still shows the first picture, and sending the deleted one stores it again.
    const again = await send('free');
    expect(again.item.id).toBe(b.item.id);
    expect(tag.slots.filter(Boolean)).toHaveLength(2);
  });

  test('pictures sent from the laptop tool are noticed, even if this phone never made them', async () => {
    const { app, tag, badge } = await setup();
    tag.slots[4] = frame(9);
    await app.refreshSlots(badge.id);
    const view = app.badgeSlots(badge.id)!;
    expect(view[4]).toMatchObject({ used: true, current: false, item: undefined });
    expect(view[4].crc32).toBe(crc32(frame(9)));
  });

  test('old firmware keeps its single picture and shows no slots', async () => {
    const { app, tag, badge, send } = await setup({ firmware: [0, 5, 0] });
    await send('busy');
    await send('free');
    expect(app.badgeSlots(badge.id)).toBeNull();
    expect(tag.stored).not.toBeNull();
  });

  test('a demo badge has slots too', async () => {
    const app = new InkTag({ storage: new MemoryStorage(), renderer, randomBytes, demoTiming: 'instant' });
    await app.init();
    const { badge } = await app.addDemoBadge({ hello: false });
    await (await app.send(badge.id, design('busy'))).displayed;
    await (await app.send(badge.id, design('free'))).displayed;
    expect(app.badgeSlots(badge.id)!.filter((s) => s.used)).toHaveLength(2);
  });
});
