import {
  CancelledError,
  Color,
  DisconnectedError,
  ErrorCode,
  FRAME_BYTES,
  supportsTemp,
  TagError,
  UnsupportedProtocolError,
  UploadError,
  userMessage,
} from '../src/core';
import { simBadge } from './helpers';

const testFrame = () => new Uint8Array(FRAME_BYTES).map((_, i) => (i * 7) & 0xff);

test('hello reads INFO from a fresh badge', async () => {
  const { client } = await simBadge();
  const info = await client.hello();
  expect(info.firmware).toBe('0.3.0');
  expect(info.hasImage).toBe(false);
  expect(supportsTemp(info)).toBe(true);
});

test('upload stores the frame, then the panel shows it', async () => {
  const { client, tag } = await simBadge();
  const progress: number[] = [];
  const frame = testFrame();
  const r = await client.upload(frame, { onProgress: (s) => progress.push(s) });
  expect(r.attempts).toBe(1);
  expect(r.chunkSize).toBe(244);
  expect(tag.stored).toEqual(frame); // stored at RECEIVED
  expect(progress.at(-1)).toBe(FRAME_BYTES);
  expect(progress.length).toBe(Math.ceil(FRAME_BYTES / 244));
  const d = await r.displayed;
  expect(d.status).toBe('displayed');
  expect(tag.shown).toEqual(frame);
  expect((await client.info()).hasImage).toBe(true);
});

test('commands wait for the refresh to finish', async () => {
  const { client } = await simBadge();
  const r = await client.upload(testFrame());
  let displayedFirst = false;
  r.displayed.then(() => (displayedFirst = true));
  await client.info();
  expect(displayedFirst).toBe(true);
});

test('show, clear and the temperature override', async () => {
  const { client, tag } = await simBadge();
  await expect(client.show()).rejects.toMatchObject({ code: ErrorCode.NO_IMAGE });
  await client.clear(Color.red);
  expect(tag.shown![0]).toBe(0x33);
  let info = await client.setTempOverride(-5);
  expect(info.tempOverride).toBe(-5);
  expect(await client.clear(Color.white)).toBe(-5);
  info = await client.setTempOverride(null);
  expect(info.tempOverride).toBeNull();
  await (await client.upload(testFrame())).displayed;
  expect(typeof (await client.show())).toBe('number');
});

test('firmware 0.1 refuses TEMP with bad command', async () => {
  const { client } = await simBadge({ firmware: [0, 1, 0] });
  const info = await client.hello();
  expect(supportsTemp(info)).toBe(false);
  await expect(client.setTempOverride(10)).rejects.toMatchObject({
    code: ErrorCode.BAD_COMMAND,
  });
  // The client is still usable afterwards.
  expect((await client.info()).firmware).toBe('0.1.0');
});

test('a CRC mismatch is retried once in safe mode', async () => {
  const { client, tag, log } = await simBadge();
  tag.corruptNextUpload = true;
  const r = await client.upload(testFrame());
  expect(r.attempts).toBe(2);
  expect(log.some((l) => l.includes('CRC mismatch'))).toBe(true);
  expect((await r.displayed).status).toBe('displayed');
});

test('a second CRC mismatch fails with a blank badge', async () => {
  const { client, tag } = await simBadge();
  tag.corruptNextUpload = true;
  const err = await client
    .upload(testFrame(), {
      onProgress: (sent) => {
        if (sent > 1000) tag.corruptNextUpload = true; // corrupts the retry too
      },
    })
    .catch((e) => e);
  expect(err).toBeInstanceOf(UploadError);
  expect(err.cause).toBeInstanceOf(TagError);
  expect(err.cause.code).toBe(ErrorCode.CRC);
  expect(err.badgeBlank).toBe(true);
  expect(userMessage(err)).toMatch(/damaged.*blank until/);
});

test('disconnect mid-upload fails the job and says the badge is blank', async () => {
  const { client, tag } = await simBadge({}, { dropAfterBytes: 50_000 });
  const err = await client.upload(testFrame()).catch((e) => e);
  expect(err).toBeInstanceOf(UploadError);
  expect(err.badgeBlank).toBe(true);
  expect(tag.receiving).toBe(false);
  expect(client.connected).toBe(false);
  await expect(client.info()).rejects.toBeInstanceOf(DisconnectedError);
});

test('a bad length is rejected before anything is erased', async () => {
  const { client } = await simBadge();
  const err = await client.upload(new Uint8Array(100)).catch((e) => e);
  expect(err.cause.code).toBe(ErrorCode.BAD_LENGTH);
  expect(err.badgeBlank).toBe(false);
});

test('cancel sends ABORT and leaves the badge idle', async () => {
  const { client, tag, log } = await simBadge();
  const ctl = new AbortController();
  const err = await client
    .upload(testFrame(), {
      signal: ctl.signal,
      onProgress: (sent) => sent > 20_000 && ctl.abort(),
    })
    .catch((e) => e);
  expect(err.cause).toBeInstanceOf(CancelledError);
  expect(log).toContain('tx ABORT');
  await (await client.upload(testFrame())).displayed; // badge accepts a new upload
  expect(tag.stored).not.toBeNull();
  expect(tag.receiving).toBe(false);
});

test('a dead panel reports the refresh failure without failing the upload', async () => {
  const { client, tag } = await simBadge();
  tag.failNextRefresh = true;
  const r = await client.upload(testFrame());
  const d = await r.displayed;
  expect(d.status).toBe('failed');
  if (d.status === 'failed') expect(d.error.code).toBe(ErrorCode.PANEL_TIMEOUT);
  expect(tag.stored).not.toBeNull();
});

test('disconnect during the refresh is not an upload error', async () => {
  const { client, link, tag } = await simBadge();
  // 3 s refresh; switched on after BEGIN so the erase stays instant.
  const r = await client.upload(testFrame(), { onProgress: () => (tag.timing = 'fast') });
  link.drop();
  expect(await r.displayed).toEqual({ status: 'unknown', reason: 'disconnected' });
}, 10_000);

test('refuses a badge speaking another protocol version', async () => {
  const { client, tag } = await simBadge();
  const info = tag.info.bind(tag);
  tag.info = () => {
    const b = info();
    b[2] = 2;
    return b;
  };
  await expect(client.hello()).rejects.toBeInstanceOf(UnsupportedProtocolError);
});

test('times out when the badge goes quiet', async () => {
  const { client, link } = await simBadge();
  link.writeControl = async () => {}; // swallow commands
  await expect(client.info()).rejects.toThrow(/no INFO/);
});
