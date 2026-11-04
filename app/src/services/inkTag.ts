// The app's one InkTag service (src/core/model/inkTag.ts), wired to the
// phone: files, Skia, Bluetooth, the phone's random number generator, and
// photo import. Screens call getInkTag() and subscribe to it.

import * as Crypto from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { BleLink, type BadgeLinks, InkTag, type Log, scanForBadges, TagClient } from '../core';
import { loadFonts } from './fonts';
import { bluetoothAvailable, ensureBluetoothPermissions, getRadio } from './radio';
import { createSkiaRenderer } from './render';
import { FileStorage, readUri } from './storage';

/** Photos are kept at this long edge: plenty for 528 × 792, small on disk. */
const PHOTO_MAX = 1600;

const bleLinks: BadgeLinks = {
  async scan(opts) {
    await ensureBluetoothPermissions();
    return scanForBadges(getRadio(), opts);
  },
  async open(id, log) {
    await ensureBluetoothPermissions();
    const link = await BleLink.open(getRadio(), id, { log: (t) => log('info', t) });
    const client = new TagClient(link, log);
    return { client, close: () => client.close() };
  },
};

let instance: Promise<InkTag> | null = null;
const logListeners = new Set<Log>();

/** Every protocol line from the service, for the developer screen's log. */
export function onServiceLog(l: Log) {
  logListeners.add(l);
  return () => {
    logListeners.delete(l);
  };
}

export function getInkTag(): Promise<InkTag> {
  instance ??= (async () => {
    const renderer = createSkiaRenderer(await loadFonts());
    const app = new InkTag({
      storage: new FileStorage(),
      renderer,
      links: bluetoothAvailable() ? bleLinks : undefined,
      randomBytes: (n) => Crypto.getRandomBytes(n),
      log: (kind, text) => logListeners.forEach((l) => l(kind, text)),
    });
    await app.init();
    return app;
  })();
  instance.catch(() => (instance = null));
  return instance;
}

/**
 * Copies a photo into the library (upright, at most 1600 px, JPEG) and
 * returns its id for a PhotoLayer. Works for gallery picks and shared files.
 */
export async function importPhoto(uri: string): Promise<string> {
  const app = await getInkTag();
  const ref = await ImageManipulator.manipulate(uri, { maxWidth: PHOTO_MAX, maxHeight: PHOTO_MAX }).renderAsync();
  const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  return app.library.addPhoto(await readUri(saved.uri));
}

/** Lets the person pick photos (up to `max`), imports them, returns their ids. */
export async function pickPhotos(max = 1): Promise<string[]> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsMultipleSelection: max > 1,
    selectionLimit: max,
  });
  if (res.canceled) return [];
  const ids: string[] = [];
  for (const a of res.assets.slice(0, max)) ids.push(await importPhoto(a.uri));
  return ids;
}
