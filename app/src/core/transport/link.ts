// A connection to one badge. BleLink (react-native-ble-plx, phase 2) and
// SimLink (the simulator) both implement it, so TagClient can't tell them apart.

export type Unsubscribe = () => void;

export interface Link {
  /** Negotiated ATT MTU. Data chunks are mtu − 3 bytes. */
  readonly mtu: number;
  readonly connected: boolean;
  writeControl(data: Uint8Array): Promise<void>;
  /** withResponse = false is write without response. */
  writeData(data: Uint8Array, withResponse: boolean): Promise<void>;
  /** Control characteristic notifications. */
  onNotify(listener: (data: Uint8Array) => void): Unsubscribe;
  onDisconnect(listener: () => void): Unsubscribe;
  close(): Promise<void>;
}
