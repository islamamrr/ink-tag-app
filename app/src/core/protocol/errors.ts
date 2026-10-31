import { COMMAND_NAMES, ERROR_NAMES, ErrorCode } from './constants';

/** The badge answered a command with ERROR. */
export class TagError extends Error {
  constructor(
    readonly code: number,
    readonly command: number | undefined,
  ) {
    const cmd = command === undefined ? '?' : (COMMAND_NAMES[command] ?? String(command));
    super(`${ERROR_NAMES[code] ?? `error ${code}`} (command ${cmd})`);
    this.name = 'TagError';
  }
}

export class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`no ${what} from the badge within ${Math.round(ms / 1000)} s`);
    this.name = 'TimeoutError';
  }
}

export class DisconnectedError extends Error {
  constructor() {
    super('the badge disconnected');
    this.name = 'DisconnectedError';
  }
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

export class UnsupportedProtocolError extends Error {
  constructor(readonly protocol: number) {
    super(`badge speaks protocol v${protocol}; this app needs v1. Update the app.`);
    this.name = 'UnsupportedProtocolError';
  }
}

export type BluetoothProblem =
  | 'off'
  | 'unauthorized'
  | 'unsupported'
  | 'permission'
  | 'no-native-module'
  | 'not-found'
  | 'connect-failed'
  | 'not-a-badge';

/** Bluetooth itself is in the way: off, not allowed, missing, or the badge can't be reached. */
export class BluetoothError extends Error {
  constructor(
    readonly problem: BluetoothProblem,
    detail?: string,
  ) {
    super(detail ? `Bluetooth: ${problem} (${detail})` : `Bluetooth: ${problem}`);
    this.name = 'BluetoothError';
  }
}

/**
 * An upload failed. badgeBlank is true once BEGIN was accepted: the firmware
 * erased the stored image then, so the badge has nothing to show until a
 * new upload succeeds.
 */
export class UploadError extends Error {
  constructor(
    readonly cause: Error,
    readonly badgeBlank: boolean,
  ) {
    super(cause.message);
    this.name = 'UploadError';
  }
}

/** One plain sentence per failure, for the person holding the phone. */
export function userMessage(e: unknown): string {
  const err = e instanceof UploadError ? e.cause : e;
  let msg: string;
  if (err instanceof TagError) {
    msg =
      {
        [ErrorCode.BAD_COMMAND]: 'The badge firmware does not support this. Update the badge.',
        [ErrorCode.BAD_LENGTH]: 'The picture was the wrong size for this badge.',
        [ErrorCode.BAD_STATE]: 'The badge was busy with another transfer. Try again.',
        [ErrorCode.OVERFLOW]: 'The badge received more data than expected. Try again.',
        [ErrorCode.CRC]: 'The picture was damaged on the way. Try again closer to the badge.',
        [ErrorCode.FLASH]: "The badge couldn't save the picture (storage error).",
        [ErrorCode.PANEL_TIMEOUT]: "The badge's screen didn't respond. Check the display connection.",
        [ErrorCode.NO_IMAGE]: 'The badge has no stored picture yet.',
        [ErrorCode.BAD_FORMAT]: "The badge doesn't understand this picture format.",
      }[err.code] ?? `The badge reported ${err.message}.`;
  } else if (err instanceof TimeoutError) {
    msg = 'The badge stopped answering. Move closer and try again.';
  } else if (err instanceof DisconnectedError) {
    msg = 'The connection to the badge dropped.';
  } else if (err instanceof BluetoothError) {
    msg = {
      off: 'Bluetooth is off. Turn it on and try again.',
      unauthorized: 'Ink Tag is not allowed to use Bluetooth. Allow it in Settings.',
      permission: 'Ink Tag needs the Nearby devices permission to find your badge.',
      unsupported: "This phone doesn't support Bluetooth LE.",
      'no-native-module':
        'Bluetooth needs the Ink Tag development build; it does not work in Expo Go.',
      'not-found': 'No badge found. Make sure it is on and close to the phone.',
      'connect-failed': "Couldn't connect to the badge. Move closer and try again.",
      'not-a-badge': "That device isn't an Ink Tag badge.",
    }[err.problem];
  } else if (err instanceof CancelledError) {
    msg = 'Cancelled.';
  } else {
    msg = err instanceof Error ? err.message : String(err);
  }
  if (e instanceof UploadError && e.badgeBlank)
    msg += ' The badge is blank until you send a picture again.';
  return msg;
}
