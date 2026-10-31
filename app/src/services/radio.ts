// The phone's Bluetooth: react-native-ble-plx behind the Radio interface from
// src/core, plus the runtime permissions Android needs before scanning.
//
// react-native-ble-plx is a native module, so it exists only in a development
// or release build, not in Expo Go. getRadio() reports that as a
// BluetoothError('no-native-module') instead of crashing at startup.

import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { BleManager, ConnectionPriority, ScanMode, State, type Subscription } from 'react-native-ble-plx';

import {
  type Advertisement,
  BluetoothError,
  fromBase64,
  type Radio,
  type RadioState,
  toBase64,
} from '../core';

const STATES: Record<State, RadioState> = {
  [State.Unknown]: 'unknown',
  [State.Resetting]: 'resetting',
  [State.Unsupported]: 'unsupported',
  [State.Unauthorized]: 'unauthorized',
  [State.PoweredOff]: 'off',
  [State.PoweredOn]: 'on',
};

const unsub = (s: Subscription) => () => s.remove();

class PlxRadio implements Radio {
  constructor(private readonly ble: BleManager) {}

  async state() {
    return STATES[await this.ble.state()];
  }

  onStateChange(listener: (s: RadioState) => void) {
    return unsub(this.ble.onStateChange((s) => listener(STATES[s]), false));
  }

  async startScan(
    uuids: string[],
    onResult: (adv: Advertisement) => void,
    onError: (e: Error) => void,
  ) {
    await this.ble.startDeviceScan(
      uuids,
      // Low latency scanning is active scanning, so Android also hears the
      // scan response, which is where the badge puts its name.
      { allowDuplicates: true, scanMode: ScanMode.LowLatency },
      (error, device) => {
        if (error) onError(error);
        else if (device)
          onResult({ id: device.id, name: device.localName ?? device.name, rssi: device.rssi });
      },
    );
  }

  async stopScan() {
    await this.ble.stopDeviceScan();
  }

  async connect(id: string, { mtu, timeoutMs }: { mtu: number; timeoutMs: number }) {
    // requestMTU is Android only; iOS negotiates by itself and reports it.
    const device = await this.ble.connectToDevice(id, {
      requestMTU: Platform.OS === 'android' ? mtu : undefined,
      timeout: timeoutMs,
    });
    return { mtu: device.mtu };
  }

  async discover(id: string) {
    await this.ble.discoverAllServicesAndCharacteristicsForDevice(id);
    const services = await this.ble.servicesForDevice(id);
    return services.map((s) => s.uuid.toLowerCase());
  }

  async requestHighPriority(id: string) {
    if (Platform.OS === 'android')
      await this.ble.requestConnectionPriorityForDevice(id, ConnectionPriority.High);
  }

  monitor(
    id: string,
    service: string,
    characteristic: string,
    onValue: (d: Uint8Array) => void,
    onError: (e: Error) => void,
  ) {
    return unsub(
      this.ble.monitorCharacteristicForDevice(id, service, characteristic, (error, c) => {
        if (error) onError(error);
        else if (c?.value) onValue(fromBase64(c.value));
      }),
    );
  }

  async write(
    id: string,
    service: string,
    characteristic: string,
    data: Uint8Array,
    withResponse: boolean,
  ) {
    const b64 = toBase64(data);
    if (withResponse)
      await this.ble.writeCharacteristicWithResponseForDevice(id, service, characteristic, b64);
    else await this.ble.writeCharacteristicWithoutResponseForDevice(id, service, characteristic, b64);
  }

  onDisconnected(id: string, listener: (e: Error | null) => void) {
    return unsub(this.ble.onDeviceDisconnected(id, (error) => listener(error)));
  }

  async cancelConnection(id: string) {
    // Also cancels a connection still being made. Rejects if there was none.
    await this.ble.cancelDeviceConnection(id).catch(() => {});
  }
}

let radio: PlxRadio | null = null;

/** True when this build has the Bluetooth module (a development build, not Expo Go). */
export const bluetoothAvailable = () => NativeModules.BlePlx != null;

/** The phone's Bluetooth, created once. Throws BluetoothError in Expo Go. */
export function getRadio(): Radio {
  if (!bluetoothAvailable()) throw new BluetoothError('no-native-module');
  radio ??= new PlxRadio(new BleManager());
  return radio;
}

/**
 * Asks for what Android needs to scan and connect: "Nearby devices" on
 * Android 12+, location on Android 11 and older (Android's rule for BLE
 * scanning, not something the app uses). iOS asks by itself the first time
 * Bluetooth is used. Throws BluetoothError('permission') if refused.
 */
export async function ensureBluetoothPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const P = PermissionsAndroid.PERMISSIONS;
  const needed =
    Number(Platform.Version) >= 31
      ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT]
      : [P.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(needed);
  const refused = needed.filter((p) => result[p] !== PermissionsAndroid.RESULTS.GRANTED);
  if (refused.length) throw new BluetoothError('permission', refused.join(', '));
}
