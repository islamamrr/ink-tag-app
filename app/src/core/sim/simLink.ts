// In-process Link to a FakeTag. Commands are queued and run one at a time,
// like the firmware's main loop.

import type { Link, Unsubscribe } from '../transport/link';
import { sleep } from '../util/async';
import type { FakeTag } from './fakeTag';

export interface SimLinkOptions {
  /** Simulated throughput of the data characteristic; 0 = as fast as possible. */
  bytesPerSecond?: number;
  /** Drop the connection after this many data bytes (fault injection). */
  dropAfterBytes?: number;
}

export class SimLink implements Link {
  readonly mtu: number;
  private _connected = false;
  private notifyListeners = new Set<(d: Uint8Array) => void>();
  private disconnectListeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private dataBytes = 0;

  constructor(
    readonly tag: FakeTag,
    private readonly opts: SimLinkOptions = {},
  ) {
    this.mtu = tag.mtu;
  }

  get connected() {
    return this._connected;
  }

  async connect() {
    await sleep(this.tag.timing === 'instant' ? 0 : 400);
    this._connected = true;
    this.tag.log(`I ble: connected, MTU ${this.mtu}`);
  }

  onNotify(listener: (d: Uint8Array) => void): Unsubscribe {
    this.notifyListeners.add(listener);
    return () => this.notifyListeners.delete(listener);
  }

  onDisconnect(listener: () => void): Unsubscribe {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  private notify = (data: Uint8Array) => {
    if (!this._connected) return;
    // Deliver on a later tick, like a real notification.
    setTimeout(() => this.notifyListeners.forEach((l) => l(data)), 0);
  };

  async writeControl(data: Uint8Array) {
    this.assertConnected();
    const cmd = data.slice();
    this.queue = this.queue.then(() => (this._connected ? this.tag.handle(cmd, this.notify) : undefined));
  }

  async writeData(data: Uint8Array, withResponse: boolean) {
    this.assertConnected();
    const { bytesPerSecond = 0, dropAfterBytes } = this.opts;
    if (dropAfterBytes !== undefined && this.dataBytes + data.length > dropAfterBytes) {
      this.drop();
      throw new Error('link dropped');
    }
    this.dataBytes += data.length;
    if (bytesPerSecond > 0) await sleep((data.length / bytesPerSecond) * 1000);
    else if (withResponse) await sleep(0);
    this.tag.data(data);
  }

  /** Simulates the badge going out of range. */
  drop() {
    if (!this._connected) return;
    this._connected = false;
    this.tag.disconnected();
    this.tag.log('I ble: disconnected');
    this.disconnectListeners.forEach((l) => l());
  }

  async close() {
    this.drop();
  }

  private assertConnected() {
    if (!this._connected) throw new Error('not connected');
  }
}
