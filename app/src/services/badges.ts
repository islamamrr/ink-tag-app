// Finds and connects badges: real ones over Bluetooth, and the simulator.

import {
  BleLink,
  FakeTag,
  type Link,
  type Log,
  scanForBadges,
  SimLink,
  TagClient,
  type TagInfo,
  type Timing,
  TimeoutError,
} from '../core';
import { ensureBluetoothPermissions, getRadio } from './radio';

export interface BadgeHandle {
  id: string;
  name: string;
  kind: 'simulator' | 'ble';
  rssi?: number | null;
}

export interface Connection {
  badge: BadgeHandle;
  client: TagClient;
  info: TagInfo;
  link: Link;
  /** Simulator only: the fake badge, for fault injection and its panel view. */
  sim?: { tag: FakeTag; link: SimLink };
}

export const SIMULATOR: BadgeHandle = { id: 'simulator', name: 'Simulator badge', kind: 'simulator' };

/** Scans for real badges, nearest first. Asks for Bluetooth permission if needed. */
export async function scan(
  opts: { timeoutMs?: number; signal?: AbortSignal; onUpdate?: (b: BadgeHandle[]) => void } = {},
): Promise<BadgeHandle[]> {
  await ensureBluetoothPermissions();
  const toHandles = (l: { id: string; name: string; rssi: number | null }[]) =>
    l.map((b): BadgeHandle => ({ id: b.id, name: b.name, rssi: b.rssi, kind: 'ble' }));
  const found = await scanForBadges(getRadio(), {
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
    onUpdate: opts.onUpdate && ((l) => opts.onUpdate!(toHandles(l))),
  });
  return toHandles(found);
}

export async function connect(
  badge: BadgeHandle,
  log: Log,
  opts: { timing?: Timing; serial?: (line: string) => void } = {},
): Promise<Connection> {
  if (badge.kind === 'simulator') {
    const tag = new FakeTag({ timing: opts.timing ?? 'fast', log: opts.serial });
    const link = new SimLink(tag, { bytesPerSecond: 20 * 1024 });
    await link.connect();
    const client = new TagClient(link, log);
    const info = await client.hello();
    return { badge, client, info, link, sim: { tag, link } };
  }

  await ensureBluetoothPermissions();
  const link = await BleLink.open(getRadio(), badge.id, { log: (t) => log('info', t) });
  const client = new TagClient(link, log);
  try {
    let info: TagInfo;
    try {
      info = await client.hello();
    } catch (e) {
      // The first INFO can be lost if the notification subscription reached
      // the badge late. Ask once more before giving up.
      if (!(e instanceof TimeoutError)) throw e;
      log('info', 'no INFO yet, asking again');
      info = await client.hello();
    }
    return { badge, client, info, link };
  } catch (e) {
    await client.close().catch(() => {});
    throw e;
  }
}
