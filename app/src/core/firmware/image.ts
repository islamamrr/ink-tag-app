// Reading a firmware update file: the ESP-IDF app image the badge installs
// over Bluetooth (firmware/build-*/inktag.bin, not the merged USB image).
// Its header names the chip, and the app description right after the first
// segment header carries the version, so the app never has to trust a
// separate label for which badge a file fits.

import { CHIP_NAMES } from '../protocol/constants';

export type Version = [number, number, number];

export interface FirmwareImage {
  bytes: Uint8Array;
  /** Chip id from the image header (Chip.*). */
  chip: number;
  version: Version;
  /** "0.6.1" */
  versionText: string;
  /** ESP-IDF project name; the badge only accepts "inktag". */
  project: string;
}

const IMAGE_MAGIC = 0xe9;
const APP_DESC_MAGIC = 0xabcd5432;
/** 24-byte image header, then the first segment's 8-byte header. */
const APP_DESC_OFFSET = 32;

const cString = (b: Uint8Array) => {
  const end = b.indexOf(0);
  return String.fromCharCode(...(end < 0 ? b : b.subarray(0, end)));
};

export function parseVersion(text: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative if a is older than b, 0 if the same, positive if newer. */
export function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export const chipName = (chip: number) => CHIP_NAMES[chip] ?? `chip ${chip}`;

/** Throws with a plain reason when the file isn't an Ink Tag firmware update. */
export function parseFirmwareImage(bytes: Uint8Array): FirmwareImage {
  if (bytes.length < APP_DESC_OFFSET + 256 || bytes[0] !== IMAGE_MAGIC)
    throw new Error("That file isn't a firmware update (use the app image, not the USB image).");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(APP_DESC_OFFSET, true) !== APP_DESC_MAGIC)
    throw new Error("That firmware file has no version information.");
  const versionText = cString(bytes.subarray(APP_DESC_OFFSET + 16, APP_DESC_OFFSET + 48));
  const project = cString(bytes.subarray(APP_DESC_OFFSET + 48, APP_DESC_OFFSET + 80));
  const version = parseVersion(versionText);
  if (!version) throw new Error(`That firmware's version "${versionText}" isn't a release number.`);
  if (project !== 'inktag') throw new Error(`That firmware is for "${project}", not an Ink Tag badge.`);
  return { bytes, chip: v.getUint16(12, true), version, versionText: version.join('.'), project };
}
