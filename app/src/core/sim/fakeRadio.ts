// A pretend Bluetooth stack with FakeTags behind it, shaped like
// react-native-ble-plx: scanning by service UUID, connect with MTU
// negotiation, service discovery, a notification subscription that takes a
// moment to arrive, writes with and without response, and disconnects.
// Lets BleLink and scanning be tested on a laptop, faults included.

import { UUID_CONTROL, UUID_DATA, UUID_SERVICE } from '../protocol/constants';
import type { Unsubscribe } from '../transport/link';
import type { Advertisement, Radio, RadioState } from '../transport/radio';
import { sleep, tick } from '../util/async';
import type { FakeTag } from './fakeTag';

export interface FakeRadioOptions {
  /** Largest MTU the phone allows (iOS picks ~185 by itself). */
  phoneMaxMtu?: number;
  /** Notifications sent sooner than this after subscribing are lost. */
  subscribeDelayMs?: number;
  /** Delay of each write, so several can be in flight. */
  writeDelayMs?: number;
  advertiseEveryMs?: number;
}

interface FakeDevice {
  tag: FakeTag;
  adv: Advertisement;
  /** Advertises some other service: shouldn't show up in an Ink Tag scan. */
  foreign: boolean;
  /** Has the Ink Tag UUID in its advertisement but not in its GATT table. */
  impostor: boolean;
}

interface Session {
  device: FakeDevice;
  queue: Promise<void>;
  subscribedAt: number | null;
  notify: Set<(d: Uint8Array) => void>;
  errors: Set<(e: Error) => void>;
  dataBytes: number;
}

export class FakeRadio implements Radio {
  private _state: RadioState = 'on';
  private stateListeners = new Set<(s: RadioState) => void>();
  private devices = new Map<string, FakeDevice>();
  private sessions = new Map<string, Session>();
  private disconnectListeners = new Map<string, Set<(e: Error | null) => void>>();
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private readonly opts: Required<FakeRadioOptions>;

  // Fault injection and counters for tests.
  /** The next n connects fail, like Android's status 133. */
  failConnects = 0;
  /** Drop the connection after this many data bytes. */
  dropAfterBytes: number | null = null;
  /** Lose this write-without-response chunk (counted from 0 over the session). */
  loseChunk: number | null = null;
  connectAttempts = 0;
  inFlight = 0;
  maxInFlight = 0;
  scanning = false;
  /** Writes in the order they reached the badge: 'C' control, 'd' data. */
  trace: string[] = [];
  private chunkIndex = 0;

  constructor(opts: FakeRadioOptions = {}) {
    this.opts = {
      phoneMaxMtu: 517,
      subscribeDelayMs: 0,
      writeDelayMs: 0,
      advertiseEveryMs: 20,
      ...opts,
    };
  }

  addBadge(
    tag: FakeTag,
    adv: Partial<Advertisement> & { id: string },
    kind: 'badge' | 'foreign' | 'impostor' = 'badge',
  ) {
    this.devices.set(adv.id, {
      tag,
      adv: { name: null, rssi: -60, ...adv },
      foreign: kind === 'foreign',
      impostor: kind === 'impostor',
    });
  }

  setState(s: RadioState) {
    this._state = s;
    this.stateListeners.forEach((l) => l(s));
  }

  async state() {
    return this._state;
  }

