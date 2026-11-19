// Firmware updates: the bundled files, the protocol, the simulated badge,
// and the app installing newer firmware on its own.

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  type BundledFirmware,
  Chip,
  createRgba,
  ErrorCode,
  estimateText,
  FakeTag,
  type FirmwareSource,
  InkTag,
  type InkTagDeps,
  MemoryStorage,
  parseFirmwareImage,
  parseInfo,
  sceneSize,
  type SceneRenderer,
  sha256,
  SimLink,
  TagClient,
  TagError,
  toHex,
  buildTemplate,
} from '../src/core';
import { simBadge } from './helpers';

const assets = join(__dirname, '..', 'assets', 'firmware');
const manifest: { images: BundledFirmware[] } = JSON.parse(readFileSync(join(assets, 'firmware.json'), 'utf8'));
const bytesOf = (img: BundledFirmware) => new Uint8Array(readFileSync(join(assets, img.file)));
const c3 = manifest.images.find((i) => i.chip === Chip.ESP32C3)!;
const source: FirmwareSource = { images: manifest.images, load: async (img) => bytesOf(img) };

const protocolH = readFileSync(join(__dirname, '..', '..', 'firmware', 'main', 'protocol.h'), 'utf8');
const fwVersion = ['MAJOR', 'MINOR', 'PATCH']
  .map((p) => new RegExp(`INKTAG_FW_VERSION_${p} (\\d+)`).exec(protocolH)![1])
  .join('.');

