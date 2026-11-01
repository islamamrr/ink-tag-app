import {
  BleLink,
  Color,
  BluetoothError,
  DisconnectedError,
  FakeRadio,
  type FakeRadioOptions,
  FakeTag,
  type FakeTagOptions,
  FRAME_BYTES,
  fromBase64,
  scanForBadges,
  TagClient,
  toBase64,
  UploadError,
  userMessage,
} from '../src/core';

const testFrame = () => new Uint8Array(FRAME_BYTES).map((_, i) => (i * 13) & 0xff);
const TIMEOUTS = { info: 500, ready: 500, received: 500, displayed: 2_000 };

function setup(radioOpts: FakeRadioOptions = {}, tagOpts: FakeTagOptions = {}) {
  const serial: string[] = [];
  const radio = new FakeRadio(radioOpts);
  const tag = new FakeTag({ timing: 'instant', mtu: 517, log: (l) => serial.push(l), ...tagOpts });
  radio.addBadge(tag, { id: 'AA:BB:CC:DD:12:34', name: 'InkTag-1234', rssi: -55 });
  return { radio, tag, serial };
}

async function connected(radioOpts: FakeRadioOptions = {}, tagOpts: FakeTagOptions = {}) {
  const s = setup(radioOpts, tagOpts);
  const linkLog: string[] = [];
  const link = await BleLink.open(s.radio, 'AA:BB:CC:DD:12:34', {
    subscribeSettleMs: 5,
    retryDelayMs: 1,
    log: (t) => linkLog.push(t),
  });
  const client = new TagClient(link, () => {}, TIMEOUTS);
  return { ...s, link, client, linkLog };
}

describe('base64', () => {
  test('round-trips every length and byte value', () => {
    for (let n = 0; n < 70; n++) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + n) & 0xff);
      const b64 = toBase64(bytes);
      expect(b64).toBe(Buffer.from(bytes).toString('base64'));
      expect(fromBase64(b64)).toEqual(bytes);
    }
  });

  test('rejects junk', () => {
    expect(() => fromBase64('ab$d')).toThrow();
  });
});

describe('scanning', () => {
  test('finds badges by service UUID, nearest first, one entry each', async () => {
    const { radio } = setup();
    radio.addBadge(new FakeTag(), { id: 'far', name: 'InkTag-FA12', rssi: -90 });
    radio.addBadge(new FakeTag(), { id: 'headphones', name: 'Buds', rssi: -30 }, 'foreign');
    radio.addBadge(new FakeTag(), { id: '11:22:33:44:AB:CD', name: null, rssi: -70 });
    const updates: number[] = [];
    const found = await scanForBadges(radio, {
      timeoutMs: 80,
      onUpdate: (l) => updates.push(l.length),
    });
    expect(found.map((b) => b.name)).toEqual(['InkTag-1234', 'InkTag-ABCD', 'InkTag-FA12']);
    expect(updates.length).toBeGreaterThan(3); // repeated adverts still update
    expect(radio.scanning).toBe(false);
  });

  test('stopAtFirst and abort end the scan early', async () => {
    const { radio } = setup();
    const t0 = Date.now();
    expect(await scanForBadges(radio, { timeoutMs: 5_000, stopAtFirst: true })).toHaveLength(1);
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 30);
    await scanForBadges(radio, { timeoutMs: 5_000, signal: ctl.signal });
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(radio.scanning).toBe(false);
  });

  test('Bluetooth off is a clear error', async () => {
    const { radio } = setup();
    radio.setState('off');
    await expect(scanForBadges(radio)).rejects.toThrow(BluetoothError);
    radio.setState('unauthorized');
    await scanForBadges(radio).catch((e) =>
      expect(userMessage(e)).toMatch(/not allowed to use Bluetooth/),
    );
  });

  test('waits for the radio to finish starting up', async () => {
    const { radio } = setup();
    radio.setState('unknown');
    setTimeout(() => radio.setState('on'), 20);
    expect(await scanForBadges(radio, { timeoutMs: 50 })).toHaveLength(1);
  });
});

