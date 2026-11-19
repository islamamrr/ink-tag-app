// Copies the badge firmware update images (firmware/prebuilt/*-update.bin)
// into the app, and writes assets/firmware/firmware.json with each chip's
// version, size and SHA-256. The app ships these in its own over-the-air
// updates and installs them on badges running older firmware.
//
//   node tools/bundle_firmware.mjs     (from app/, after rebuilding firmware/prebuilt)
//
// Not an npm script on purpose: package.json scripts are part of the
// runtime fingerprint, and changing them would keep this from reaching
// installed builds as an over-the-air update.

import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const prebuilt = join(app, '..', 'firmware', 'prebuilt');
const out = join(app, 'assets', 'firmware');
mkdirSync(out, { recursive: true });

const CHIPS = { esp32c3: 5, esp32c6: 13 };
const cstr = (b) => b.subarray(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0)).toString('latin1');

const manifest = { images: [] };
for (const [name, chip] of Object.entries(CHIPS)) {
  const file = `inktag-${name}-update.bin`;
  const bytes = readFileSync(join(prebuilt, file));
  if (bytes[0] !== 0xe9 || bytes.readUInt16LE(12) !== chip) throw new Error(`${file}: not a ${name} app image`);
  if (bytes.readUInt32LE(32) !== 0xabcd5432) throw new Error(`${file}: no app description`);
  const version = cstr(bytes.subarray(48, 80));
  copyFileSync(join(prebuilt, file), join(out, file));
  manifest.images.push({
    chip,
    file,
    version,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  console.log(`${file}: ${version}, ${bytes.length} bytes`);
}
writeFileSync(join(out, 'firmware.json'), JSON.stringify(manifest, null, 2) + '\n');