describe('bundled firmware', () => {
  test('firmware.json matches the files, and both are the firmware in this repo', () => {
    expect(manifest.images.map((i) => i.chip)).toEqual([Chip.ESP32C3, Chip.ESP32C6]);
    for (const img of manifest.images) {
      const bytes = bytesOf(img);
      expect(bytes.length).toBe(img.size);
      expect(toHex(sha256(bytes))).toBe(img.sha256);
      const parsed = parseFirmwareImage(bytes);
      expect(parsed.chip).toBe(img.chip);
      expect(parsed.project).toBe('inktag');
      expect(parsed.versionText).toBe(img.version);
      // Rebuilt the firmware without `node tools/bundle_firmware.mjs`? This catches it.
      expect(img.version).toBe(fwVersion);
    }
  });

  test('a USB image or random bytes are refused', () => {
    expect(() => parseFirmwareImage(new Uint8Array(1000))).toThrow(/isn't a firmware update/);
    const bad = bytesOf(c3).slice();
    bad[32] = 0;
    expect(() => parseFirmwareImage(bad)).toThrow(/no version/);
  });
});

describe('protocol', () => {
  test('INFO from 0.6.0 (no chip byte: an ESP32-C3) and 0.6.1', async () => {
    const old = parseInfo(new FakeTag({ firmware: [0, 6, 0], chip: Chip.ESP32C6 }).info());
    expect(old.update).toEqual({ runningSlot: 0, rolledBack: false, maxFirmware: 0x130000, chip: Chip.ESP32C3 });
    expect(old.slots).toEqual({ count: 7, usedMask: 0, current: null });
    const now = parseInfo(new FakeTag({ firmware: [0, 6, 1], chip: Chip.ESP32C6 }).info());
    expect(now.update?.chip).toBe(Chip.ESP32C6);
    expect(parseInfo(new FakeTag({ firmware: [0, 5, 0] }).info()).update).toBeUndefined();
  });

  test('updateFirmware installs, and the badge restarts into the new version', async () => {
    const { client, tag, link } = await simBadge({ firmware: [0, 6, 0] });
    const stages: string[] = [];
    let sent = 0;
    await client.updateFirmware(bytesOf(c3), {
      onStage: (s) => stages.push(s),
      onProgress: (s) => (sent = s),
    });
    expect(stages).toEqual(['erasing', 'sending', 'installing', 'restarting']);
    expect(sent).toBe(c3.size);
    await new Promise((r) => setTimeout(r, 20));
    expect(link.connected).toBe(false);
    expect(tag.firmware.join('.')).toBe(c3.version);
    expect(tag.runningSlot).toBe(1);
  });

  test('firmware for another chip is refused and nothing changes', async () => {
    const { client, tag } = await simBadge({ firmware: [0, 6, 1], chip: Chip.ESP32C6 });
    await expect(client.updateFirmware(bytesOf(c3))).rejects.toMatchObject({ code: ErrorCode.BAD_FIRMWARE });
    expect(tag.firmware).toEqual([0, 6, 1]);
    expect((await client.info()).update?.runningSlot).toBe(0);
  });

  test('a locked badge only takes firmware from its owner', async () => {
    const { client, tag } = await simBadge({ firmware: [0, 6, 0] });
    tag.ownerKey = new Uint8Array(16).fill(1);
    await expect(client.updateFirmware(bytesOf(c3))).rejects.toBeInstanceOf(TagError);
    expect(tag.firmware).toEqual([0, 6, 0]);
  });

  test('old firmware answers bad command', async () => {
    const { client } = await simBadge({ firmware: [0, 5, 0] });
    await expect(client.updateFirmware(bytesOf(c3))).rejects.toMatchObject({ code: ErrorCode.BAD_COMMAND });
  });
});

// ------------------------------------------------------------------ the app

const renderer: SceneRenderer = {
  measure: estimateText,
  async draw(scene) {
    const { width, height } = sceneSize(scene);
    return createRgba(width, height);
  },
};

let n = 0;
const randomBytes = (k: number) => Uint8Array.from({ length: k }, () => (n++ * 53) & 0xff);

/** An app with one real-looking (Bluetooth) badge that is a FakeTag underneath. */
function appWith(tag: FakeTag, extra: Partial<InkTagDeps> = {}) {
  const links: InkTagDeps['links'] = {
    async scan() {
      return [{ id: 'B8:D2', name: 'InkTag-B8D2', rssi: -50, lastSeen: 0 }];
    },
    async open() {
      const link = new SimLink(tag, { bytesPerSecond: extra.demoTiming === 'fast' ? 4_000_000 : 0 });
      await link.connect();
      const client = new TagClient(link);
      return { client, close: () => client.close() };
    },
  };
  return new InkTag({
    storage: new MemoryStorage(),
    renderer,
    randomBytes,
    demoTiming: 'instant',
    links,
    firmware: source,
    restartTimeouts: { drop: 1_000, reconnect: 2_000, retry: 20 },
    ...extra,
  });
}

const until = async (cond: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('automatic updates', () => {
  test('a badge on older firmware is updated once it is idle, and stays locked to this phone', async () => {
    const tag = new FakeTag({ timing: 'instant', firmware: [0, 6, 0] });
    const app = appWith(tag);
    await app.init();
    const { badge, displayed } = await app.addBadge({ id: 'B8:D2', name: 'InkTag-B8D2' });
    await displayed;
    await until(() => !!app.firmwareResult(badge.id));
    expect(app.firmwareResult(badge.id)).toMatchObject({ status: 'updated', from: '0.6.0', to: c3.version });
    expect(app.badges.get(badge.id)!.firmware).toBe(c3.version);
    expect(tag.firmware.join('.')).toBe(c3.version);
    // The owner key lives in the badge's NVS, which updates keep.
    expect(app.connection().info?.lock).toEqual({ locked: true, authorized: true });
    expect(app.firmwareOffer(badge.id)).toMatchObject({ newer: false });
  });

  test('a rollback is reported and that version is not tried again on its own', async () => {
    const tag = new FakeTag({ timing: 'instant', firmware: [0, 6, 0] });
    tag.failNextBoot = true;
    const app = appWith(tag);
    await app.init();
    const { badge, displayed } = await app.addBadge({ id: 'B8:D2', name: 'InkTag-B8D2' }, { hello: true });
    await displayed;
    await until(() => !!app.firmwareResult(badge.id));
    expect(app.firmwareResult(badge.id)).toMatchObject({ status: 'rolled-back', to: c3.version });
    expect(app.badges.get(badge.id)!.skipFirmware).toBe(c3.version);
    expect(app.connection().info?.update?.rolledBack).toBe(true);
    // Reconnecting doesn't start it again.
    await app.disconnect();
    await app.connect(badge.id);
    await new Promise((r) => setTimeout(r, 50));
    expect(app.firmwareJob()).toBeNull();
    expect(tag.firmware).toEqual([0, 6, 0]);
    // A reinstall by hand still works.
    expect(await app.updateFirmware(badge.id)).toMatchObject({ status: 'updated' });
    expect(app.badges.get(badge.id)!.skipFirmware).toBeUndefined();
  });

  test('sending a picture pauses an update that is still streaming; it finishes afterwards', async () => {
    const tag = new FakeTag({ timing: 'instant', firmware: [0, 6, 0] });
    const app = appWith(tag, { autoUpdate: false, demoTiming: 'fast' });
    await app.init();
    const { badge } = await app.addBadge({ id: 'B8:D2', name: 'InkTag-B8D2' }, { hello: false });
    const run = app.updateFirmware(badge.id);
    await until(() => app.firmwareJob()?.stage === 'sending');
    const { displayed } = await app.send(badge.id, {
      scene: buildTemplate('status-sign', { status: 'free' }),
      style: 'poster',
      kind: 'template',
      title: 'Status sign',
    });
    expect(await run).toMatchObject({ status: 'cancelled' });
    expect(await displayed).toMatchObject({ status: 'displayed' });
    expect(tag.firmware).toEqual([0, 6, 0]);
    expect(await app.updateFirmware(badge.id)).toMatchObject({ status: 'updated' });
  });

  test('demo badges and old firmware are left alone', async () => {
    const tag = new FakeTag({ timing: 'instant', firmware: [0, 5, 0] });
    const app = appWith(tag);
    await app.init();
    const { badge } = await app.addBadge({ id: 'B8:D2', name: 'InkTag-B8D2' }, { hello: false });
    expect(app.firmwareOffer(badge.id)).toBeNull();
    expect(await app.updateFirmware(badge.id)).toMatchObject({ status: 'failed', message: /0\.6 or newer/ });
    const demo = await app.addDemoBadge({ hello: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(app.firmwareJob()).toBeNull();
    expect(app.firmwareResult(demo.badge.id)).toBeUndefined();
  });
});
