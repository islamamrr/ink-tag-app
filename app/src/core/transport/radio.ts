// The slice of a Bluetooth LE stack the app needs. The phone implementation
// wraps react-native-ble-plx (src/services/radio.ts); FakeRadio
// (src/core/sim/fakeRadio.ts) puts simulated badges behind it for tests.
// Values are bytes here; base64 is the adapter's business.

import type { Unsubscribe } from './link';

export type RadioState = 'unknown' | 'resetting' | 'unsupported' | 'unauthorized' | 'off' | 'on';

export interface Advertisement {
  /** Android: the MAC address. iOS: a per-phone UUID, stable for that phone only. */
  id: string;
  name: string | null;
  /** dBm; closer to 0 is nearer. */
  rssi: number | null;
}

export interface Radio {
  state(): Promise<RadioState>;
  onStateChange(listener: (state: RadioState) => void): Unsubscribe;

  /** Scans until stopScan(). Results repeat for the same badge as its RSSI changes. */
  startScan(
    serviceUuids: string[],
    onResult: (adv: Advertisement) => void,
    onError: (error: Error) => void,
  ): Promise<void>;
  stopScan(): Promise<void>;

  /** Connects and negotiates the MTU (Android asks for `mtu`; iOS picks its own). */
  connect(id: string, opts: { mtu: number; timeoutMs: number }): Promise<{ mtu: number }>;
  /** Discovers services; resolves with their UUIDs, lower case. */
  discover(id: string): Promise<string[]>;
  /** Android: short connection interval for fast transfers. iOS: nothing to do. */
  requestHighPriority(id: string): Promise<void>;
  /** Subscribes to notifications. The subscription takes a moment to reach the badge. */
  monitor(
    id: string,
    service: string,
    characteristic: string,
    onValue: (data: Uint8Array) => void,
    onError: (error: Error) => void,
  ): Unsubscribe;
  write(
    id: string,
    service: string,
    characteristic: string,
    data: Uint8Array,
    withResponse: boolean,
  ): Promise<void>;
  onDisconnected(id: string, listener: (error: Error | null) => void): Unsubscribe;
  cancelConnection(id: string): Promise<void>;
}
