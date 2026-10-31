// Link over Bluetooth LE: one connection to one badge through a Radio
// (react-native-ble-plx on the phone, FakeRadio in tests).
//
// What it handles so TagClient doesn't have to:
// - Bluetooth off / not allowed, reported as BluetoothError before connecting.
// - Connect retries: Android's stack fails a first connect now and then
//   (status 133), so connecting is tried up to three times.
// - The MTU: Android asks for 517 (the badge's maximum); iOS picks its own.
// - The notification subscription: it takes a moment to reach the badge, so
//   open() waits briefly before the first command can be sent.
// - Write without response: a few writes are kept in flight so the native
//   queue never runs dry. A write with response, or any control write, waits
//   for them first, so commands never overtake data.
// - One disconnect event, whether the badge left, the phone closed the link
//   or a write failed.

import { UUID_CONTROL, UUID_DATA, UUID_SERVICE } from '../protocol/constants';
import { BluetoothError } from '../protocol/errors';
import { sleep } from '../util/async';
import type { Link, Unsubscribe } from './link';
import type { Radio, RadioState } from './radio';

export interface BleLinkOptions {
  /** MTU to ask for. The badge accepts up to 517. */
  mtu?: number;
  connectTimeoutMs?: number;
  connectAttempts?: number;
  /** Delay before connect attempt n+1 is n × this. */
  retryDelayMs?: number;
  /** Wait after subscribing to notifications, before the first command. */
  subscribeSettleMs?: number;
  /** Writes without response allowed in flight at once. 1 = one at a time. */
  maxInFlight?: number;
  log?: (text: string) => void;
}

const DEFAULTS: Required<Omit<BleLinkOptions, 'log'>> = {
  mtu: 517,
  connectTimeoutMs: 10_000,
  connectAttempts: 3,
  retryDelayMs: 600,
  subscribeSettleMs: 300,
  maxInFlight: 4,
};

/** Waits for the radio to settle and throws BluetoothError unless it's on. */
export async function ensureRadioOn(radio: Radio, waitMs = 3_000): Promise<void> {
  let state = await radio.state();
  if (state === 'unknown' || state === 'resetting') {
    state = await new Promise<RadioState>((resolve) => {
      let unsub: Unsubscribe = () => {};
      const timer = setTimeout(() => finish(state), waitMs);
      function finish(s: RadioState) {
        clearTimeout(timer);
        unsub();
        resolve(s);
      }
      unsub = radio.onStateChange((s) => {
        if (s !== 'unknown' && s !== 'resetting') finish(s);
      });
      // The state may have changed between state() and subscribing.
      radio.state().then((s) => {
        if (s !== 'unknown' && s !== 'resetting') finish(s);
      });
    });
  }
  switch (state) {
    case 'on':
      return;
    case 'off':
    case 'unauthorized':
    case 'unsupported':
      throw new BluetoothError(state);
    default:
      throw new BluetoothError('off', `radio state ${state}`);
  }
}

export class BleLink implements Link {
  private _connected = true;
  private closing = false;
  private notifyListeners = new Set<(d: Uint8Array) => void>();
  private disconnectListeners = new Set<() => void>();
  private unsubs: Unsubscribe[] = [];
  private inflight = new Set<Promise<void>>();
  private writeError: Error | null = null;

  private constructor(
    private readonly radio: Radio,
    readonly id: string,
    readonly mtu: number,
    private readonly opts: Required<Omit<BleLinkOptions, 'log'>>,
    private readonly log: (text: string) => void,
  ) {}

  /** Connects to the badge with this id, ready for TagClient. */
  static async open(radio: Radio, id: string, options: BleLinkOptions = {}): Promise<BleLink> {
    const opts = { ...DEFAULTS, ...options };
    const log = options.log ?? (() => {});
    await ensureRadioOn(radio);

    let mtu = 23;
    for (let attempt = 1; ; attempt++) {
      try {
        ({ mtu } = await radio.connect(id, { mtu: opts.mtu, timeoutMs: opts.connectTimeoutMs }));
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`connect attempt ${attempt} failed: ${msg}`);
        await radio.cancelConnection(id).catch(() => {});
        if (attempt >= opts.connectAttempts) throw new BluetoothError('connect-failed', msg);
        await sleep(opts.retryDelayMs * attempt);
      }
    }

    try {
      const services = await radio.discover(id);
      if (!services.includes(UUID_SERVICE)) throw new BluetoothError('not-a-badge');
      await radio.requestHighPriority(id).catch((e) => log(`high priority refused: ${e}`));
      const link = new BleLink(radio, id, mtu, opts, log);
      link.attach();
      await sleep(opts.subscribeSettleMs);
      if (!link.connected) throw new BluetoothError('connect-failed', 'dropped while setting up');
      log(`connected to ${id}, MTU ${mtu}`);
      return link;
    } catch (e) {
      await radio.cancelConnection(id).catch(() => {});
      if (e instanceof BluetoothError) throw e;
      throw new BluetoothError('connect-failed', e instanceof Error ? e.message : String(e));
    }
  }

  private attach() {
    this.unsubs.push(
      this.radio.onDisconnected(this.id, (err) => {
        this.log(`disconnected${err ? `: ${err.message}` : ''}`);
        this.lost();
      }),
      this.radio.monitor(
        this.id,
        UUID_SERVICE,
        UUID_CONTROL,
        (data) => {
          if (this._connected) this.notifyListeners.forEach((l) => l(data));
        },
        (err) => {
          // Also fires when the link drops; onDisconnected reports that.
          if (this._connected && !this.closing) this.log(`notifications failed: ${err.message}`);
        },
      ),
    );
  }

  get connected() {
    return this._connected;
  }

  onNotify(listener: (data: Uint8Array) => void): Unsubscribe {
    this.notifyListeners.add(listener);
    return () => this.notifyListeners.delete(listener);
  }

  onDisconnect(listener: () => void): Unsubscribe {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  async writeControl(data: Uint8Array) {
    await this.drain();
    this.check();
    await this.radio.write(this.id, UUID_SERVICE, UUID_CONTROL, data.slice(), true);
  }

  async writeData(data: Uint8Array, withResponse: boolean) {
    if (withResponse) {
      await this.drain();
      this.check();
      await this.radio.write(this.id, UUID_SERVICE, UUID_DATA, data.slice(), true);
      return;
    }
    this.check();
    while (this.inflight.size >= this.opts.maxInFlight) {
      await Promise.race(this.inflight);
      this.check();
    }
    const p: Promise<void> = this.radio
      .write(this.id, UUID_SERVICE, UUID_DATA, data.slice(), false)
      .catch((e: unknown) => {
        this.writeError ??= e instanceof Error ? e : new Error(String(e));
      })
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  /** Waits for writes in flight, then reports the first one that failed. */
  private async drain() {
    while (this.inflight.size) await Promise.all(this.inflight);
    this.check();
  }

  private check() {
    const err = this.writeError;
    if (err) {
      this.writeError = null;
      throw err;
    }
    if (!this._connected) throw new Error('not connected');
  }

  private lost() {
    if (!this._connected) return;
    this._connected = false;
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.disconnectListeners.forEach((l) => l());
  }

  async close() {
    if (!this._connected) return;
    this.closing = true;
    await Promise.allSettled(this.inflight);
    this.lost();
    await this.radio.cancelConnection(this.id).catch(() => {});
  }
}
