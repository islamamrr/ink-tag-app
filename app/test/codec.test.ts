import { crc32 as zlibCrc } from 'zlib';

import {
  crc32,
  describeEvent,
  encodeBegin,
  encodeClear,
  encodeEnd,
  encodeTemp,
  FakeTag,
  FRAME_BYTES,
  panelAnswering,
  parseInfo,
  supportsTemp,
} from '../src/core';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

test('BEGIN for a full frame', () => {
  expect(hex(encodeBegin(FRAME_BYTES))).toBe('0101c0300300');
});

test('END, CLEAR and TEMP encoders', () => {
  expect(hex(encodeEnd(0xdeadbeef))).toBe('02efbeadde');
  expect(hex(encodeClear(5))).toBe('0405');
  expect(hex(encodeTemp(null))).toBe('0780');
  expect(hex(encodeTemp(-5))).toBe('07fb');
  expect(hex(encodeTemp(99))).toBe('073c'); // clamped to 60
  expect(hex(encodeTemp(-40))).toBe('07ec'); // clamped to −20
});

test('crc32 matches zlib', () => {
  const data = new Uint8Array(10_000).map((_, i) => (i * 31 + 7) & 0xff);
  expect(crc32(data)).toBe(zlibCrc(data));
  expect(crc32(new Uint8Array())).toBe(0);
});

describe('INFO parsing across firmware versions', () => {
  test('fw 0.1: 17 bytes, no TEMP support', () => {
    const tag = new FakeTag({ firmware: [0, 1, 0] });
    const raw = tag.info();
    expect(raw.length).toBe(17);
    const info = parseInfo(raw);
    expect(info).toMatchObject({
      protocol: 1,
      firmware: '0.1.0',
      width: 792,
      height: 528,
      format: 1,
      hasImage: false,
      temperature: null,
      maxLength: FRAME_BYTES,
    });
    expect(info.tempOverride).toBeUndefined();
    expect(supportsTemp(info)).toBe(false);
    expect(panelAnswering(info)).toBeUndefined();
  });

  test('fw 0.2: 18 bytes with the override', () => {
    const tag = new FakeTag({ firmware: [0, 2, 0] });
    tag.tempOverride = -7;
    const info = parseInfo(tag.info());
    expect(info.tempOverride).toBe(-7);
    expect(supportsTemp(info)).toBe(true);
    expect(info.panelId).toBeUndefined();
  });

  test('fw 0.3: 21 bytes with the panel id', () => {
    const tag = new FakeTag();
    tag.lastTemp = 21;
    const info = parseInfo(tag.info());
    expect(info.temperature).toBe(21);
    expect(info.tempOverride).toBeNull();
    expect(hex(info.panelId!)).toBe('000066');
    expect(panelAnswering(info)).toBe(true);
    tag.panelId = Uint8Array.of(0xff, 0xff, 0xff);
    expect(panelAnswering(parseInfo(tag.info()))).toBe(false);
  });

  test('rejects short or wrong notifications', () => {
    expect(() => parseInfo(Uint8Array.of(0x84, 0))).toThrow();
    expect(() => parseInfo(new Uint8Array(21))).toThrow();
  });
});

test('describeEvent is readable', () => {
  expect(describeEvent(Uint8Array.of(0x8f, 5, 2))).toBe('ERROR CRC mismatch (command END)');
  expect(describeEvent(Uint8Array.of(0x83, 0, 0xf6))).toBe('DISPLAYED panel -10 °C');
  expect(describeEvent(new FakeTag().info())).toContain('fw 0.3.0, 792x528');
});