describe('BleLink', () => {
  test('hello and a full upload over the radio', async () => {
    const { client, tag, link, radio } = await connected();
    expect(link.mtu).toBe(517);
    expect((await client.hello()).firmware).toBe('0.3.0');
    const frame = testFrame();
    const r = await client.upload(frame);
    expect(r.chunkSize).toBe(512); // MTU 517 allows 514, but a GATT value is at most 512
    expect(tag.stored).toEqual(frame);
    expect((await r.displayed).status).toBe('displayed');
    expect(tag.shown).toEqual(frame);
    expect(radio.maxInFlight).toBeGreaterThan(1);
    // END (the last control write) never overtakes the data.
    const lastData = radio.trace.lastIndexOf('d');
    expect(radio.trace.slice(lastData + 1)).toEqual(['C']); // END
  });

  test('Android refusing fast writes: retried with responses, no stale error after', async () => {
    const { client, radio, tag } = await connected();
    radio.refuseWrites = 3; // the first chunks in flight are all refused
    const r = await client.upload(testFrame());
    expect(r.attempts).toBe(2);
    expect(tag.stored).toEqual(testFrame());
    expect((await r.displayed).status).toBe('displayed');
    // The next commands aren't hit by an error left over from the refused writes.
    await client.show();
    expect((await client.info()).hasImage).toBe(true);
  });

  test('a refused upload that also fails in safe mode leaves the link usable', async () => {
    const { client, radio, tag } = await connected();
    radio.refuseAllData = true;
    const err = await client.upload(testFrame()).catch((e) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(err.badgeBlank).toBe(true);
    // The app sent ABORT, so the badge isn't stuck waiting for data...
    expect(tag.receiving).toBe(false);
    radio.refuseAllData = false;
    // ...and SHOW/CLEAR work again (no "bad state"), with no stale error either.
    await client.clear(Color.red);
    await client.upload(testFrame());
    expect(tag.stored).toEqual(testFrame());
  });

  test('uses the MTU the phone settles on (iOS picks its own)', async () => {
    const { client, link, tag } = await connected({ phoneMaxMtu: 185 });
    expect(link.mtu).toBe(185);
    const r = await client.upload(testFrame());
    expect(r.chunkSize).toBe(182);
    expect(tag.stored).toEqual(testFrame());
  });

  test('keeps at most maxInFlight writes queued', async () => {
    const s = setup({ writeDelayMs: 1 });
    const link = await BleLink.open(s.radio, 'AA:BB:CC:DD:12:34', {
      subscribeSettleMs: 1,
      maxInFlight: 3,
    });
    const client = new TagClient(link, () => {}, TIMEOUTS);
    await client.upload(testFrame());
    expect(s.radio.maxInFlight).toBe(3);
    expect(s.tag.stored).toEqual(testFrame());
  });

  test('retries a connect that fails like Android status 133', async () => {
    const { radio } = setup();
    radio.failConnects = 2;
    const link = await BleLink.open(radio, 'AA:BB:CC:DD:12:34', {
      subscribeSettleMs: 1,
      retryDelayMs: 1,
    });
    expect(radio.connectAttempts).toBe(3);
    expect(link.connected).toBe(true);
  });

  test('gives up after three failed connects', async () => {
    const { radio } = setup();
    radio.failConnects = 5;
    const err = await BleLink.open(radio, 'AA:BB:CC:DD:12:34', { retryDelayMs: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(BluetoothError);
    expect(err.problem).toBe('connect-failed');
    expect(radio.connectAttempts).toBe(3);
  });

  test('refuses a device without the Ink Tag service', async () => {
    const { radio } = setup();
    radio.addBadge(new FakeTag({ mtu: 517 }), { id: 'fake' }, 'impostor');
    const err = await BleLink.open(radio, 'fake', { retryDelayMs: 1 }).catch((e) => e);
    expect(err.problem).toBe('not-a-badge');
    expect(radio.isConnected('fake')).toBe(false);
  });

  test('waits for the notification subscription before the first command', async () => {
    // Notifications in the first 40 ms are lost, as when the CCCD write is still on its way.
    const s = setup({ subscribeDelayMs: 40 });
    const link = await BleLink.open(s.radio, 'AA:BB:CC:DD:12:34', { subscribeSettleMs: 60 });
    const client = new TagClient(link, () => {}, TIMEOUTS);
    expect((await client.hello()).protocol).toBe(1);
  });

  test('a lost chunk (badge says bad length) is retried with responses', async () => {
    const { client, radio, tag } = await connected();
    radio.loseChunk = 100;
    const r = await client.upload(testFrame());
    expect(r.attempts).toBe(2);
    expect(tag.stored).toEqual(testFrame());
  });

  test('out of range mid-upload: one disconnect, badge reported blank', async () => {
    const { client, link, radio } = await connected();
    radio.dropAfterBytes = 50_000;
    let disconnects = 0;
    link.onDisconnect(() => disconnects++);
    const err = await client.upload(testFrame()).catch((e) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(err.badgeBlank).toBe(true);
    expect(link.connected).toBe(false);
    expect(disconnects).toBe(1);
    await expect(client.info()).rejects.toThrow(DisconnectedError);
    expect(userMessage(err)).toMatch(/blank/);
  });

  test('reconnecting after a drop works and the badge accepts a new upload', async () => {
    const { client, radio, tag } = await connected();
    radio.dropAfterBytes = 10_000;
    await client.upload(testFrame()).catch(() => {});
    radio.dropAfterBytes = null;
    const link2 = await BleLink.open(radio, 'AA:BB:CC:DD:12:34', { subscribeSettleMs: 1 });
    const client2 = new TagClient(link2, () => {}, TIMEOUTS);
    await client2.hello();
    await client2.upload(testFrame());
    expect(tag.stored).toEqual(testFrame());
  });

  test('close() disconnects once and lets the badge advertise again', async () => {
    const { client, link, radio } = await connected();
    let disconnects = 0;
    link.onDisconnect(() => disconnects++);
    await client.hello();
    await link.close();
    await link.close();
    expect(disconnects).toBe(1);
    expect(radio.isConnected('AA:BB:CC:DD:12:34')).toBe(false);
    expect(await scanForBadges(radio, { timeoutMs: 30 })).toHaveLength(1);
  });

  test('disconnect while the panel refreshes: picture stored, outcome unknown', async () => {
    const { link, radio, tag } = await connected({}, { timing: 'fast' });
    const client = new TagClient(link, () => {}, { ...TIMEOUTS, ready: 2_000, displayed: 10_000 });
    const r = await client.upload(testFrame());
    radio.drop('AA:BB:CC:DD:12:34');
    expect(await r.displayed).toEqual({ status: 'unknown', reason: 'disconnected' });
    expect(tag.stored).toEqual(testFrame());
    // The badge finishes the refresh on its own.
    while (!tag.shown) await new Promise((res) => setTimeout(res, 50));
    expect(tag.shown).toEqual(testFrame());
  }, 10_000);
});
