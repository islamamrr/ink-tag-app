// Byte-level encoders and decoders for the control characteristic.
// All multi-byte fields are little endian.

import {
  Cmd,
  COMMAND_NAMES,
  ERROR_NAMES,
  EVENT_NAMES,
  Evt,
  FMT_NATIVE_4BPP,
  LOCK_KEY_BYTES,
  TEMP_MAX,
  TEMP_MIN,
  TEMP_UNKNOWN,
} from './constants';

export const encodeBegin = (length: number, format: number = FMT_NATIVE_4BPP): Uint8Array => {
  const b = new Uint8Array(6);
  const v = new DataView(b.buffer);
  b[0] = Cmd.BEGIN;
  b[1] = format;
  v.setUint32(2, length, true);
  return b;
};

export const encodeEnd = (crc32: number): Uint8Array => {
  const b = new Uint8Array(5);
  b[0] = Cmd.END;
  new DataView(b.buffer).setUint32(1, crc32 >>> 0, true);
  return b;
};

export const encodeShow = () => Uint8Array.of(Cmd.SHOW);
export const encodeClear = (color: number) => Uint8Array.of(Cmd.CLEAR, color & 0xff);
export const encodeInfo = () => Uint8Array.of(Cmd.INFO);
export const encodeAbort = () => Uint8Array.of(Cmd.ABORT);

/** celsius = null goes back to reading the panel; other values are clamped to −20…60. */
export const encodeTemp = (celsius: number | null): Uint8Array => {
  const t =
    celsius === null ? TEMP_UNKNOWN : Math.max(TEMP_MIN, Math.min(TEMP_MAX, Math.round(celsius)));
  return Uint8Array.of(Cmd.TEMP, t & 0xff);
};

const withKey = (op: number, bytes: Uint8Array) => {
  if (bytes.length !== LOCK_KEY_BYTES) throw new Error(`expected ${LOCK_KEY_BYTES} bytes`);
  const b = new Uint8Array(1 + LOCK_KEY_BYTES);
  b[0] = op;
  b.set(bytes, 1);
  return b;
};
export const encodeLock = (key: Uint8Array) => withKey(Cmd.LOCK, key);
export const encodeAuthRequest = () => Uint8Array.of(Cmd.AUTH);
export const encodeAuthAnswer = (answer: Uint8Array) => withKey(Cmd.AUTH, answer);
export const encodeUnlock = () => Uint8Array.of(Cmd.UNLOCK);

const i8 = (b: number) => (b << 24) >> 24;

export interface TagInfo {
  protocol: number;
  firmware: string;
  firmwareVersion: [number, number, number];
  width: number;
  height: number;
  format: number;
  hasImage: boolean;
  /** Last panel reading in °C, or null if unknown. */
  temperature: number | null;
  maxLength: number;
  /**
   * undefined: firmware older than 0.2 can't report or set an override.
   * null: override off (reading the panel). Otherwise the fixed °C.
   */
  tempOverride?: number | null;
  /** undefined: firmware older than 0.3. */
  panelId?: Uint8Array;
  /** undefined: firmware older than 0.4, which has no lock. */
  lock?: LockState;
}

export interface LockState {
  /** An owner key is set: only its phone may change the badge. */
  locked: boolean;
  /** This connection proved it holds the key (or the badge is unlocked). */
  authorized: boolean;
}

/** INFO without the fw 0.2+ and 0.3+ extensions. */
export const INFO_BASE_SIZE = 17;

