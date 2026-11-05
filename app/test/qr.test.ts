// QR text encoding, and the start-up crash it once caused: the app bundle
// uses qrcode-generator's ESM build, which has no stringToBytesFuncs table.

import { utf8Bytes } from '../src/core/design/qr';

test('utf8Bytes matches TextEncoder', () => {
  for (const s of ['', 'hello', 'Café', 'إسلام', '日本語', 'emoji 😀👍🏽', 'a\uD800b']) {
    expect(utf8Bytes(s)).toEqual(Array.from(new TextEncoder().encode(s)));
  }
});

test('qr.ts loads and draws with the ESM build of the library', () => {
  jest.isolateModules(() => {
    jest.doMock('qrcode-generator', () => {
      const real = jest.requireActual('qrcode-generator');
      const esm = (...args: unknown[]) => real(...args);
      Object.assign(esm, real);
      delete (esm as { stringToBytesFuncs?: unknown }).stringToBytesFuncs;
      return { __esModule: true, default: esm };
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { qrMatrix } = require('../src/core/design/qr');
    expect(qrMatrix('https://inktag.dev').length).toBeGreaterThan(20);
  });
});
