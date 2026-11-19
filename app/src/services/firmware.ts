// The badge firmware bundled with the app (assets/firmware, written by
// `node tools/bundle_firmware.mjs`). It reaches phones with the app's EAS updates;
// EAS only downloads an asset again when the file changes.

import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import type { BundledFirmware, FirmwareSource } from '../core';
import manifest from '../../assets/firmware/firmware.json';

/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles assets through require() */
const FILES: Record<string, number> = {
  'inktag-esp32c3-update.bin': require('../../assets/firmware/inktag-esp32c3-update.bin'),
  'inktag-esp32c6-update.bin': require('../../assets/firmware/inktag-esp32c6-update.bin'),
};
/* eslint-enable @typescript-eslint/no-require-imports */

export const bundledFirmware: FirmwareSource = {
  images: (manifest.images as BundledFirmware[]).filter((i) => FILES[i.file] !== undefined),
  async load(image) {
    const [asset] = await Asset.loadAsync(FILES[image.file]);
    return new Uint8Array(await new File(asset.localUri ?? asset.uri).bytes());
  },
};