export function parseInfo(data: Uint8Array): TagInfo {
  if (data.length < INFO_BASE_SIZE || data[0] !== Evt.INFO) {
    throw new Error(`malformed INFO (${data.length} bytes)`);
  }
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fw: [number, number, number] = [data[3], data[4], data[5]];
  const info: TagInfo = {
    protocol: data[2],
    firmware: fw.join('.'),
    firmwareVersion: fw,
    width: v.getUint16(6, true),
    height: v.getUint16(8, true),
    format: data[10],
    hasImage: data[11] !== 0,
    temperature: i8(data[12]) === TEMP_UNKNOWN ? null : i8(data[12]),
    maxLength: v.getUint32(13, true),
  };
  // fw 0.2 appends the override (byte 17), fw 0.3 then the panel id (18..20).
  if (data.length > INFO_BASE_SIZE) {
    const o = i8(data[INFO_BASE_SIZE]);
    info.tempOverride = o === TEMP_UNKNOWN ? null : o;
  }
  if (data.length >= INFO_BASE_SIZE + 4) info.panelId = data.slice(18, 21);
  // fw 0.4 then appends lock flags: bit 0 locked, bit 1 this connection authorized.
  if (data.length >= INFO_BASE_SIZE + 5) {
    const f = data[21];
    info.lock = { locked: (f & 1) !== 0, authorized: (f & 2) !== 0 || (f & 1) === 0 };
  }
  return info;
}

/** false: the panel didn't answer at boot (wiring). undefined: firmware can't tell. */
export function panelAnswering(info: TagInfo): boolean | undefined {
  const id = info.panelId;
  if (!id) return undefined;
  const all = (x: number) => id.every((b) => b === x);
  return !(all(0xff) || all(0x00));
}

export const supportsTemp = (info: TagInfo) => info.tempOverride !== undefined;
export const supportsLock = (info: TagInfo) => info.lock !== undefined;

// ---------------------------------------------------------------- logging

const hex = (data: Uint8Array) =>
  Array.from(data, (b) => b.toString(16).padStart(2, '0')).join(' ');
const tempStr = (t: number | null | undefined) => (t == null ? 'unknown' : `${t} °C`);

export function describeCommand(data: Uint8Array): string {
  const name = COMMAND_NAMES[data[0]] ?? `0x${data[0]?.toString(16)}`;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data[0] === Cmd.BEGIN && data.length >= 6)
    return `${name} format ${data[1]}, ${v.getUint32(2, true)} bytes`;
  if (data[0] === Cmd.END && data.length >= 5)
    return `${name} crc32 ${v.getUint32(1, true).toString(16).padStart(8, '0')}`;
  if (data[0] === Cmd.CLEAR && data.length >= 2) return `${name} ${data[1]}`;
  // Never log key material.
  if ((data[0] === Cmd.LOCK || data[0] === Cmd.AUTH) && data.length > 1) return `${name} (16 bytes)`;
  if (data[0] === Cmd.TEMP && data.length >= 2) {
    const t = i8(data[1]);
    return `${name} override ${t === TEMP_UNKNOWN ? 'off' : `${t} °C`}`;
  }
  return name;
}

export function describeEvent(data: Uint8Array): string {
  if (data.length < 2) return `short notification ${hex(data)}`;
  const name = EVENT_NAMES[data[0]] ?? `0x${data[0].toString(16)}`;
  if (data[0] === Evt.ERROR) {
    const cmd = data.length > 2 ? (COMMAND_NAMES[data[2]] ?? data[2]) : '?';
    return `${name} ${ERROR_NAMES[data[1]] ?? data[1]} (command ${cmd})`;
  }
  if (data[0] === Evt.DISPLAYED && data.length >= 3) {
    const t = i8(data[2]);
    return `${name} panel ${tempStr(t === TEMP_UNKNOWN ? null : t)}`;
  }
  if (data[0] === Evt.INFO) {
    let i: TagInfo;
    try {
      i = parseInfo(data);
    } catch {
      return `${name} (malformed) ${hex(data)}`;
    }
    let s =
      `${name} fw ${i.firmware}, ${i.width}x${i.height}, ` +
      `stored image ${i.hasImage ? 'yes' : 'no'}, temp ${tempStr(i.temperature)}`;
    if (i.tempOverride !== undefined)
      s += `, override ${i.tempOverride === null ? 'off' : tempStr(i.tempOverride)}`;
    if (i.panelId) s += `, panel id ${hex(i.panelId)}`;
    if (i.lock)
      s += i.lock.locked
        ? `, locked${i.lock.authorized ? ' (authorized)' : ''}`
        : ', unlocked';
    return s;
  }
  return name;
}

export const displayedTemperature = (data: Uint8Array): number | null => {
  if (data.length < 3) return null;
  const t = i8(data[2]);
  return t === TEMP_UNKNOWN ? null : t;
};