  onStateChange(listener: (s: RadioState) => void): Unsubscribe {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  async startScan(
    uuids: string[],
    onResult: (adv: Advertisement) => void,
    onError: (e: Error) => void,
  ) {
    if (this._state !== 'on') {
      onError(new Error(`BluetoothLE is ${this._state}`));
      return;
    }
    this.scanning = true;
    const tick = () => {
      for (const d of this.devices.values()) {
        const advertises = d.foreign ? 'other' : UUID_SERVICE;
        if (this.sessions.has(d.adv.id)) continue; // connected badges stop advertising
        if (uuids.length && !uuids.includes(advertises)) continue;
        onResult({ ...d.adv });
      }
    };
    setTimeout(tick, 0);
    this.scanTimer = setInterval(tick, this.opts.advertiseEveryMs);
  }

  async stopScan() {
    this.scanning = false;
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.scanTimer = null;
  }

  async connect(id: string, { mtu }: { mtu: number; timeoutMs: number }) {
    this.connectAttempts++;
    await tick();
    const device = this.devices.get(id);
    if (!device) throw new Error('Device not found');
    if (this.failConnects > 0) {
      this.failConnects--;
      throw new Error('Device connection failed (GATT 133)');
    }
    this.sessions.set(id, {
      device,
      queue: Promise.resolve(),
      subscribedAt: null,
      notify: new Set(),
      errors: new Set(),
      dataBytes: 0,
    });
    this.chunkIndex = 0;
    const negotiated = Math.min(mtu, this.opts.phoneMaxMtu, device.tag.mtu);
    device.tag.log(`I ble: connected, MTU ${negotiated}`);
    return { mtu: negotiated };
  }

  async discover(id: string) {
    const s = this.session(id);
    return s.device.impostor ? ['0000180f-0000-1000-8000-00805f9b34fb'] : [UUID_SERVICE];
  }

  async requestHighPriority(id: string) {
    this.session(id);
  }

  monitor(
    id: string,
    service: string,
    characteristic: string,
    onValue: (d: Uint8Array) => void,
    onError: (e: Error) => void,
  ): Unsubscribe {
    const s = this.sessions.get(id);
    if (!s || service !== UUID_SERVICE || characteristic !== UUID_CONTROL) {
      setTimeout(() => onError(new Error('Characteristic not found')), 0);
      return () => {};
    }
    s.subscribedAt = Date.now() + this.opts.subscribeDelayMs;
    s.notify.add(onValue);
    s.errors.add(onError);
    return () => {
      s.notify.delete(onValue);
      s.errors.delete(onError);
    };
  }

  async write(
    id: string,
    service: string,
    characteristic: string,
    data: Uint8Array,
    withResponse: boolean,
  ) {
    const s = this.session(id);
    if (service !== UUID_SERVICE) throw new Error('Service not found');
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.opts.writeDelayMs) await sleep(this.opts.writeDelayMs);
      else await tick();
      if (this.sessions.get(id) !== s) throw new Error('Device disconnected');
      if (characteristic === UUID_CONTROL) {
        if (!withResponse) throw new Error('Control needs write with response');
        this.trace.push('C');
        const cmd = data.slice();
        s.queue = s.queue.then(() => s.device.tag.handle(cmd, (n) => this.deliver(s, n)));
      } else if (characteristic === UUID_DATA) {
        if (this.dropAfterBytes !== null && s.dataBytes + data.length > this.dropAfterBytes) {
          this.drop(id);
          throw new Error('Device disconnected');
        }
        const index = this.chunkIndex++;
        if (!withResponse && index === this.loseChunk) return; // lost on air
        s.dataBytes += data.length;
        this.trace.push('d');
        s.device.tag.data(data);
      } else {
        throw new Error('Characteristic not found');
      }
    } finally {
      this.inFlight--;
    }
  }

  private deliver(s: Session, data: Uint8Array) {
    if (this.sessions.get(s.device.adv.id) !== s) return;
    if (s.subscribedAt === null || Date.now() < s.subscribedAt) return; // not subscribed yet
    setTimeout(() => s.notify.forEach((l) => l(data)), 0);
  }

  onDisconnected(id: string, listener: (e: Error | null) => void): Unsubscribe {
    let set = this.disconnectListeners.get(id);
    if (!set) this.disconnectListeners.set(id, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  }

  /** The badge goes out of range. */
  drop(id: string) {
    this.end(id, new Error('Device disconnected'));
  }

  async cancelConnection(id: string) {
    this.end(id, null);
  }

  isConnected(id: string) {
    return this.sessions.has(id);
  }

  private end(id: string, error: Error | null) {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    s.device.tag.disconnected();
    s.device.tag.log('I ble: disconnected');
    if (error) s.errors.forEach((l) => l(error));
    this.disconnectListeners.get(id)?.forEach((l) => l(error));
  }

  private session(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Device is not connected');
    return s;
  }
}
