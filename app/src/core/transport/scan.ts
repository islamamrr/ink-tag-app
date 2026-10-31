// Finds badges nearby: scans for the Ink Tag service UUID (not the name, which
// is only in the scan response and can be missing), keeps one entry per badge
// and sorts them nearest first.

import { UUID_SERVICE } from '../protocol/constants';
import { BluetoothError } from '../protocol/errors';
import { ensureRadioOn } from './bleLink';
import type { Radio } from './radio';

export interface FoundBadge {
  id: string;
  /** "InkTag-XXXX", or a fallback built from the id if the name wasn't heard. */
  name: string;
  rssi: number | null;
  lastSeen: number;
}

export interface ScanOptions {
  /** Stop after this long. */
  timeoutMs?: number;
  /** Stop as soon as one badge is found (for "connect to the nearest"). */
  stopAtFirst?: boolean;
  signal?: AbortSignal;
  /** Called with the full list, nearest first, whenever it changes. */
  onUpdate?: (badges: FoundBadge[]) => void;
}

const fallbackName = (id: string) =>
  `InkTag-${id.replace(/[^0-9a-f]/gi, '').slice(-4).toUpperCase()}`;

/** Resolves with the badges heard, nearest first. Throws BluetoothError if Bluetooth is off. */
export async function scanForBadges(radio: Radio, opts: ScanOptions = {}): Promise<FoundBadge[]> {
  const { timeoutMs = 6_000, stopAtFirst = false, signal, onUpdate } = opts;
  await ensureRadioOn(radio);
  const found = new Map<string, FoundBadge>();
  const sorted = () =>
    [...found.values()].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));

  return new Promise<FoundBadge[]>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => finish(), timeoutMs);
    const onAbort = () => finish();
    signal?.addEventListener('abort', onAbort);

    function finish(error?: Error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      radio
        .stopScan()
        .catch(() => {})
        .then(() => (error ? reject(error) : resolve(sorted())));
    }

    radio
      .startScan(
        [UUID_SERVICE],
        (adv) => {
          if (done) return;
          const prev = found.get(adv.id);
          found.set(adv.id, {
            id: adv.id,
            name: adv.name ?? prev?.name ?? fallbackName(adv.id),
            rssi: adv.rssi ?? prev?.rssi ?? null,
            lastSeen: Date.now(),
          });
          onUpdate?.(sorted());
          if (stopAtFirst) finish();
        },
        (err) => finish(err),
      )
      .catch((err: unknown) =>
        finish(err instanceof Error ? err : new BluetoothError('off', String(err))),
      );
    if (signal?.aborted) finish();
  });
}
