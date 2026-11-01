// Ink Tag BLE protocol v1. Mirrors firmware/main/protocol.h and
// firmware/docs/PROTOCOL.md; keep the three in step.

export const PROTOCOL_VERSION = 1;

const uuid = (short: number) =>
  `b5a1${short.toString(16).padStart(4, '0')}-6e6b-4a7a-9c3e-1f2a3b4c5d6e`;

export const UUID_SERVICE = uuid(0x0000);
export const UUID_CONTROL = uuid(0x0001); // write, notify
export const UUID_DATA = uuid(0x0002); // write, write without response

// The panel in controller scan order (landscape). The badge hangs in portrait.
export const PANEL_WIDTH = 792;
export const PANEL_HEIGHT = 528;
export const FRAME_BYTES = (PANEL_WIDTH * PANEL_HEIGHT) / 2; // 209,088

/**
 * Largest value one GATT write may carry (Bluetooth Core spec, Vol 3 Part F
 * 3.2.9). Android refuses longer writes outright, and NimBLE on the badge
 * would reject them too, so chunks are capped here even when MTU − 3 is
 * larger (MTU 517 would allow 514).
 */
export const MAX_ATTR_LEN = 512;

export const FMT_NATIVE_4BPP = 0x01;

export const Cmd = {
  BEGIN: 0x01, // u8 format, u32 length
  END: 0x02, // u32 crc32
  SHOW: 0x03,
  CLEAR: 0x04, // u8 color
  INFO: 0x05,
  ABORT: 0x06,
  TEMP: 0x07, // i8 °C, or TEMP_UNKNOWN to read the panel (fw 0.2+)
} as const;
export type CmdCode = (typeof Cmd)[keyof typeof Cmd];

export const Evt = {
  READY: 0x81,
  RECEIVED: 0x82,
  DISPLAYED: 0x83, // i8 panel temperature
  INFO: 0x84,
  ERROR: 0x8f, // status = error code, then u8 failing opcode
} as const;
export type EvtCode = (typeof Evt)[keyof typeof Evt];

export const ErrorCode = {
  BAD_COMMAND: 1,
  BAD_LENGTH: 2,
  BAD_STATE: 3,
  OVERFLOW: 4,
  CRC: 5,
  FLASH: 6,
  PANEL_TIMEOUT: 7,
  NO_IMAGE: 8,
  BAD_FORMAT: 9,
} as const;

export const ERROR_NAMES: Record<number, string> = {
  1: 'bad command',
  2: 'bad length',
  3: 'bad state',
  4: 'overflow',
  5: 'CRC mismatch',
  6: 'flash error',
  7: 'panel timeout',
  8: 'no stored image',
  9: 'bad format',
};

export const COMMAND_NAMES: Record<number, string> = {
  [Cmd.BEGIN]: 'BEGIN',
  [Cmd.END]: 'END',
  [Cmd.SHOW]: 'SHOW',
  [Cmd.CLEAR]: 'CLEAR',
  [Cmd.INFO]: 'INFO',
  [Cmd.ABORT]: 'ABORT',
  [Cmd.TEMP]: 'TEMP',
};

export const EVENT_NAMES: Record<number, string> = {
  [Evt.READY]: 'READY',
  [Evt.RECEIVED]: 'RECEIVED',
  [Evt.DISPLAYED]: 'DISPLAYED',
  [Evt.INFO]: 'INFO',
  [Evt.ERROR]: 'ERROR',
};

/** Pixel values the panel understands. Anything else draws as white. */
export const Color = {
  black: 0,
  white: 1,
  yellow: 2,
  red: 3,
  blue: 5,
  green: 6,
} as const;
export type ColorName = keyof typeof Color;

/** "No temperature": unknown in INFO, "read the panel" in TEMP. */
export const TEMP_UNKNOWN = -128;
export const TEMP_MIN = -20;
export const TEMP_MAX = 60;
