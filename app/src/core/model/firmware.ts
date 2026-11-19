// The badge firmware the app carries. The files ship inside the app (and its
// over-the-air updates), listed in assets/firmware/firmware.json; the app
// installs them on badges that run something older.

import { compareVersions, parseFirmwareImage, parseVersion, type FirmwareImage } from '../firmware/image';
import type { TagInfo } from '../protocol/codec';
import type { UpdateStage } from '../protocol/client';
import { sha256, toHex } from '../util/sha256';

/** One entry of firmware.json. */
export interface BundledFirmware {
  chip: number;
  file: string;
  version: string;
  size: number;
  sha256: string;
}

/** Where the app's firmware files come from: bundled assets on the phone, files in tests. */
export interface FirmwareSource {
  images: BundledFirmware[];
  load(image: BundledFirmware): Promise<Uint8Array>;
}

export interface FirmwareOffer {
  image: BundledFirmware;
  /** What the badge runs now. */
  from: string;
  to: string;
  /** The bundled version is newer than the badge's. False for a reinstall. */
  newer: boolean;
}

/** The bundled firmware for this badge's chip, or null if it can't update over Bluetooth. */
export function firmwareFor(images: BundledFirmware[], info: TagInfo): FirmwareOffer | null {
  if (!info.update) return null;
  const image = images.find((i) => i.chip === info.update!.chip);
  const to = image && parseVersion(image.version);
  if (!image || !to) return null;
  return { image, from: info.firmware, to: to.join('.'), newer: compareVersions(to, info.firmwareVersion) > 0 };
}

/** Loads a bundled file and checks it is exactly what firmware.json promised. */
export async function loadFirmware(source: FirmwareSource, image: BundledFirmware): Promise<FirmwareImage> {
  const bytes = await source.load(image);
  if (bytes.length !== image.size || toHex(sha256(bytes)) !== image.sha256)
    throw new Error('The firmware file in the app is damaged. Update the app.');
  const parsed = parseFirmwareImage(bytes);
  if (parsed.chip !== image.chip || parsed.versionText !== parseVersion(image.version)?.join('.'))
    throw new Error("The firmware file in the app doesn't match its label. Update the app.");
  return parsed;
}

export type FirmwareStage = UpdateStage | 'preparing' | 'reconnecting';

/** A firmware update in progress, for the badge page. */
export interface FirmwareJob {
  badgeId: string;
  from: string;
  to: string;
  stage: FirmwareStage;
  sent: number;
  total: number;
  /** Started by the app on its own (vs. the developer screen). */
  auto: boolean;
}

export type FirmwareResult =
  | { status: 'updated'; from: string; to: string; at: number }
  | { status: 'rolled-back'; from: string; to: string; at: number }
  | { status: 'failed' | 'cancelled'; from: string; to: string; at: number; message: string };
