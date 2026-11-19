// Byte-level encoders and decoders for the control characteristic.
// All multi-byte fields are little endian.

import {
  BEGIN_SHOW,
  Chip,
  CHIP_NAMES,
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
  UPDATE_ROLLED_BACK,
  UPDATE_RUNNING_SLOT1,
} from './constants';

/**
 * BEGIN. Without a slot (and on firmware before 0.6) the picture replaces the
 * current one and is drawn. With a slot (fw 0.6+) it goes there, and `flags`
 * (BEGIN_SHOW) says whether to draw it.
 */
export const encodeBegin = (
  length: number,
  format: number = FMT_NATIVE_4BPP,
  slot?: number,
  flags: number = BEGIN_SHOW,
): Uint8Array => {
  const b = new Uint8Array(slot === undefined ? 6 : 8);
  const v = new DataView(b.buffer);
  b[0] = Cmd.BEGIN;
  b[1] = format;
  v.setUint32(2, length, true);
  if (slot !== undefined) {
    b[6] = slot & 0xff;
    b[7] = flags & 0xff;
  }
  return b;
};

export const encodeEnd = (crc32: number): Uint8Array => {
  const b = new Uint8Array(5);
  b[0] = Cmd.END;
  new DataView(b.buffer).setUint32(1, crc32 >>> 0, true);
  return b;
};

/** SHOW the current picture, or (fw 0.6+) a stored slot, which then becomes current. */
export const encodeShow = (slot?: number) =>
  slot === undefined ? Uint8Array.of(Cmd.SHOW) : Uint8Array.of(Cmd.SHOW, slot & 0xff);
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

const withU32 = (op: number, value: number) => {
  const b = new Uint8Array(5);
  b[0] = op;
  new DataView(b.buffer).setUint32(1, value >>> 0, true);
  return b;
};
export const encodeUpdateBegin = (size: number) => withU32(Cmd.UPDATE_BEGIN, size);
export const encodeUpdateEnd = (crc32: number) => withU32(Cmd.UPDATE_END, crc32);
export const encodeDelete = (slot: number) => Uint8Array.of(Cmd.DELETE, slot & 0xff);
export const encodeSlot = (slot: number) => Uint8Array.of(Cmd.SLOT, slot & 0xff);

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
  /** undefined: firmware older than 0.6, which keeps one picture. */
  slots?: SlotsState;
  /** undefined: firmware older than 0.6, which can't update over Bluetooth. */
  update?: UpdateState;
}

export interface SlotsState {
  count: number;
  /** Bit n set: slot n holds a picture. */
  usedMask: number;
  /** The slot on the panel, or null. */
  current: number | null;
}

export interface UpdateState {
  /** Which of the two app slots the firmware runs from (it alternates with each update). */
  runningSlot: 0 | 1;
  /** An update failed to start, and the badge went back to the firmware before it. */
  rolledBack: boolean;
  /** Largest firmware image the badge accepts, bytes. */
  maxFirmware: number;
  /** Chip id (Chip.*). Firmware 0.6.0 doesn't say; every 0.6.0 badge is an ESP32-C3. */
  chip: number;
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
  // fw 0.6: slots (22..24), update flags (25), largest firmware (26..29); 0.6.1: chip (30).
  if (data.length >= 30) {
    info.slots = { count: data[22], usedMask: data[23], current: data[24] === 0xff ? null : data[24] };
    info.update = {
      runningSlot: data[25] & UPDATE_RUNNING_SLOT1 ? 1 : 0,
      rolledBack: (data[25] & UPDATE_ROLLED_BACK) !== 0,
      maxFirmware: v.getUint32(26, true),
      chip: data.length >= 31 ? data[30] : Chip.ESP32C3,
    };
  }
  return info;
}

/** What one picture slot holds (the SLOT event, fw 0.6+). */
export interface SlotInfo {
  slot: number;
  used: boolean;
  format: number;
  length: number;
  /** CRC-32 of the stored frame: the same number as a library item's crc32. */
  crc32: number;
}

export function parseSlot(data: Uint8Array): SlotInfo {
  if (data.length < 13 || data[0] !== Evt.SLOT) throw new Error(`malformed SLOT (${data.length} bytes)`);
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    slot: data[2],
    used: data[3] !== 0,
    format: data[4],
    length: v.getUint32(5, true),
    crc32: v.getUint32(9, true),
  };
}

/** Slot numbers in use, from INFO's mask. */
export const usedSlots = (s: SlotsState): number[] =>
  Array.from({ length: s.count }, (_, i) => i).filter((i) => (s.usedMask >> i) & 1);

export const supportsSlots = (info: TagInfo) => info.slots !== undefined && info.slots.count > 0;

/** false: the panel didn't answer at boot (wiring). undefined: firmware can't tell. */
export function panelAnswering(info: TagInfo): boolean | undefined {
  const id = info.panelId;
  if (!id) return undefined;
  const all = (x: number) => id.every((b) => b === x);
  return !(all(0xff) || all(0x00));
}

export const supportsTemp = (info: TagInfo) => info.tempOverride !== undefined;
export const supportsLock = (info: TagInfo) => info.lock !== undefined;
export const supportsUpdate = (info: TagInfo) => info.update !== undefined;

// ---------------------------------------------------------------- logging

const hex = (data: Uint8Array) =>
  Array.from(data, (b) => b.toString(16).padStart(2, '0')).join(' ');
const tempStr = (t: number | null | undefined) => (t == null ? 'unknown' : `${t} °C`);

export function describeCommand(data: Uint8Array): string {
  const name = COMMAND_NAMES[data[0]] ?? `0x${data[0]?.toString(16)}`;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data[0] === Cmd.BEGIN && data.length >= 8)
    return `${name} format ${data[1]}, ${v.getUint32(2, true)} bytes, slot ${data[6]}${data[7] & BEGIN_SHOW ? '' : ' (store only)'}`;
  if (data[0] === Cmd.BEGIN && data.length >= 6)
    return `${name} format ${data[1]}, ${v.getUint32(2, true)} bytes`;
  if (data[0] === Cmd.SHOW && data.length >= 2) return `${name} slot ${data[1]}`;
  if (data[0] === Cmd.END && data.length >= 5)
    return `${name} crc32 ${v.getUint32(1, true).toString(16).padStart(8, '0')}`;
  if (data[0] === Cmd.CLEAR && data.length >= 2) return `${name} ${data[1]}`;
  if (data[0] === Cmd.UPDATE_BEGIN && data.length >= 5) return `${name} ${v.getUint32(1, true)} bytes`;
  if (data[0] === Cmd.UPDATE_END && data.length >= 5)
    return `${name} crc32 ${v.getUint32(1, true).toString(16).padStart(8, '0')}`;
  if ((data[0] === Cmd.DELETE || data[0] === Cmd.SLOT) && data.length >= 2) return `${name} ${data[1]}`;
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
  if (data[0] === Evt.SLOT && data.length >= 13) {
    const s = parseSlot(data);
    return s.used ? `${name} ${s.slot}: ${s.length} bytes, crc32 ${s.crc32.toString(16).padStart(8, '0')}` : `${name} ${s.slot}: empty`;
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
    if (i.update)
      s += `, ${CHIP_NAMES[i.update.chip] ?? `chip ${i.update.chip}`} app slot ${i.update.runningSlot}${i.update.rolledBack ? ' (rolled back)' : ''}`;
    return s;
  }
  return name;
}

export const displayedTemperature = (data: Uint8Array): number | null => {
  if (data.length < 3) return null;
  const t = i8(data[2]);
  return t === TEMP_UNKNOWN ? null : t;
};
