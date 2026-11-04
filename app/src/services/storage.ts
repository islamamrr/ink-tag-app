// Storage (src/core/model/storage.ts) on the phone: files under the app's
// documents folder, through expo-file-system. Paths use "/" and folders are
// made as needed. Everything here survives app updates; uninstalling the app
// removes it.

import { Directory, File, Paths } from 'expo-file-system';

import type { Storage } from '../core';

const ROOT = 'inktag';

const fileAt = (path: string) => new File(Paths.document, ROOT, ...path.split('/'));

function ensureParent(path: string) {
  const parts = path.split('/').slice(0, -1);
  const dir = new Directory(Paths.document, ROOT, ...parts);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
}

export class FileStorage implements Storage {
  async readText(path: string) {
    const f = fileAt(path);
    return f.exists ? f.text() : null;
  }

  async writeText(path: string, text: string) {
    ensureParent(path);
    // Write a temporary file and move it over, so a crash mid-write never
    // leaves a half-written index behind.
    const tmp = fileAt(`${path}.tmp`);
    await tmp.write(text);
    const f = fileAt(path);
    if (f.exists) f.delete();
    await tmp.move(f);
  }

  async readBytes(path: string) {
    const f = fileAt(path);
    return f.exists ? new Uint8Array(await f.bytes()) : null;
  }

  async writeBytes(path: string, data: Uint8Array) {
    ensureParent(path);
    await fileAt(path).write(data);
  }

  async remove(path: string) {
    const f = fileAt(path);
    if (f.exists) f.delete();
  }
}

/** Reads a picked or shared file (file:// or content:// URI) as bytes. */
export async function readUri(uri: string): Promise<Uint8Array> {
  return new Uint8Array(await new File(uri).bytes());
}
