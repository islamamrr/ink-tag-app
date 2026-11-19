// High-level badge commands over any Link. Port of devtool/protocol.py
// (TagClient) with the rules from the app plan: one command at a time,
// typed errors, CRC and bad-state retries, and RECEIVED as upload success.

import type { Link, Unsubscribe } from '../transport/link';
import { Mutex } from '../util/async';
import {
  describeCommand,
  describeEvent,
  displayedTemperature,
  encodeAbort,
  encodeAuthAnswer,
  encodeAuthRequest,
  encodeBegin,
  encodeClear,
  encodeDelete,
  encodeEnd,
  encodeInfo,
  encodeLock,
  encodeShow,
  encodeSlot,
  encodeTemp,
  encodeUnlock,
  encodeUpdateBegin,
  encodeUpdateEnd,
  parseInfo,
  parseSlot,
  type SlotInfo,
  type TagInfo,
} from './codec';
import {
  BEGIN_SHOW,
  ErrorCode,
  Evt,
  EVENT_NAMES,
  FMT_NATIVE_4BPP,
  LOCK_KEY_BYTES,
  MAX_ATTR_LEN,
  PROTOCOL_VERSION,
} from './constants';
import { crc32 } from './crc32';
import { hmacSha256 } from '../util/sha256';
import {
  CancelledError,
  DisconnectedError,
  LockedError,
  TagError,
  TimeoutError,
  UnsupportedProtocolError,
  UploadError,
} from './errors';

export type LogKind = 'tx' | 'rx' | 'info' | 'error';
export type Log = (kind: LogKind, text: string) => void;

export interface Timeouts {
  info: number;
  ready: number;
  received: number;
  displayed: number;
  /** Erasing the update slot (READY) and checking the image (UPDATED). Default 60 s each. */
  update?: number;
}

/** Milliseconds. DISPLAYED can take tens of seconds, longer in the cold. */
export const DEFAULT_TIMEOUTS: Timeouts = {
  info: 5_000,
  ready: 15_000,
  received: 15_000,
  displayed: 150_000,
};

/** Where an upload is: erasing the badge's storage, streaming, or waiting for the CRC check. */
export type UploadStage = 'erasing' | 'sending' | 'verifying';

export interface UploadOptions {
  onProgress?: (sent: number, total: number) => void;
  /** Called as the upload moves between stages; again from 'erasing' on a retry. */
  onStage?: (stage: UploadStage, attempt: number) => void;
  signal?: AbortSignal;
  /** Ask for a write response every N chunks so the phone's queue can't run far ahead. */
  ackEvery?: number;
  /** Write with response on every chunk. Used automatically to retry a CRC mismatch. */
  safe?: boolean;
  /** Firmware 0.6+: the picture slot to store it in. Absent: it replaces the current picture. */
  slot?: number;
  /** With a slot: draw it once stored (default), or only store it. */
  draw?: boolean;
}

/** Where a firmware update is. After 'restarting' the badge drops the connection. */
export type UpdateStage = 'erasing' | 'sending' | 'installing' | 'restarting';

export interface FirmwareUpdateOptions {
  onProgress?: (sent: number, total: number) => void;
  onStage?: (stage: UpdateStage, attempt: number) => void;
  signal?: AbortSignal;
  ackEvery?: number;
}

export type DisplayOutcome =
  | { status: 'displayed'; temperature: number | null }
  /** Stored in a slot without drawing (fw 0.6+): nothing changed on the screen. */
  | { status: 'stored' }
  | { status: 'failed'; error: TagError }
  | { status: 'unknown'; reason: 'timeout' | 'disconnected' };

export interface UploadResult {
  /** Seconds spent streaming the frame (last attempt). */
  sendSeconds: number;
  bytesPerSecond: number;
  chunkSize: number;
  /** Attempts made, 2 if a CRC mismatch was retried in safe mode. */
  attempts: number;
  /**
   * Settles when the refresh finishes, fails, or can no longer be observed.
   * Never rejects. The picture is already stored when upload() resolves.
   */
  displayed: Promise<DisplayOutcome>;
}

export class TagClient {
  private readonly mutex = new Mutex();
  private readonly unsubs: Unsubscribe[];
  /** Notifications not yet claimed by expect(), cleared before each command. */
  private inbox: Uint8Array[] = [];
  private wake: (() => void) | null = null;
  private disconnected = false;

  constructor(
    readonly link: Link,
    private readonly log: Log = () => {},
    private readonly timeouts: Timeouts = DEFAULT_TIMEOUTS,
  ) {
    this.unsubs = [
      link.onNotify((data) => {
        this.log('rx', describeEvent(data));
        this.inbox.push(data);
        this.wake?.();
      }),
      link.onDisconnect(() => {
        this.disconnected = true;
        this.log('error', 'disconnected');
        this.wake?.();
      }),
    ];
  }

  get connected() {
    return !this.disconnected && this.link.connected;
  }

  async close() {
    this.unsubs.forEach((u) => u());
    // Anything still waiting (a refresh, a reply) ends now as "disconnected",
    // instead of waiting out its timeout with nobody listening.
    this.disconnected = true;
    this.wake?.();
    await this.link.close();
  }

  // ------------------------------------------------------------ low level

  private async send(payload: Uint8Array) {
    if (!this.connected) throw new DisconnectedError();
    this.inbox = [];
    this.log('tx', describeCommand(payload));
    await this.link.writeControl(payload);
  }

  /** Waits for `event`. ERROR rejects with TagError; other events are skipped. */
  private async expect(event: number, timeoutMs: number, signal?: AbortSignal) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const msg = this.inbox.shift();
      if (msg) {
        if (msg[0] === Evt.ERROR) throw new TagError(msg[1], msg[2]);
        if (msg[0] === event) return msg;
        this.log(
          'info',
          `ignoring ${EVENT_NAMES[msg[0]] ?? msg[0]} while waiting for ${EVENT_NAMES[event]}`,
        );
        continue;
      }
      if (this.disconnected) throw new DisconnectedError();
      if (signal?.aborted) throw new CancelledError();
      const left = deadline - Date.now();
      if (left <= 0) throw new TimeoutError(EVENT_NAMES[event] ?? 'reply', timeoutMs);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, left);
        const onAbort = () => done();
        signal?.addEventListener('abort', onAbort);
        function done() {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }
        this.wake = done;
      });
      this.wake = null;
    }
  }

  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.mutex.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async waitDisplayed(): Promise<DisplayOutcome> {
    this.log('info', 'panel refreshing (a six-color refresh takes a while)...');
    try {
      const m = await this.expect(Evt.DISPLAYED, this.timeouts.displayed);
      return { status: 'displayed', temperature: displayedTemperature(m) };
    } catch (e) {
      if (e instanceof TagError) return { status: 'failed', error: e };
      if (e instanceof DisconnectedError) return { status: 'unknown', reason: 'disconnected' };
      if (e instanceof TimeoutError) return { status: 'unknown', reason: 'timeout' };
      throw e;
    }
  }

  private async displayedOrThrow(): Promise<number | null> {
    const r = await this.waitDisplayed();
    if (r.status === 'displayed') return r.temperature;
    if (r.status === 'failed') throw r.error;
    if (r.status === 'stored') return null; // never from waitDisplayed
    throw r.reason === 'disconnected'
      ? new DisconnectedError()
      : new TimeoutError('DISPLAYED', this.timeouts.displayed);
  }

  // ------------------------------------------------------------ commands

  info(): Promise<TagInfo> {
    return this.exclusive(async () => {
      await this.send(encodeInfo());
      return parseInfo(await this.expect(Evt.INFO, this.timeouts.info));
    });
  }

  /** INFO, refusing badges that speak another protocol version. Call once after connecting. */
  async hello(): Promise<TagInfo> {
    const info = await this.info();
    if (info.protocol !== PROTOCOL_VERSION) throw new UnsupportedProtocolError(info.protocol);
    return info;
  }

  /**
   * Redraws the stored image, or (fw 0.6+) draws a stored slot and makes it
   * current. Resolves with the panel temperature.
   */
  show(slot?: number): Promise<number | null> {
    return this.exclusive(async () => {
      await this.send(encodeShow(slot));
      return this.displayedOrThrow();
    });
  }

  // ------------------------------------------------------------ picture slots (fw 0.6+)

  /** What a slot holds: whether it's used, and the length and CRC-32 of its picture. */
  slot(slot: number): Promise<SlotInfo> {
    return this.exclusive(async () => {
      await this.send(encodeSlot(slot));
      return parseSlot(await this.expect(Evt.SLOT, this.timeouts.info));
    });
  }

  /** Empties a slot. The screen keeps what it shows. Resolves with INFO. */
  deleteSlot(slot: number): Promise<TagInfo> {
    return this.exclusive(async () => {
      await this.send(encodeDelete(slot));
      return parseInfo(await this.expect(Evt.INFO, this.timeouts.info));
    });
  }

  /** Fills the panel with one color; the stored image is kept. */
  clear(color: number): Promise<number | null> {
    return this.exclusive(async () => {
      await this.send(encodeClear(color));
      return this.displayedOrThrow();
    });
  }

  /** Fixed refresh temperature, or null to read the panel again. Firmware 0.2+. */
  setTempOverride(celsius: number | null): Promise<TagInfo> {
    return this.exclusive(async () => {
      await this.send(encodeTemp(celsius));
      return parseInfo(await this.expect(Evt.INFO, this.timeouts.info));
    });
  }

  // ------------------------------------------------------------ lock (fw 0.4+)

  /**
   * Locks the badge to `key` (16 random bytes the phone keeps). Allowed on an
   * unlocked badge, or once this connection is authorized (to change the key).
   */
  lock(key: Uint8Array): Promise<TagInfo> {
    return this.exclusive(async () => {
      await this.send(encodeLock(key));
      return parseInfo(await this.expect(Evt.INFO, this.timeouts.info));
    });
  }

  /**
   * Proves this phone holds the owner key: the badge sends a fresh nonce, the
   * phone answers with the first 16 bytes of HMAC-SHA-256(key, nonce). The key
   * itself never goes over the air. Rejects with LockedError on a wrong key.
   */
  authenticate(key: Uint8Array): Promise<TagInfo> {
    return this.exclusive(async () => {
      await this.send(encodeAuthRequest());
      const ch = await this.expect(Evt.CHALLENGE, this.timeouts.info);
      const nonce = ch.subarray(2, 2 + LOCK_KEY_BYTES);
      if (nonce.length !== LOCK_KEY_BYTES) throw new Error('malformed CHALLENGE');
      await this.send(encodeAuthAnswer(lockAnswer(key, nonce)));
      try {
        return parseInfo(await this.expect(Evt.INFO, this.timeouts.info));
      } catch (e) {
        if (e instanceof TagError && e.code === ErrorCode.LOCKED) throw new LockedError();
        throw e;
      }
    });
  }

  /** Forgets the owner key, so any phone can use the badge. Needs an authorized connection. */
  unlock(): Promise<TagInfo> {
    return this.exclusive(async () => {
      await this.send(encodeUnlock());
      return parseInfo(await this.expect(Evt.INFO, this.timeouts.info));
    });
  }

  /** Cancels an upload in progress. The badge doesn't reply. */
  async abort() {
    if (this.connected) {
      this.log('tx', describeCommand(encodeAbort()));
      await this.link.writeControl(encodeAbort());
    }
  }

  /**
   * Sends a native 4 bpp frame. Resolves once the badge has checked the CRC
   * and stored it (RECEIVED); `displayed` follows when the refresh ends.
   * Rejects with UploadError, whose badgeBlank says if the old image is gone.
   */
  async upload(frame: Uint8Array, opts: UploadOptions = {}): Promise<UploadResult> {
    const release = await this.mutex.acquire();
    let began = false;
    try {
      let attempts = 0;
      let safe = opts.safe ?? false;
      let stats: Omit<UploadResult, 'displayed' | 'attempts'>;
      for (;;) {
        attempts++;
        try {
          stats = await this.uploadOnce(frame, safe, opts, attempts, () => (began = true));
          break;
        } catch (e) {
          // A chunk written without response can be lost on the way: the badge
          // then reports a short upload (bad length) or, if bytes got mangled,
          // a CRC mismatch. Either way, retry once with a response on every write.
          const lost =
            e instanceof TagError && (e.code === ErrorCode.CRC || e.code === ErrorCode.BAD_LENGTH);
          // The phone's Bluetooth stack can also refuse a fast write outright
          // (Android: "Operation was rejected") while the link stays up.
          const refused =
            !(e instanceof TagError) &&
            !(e instanceof CancelledError) &&
            !(e instanceof DisconnectedError) &&
            !(e instanceof TimeoutError) &&
            this.connected;
          if ((lost || refused) && !safe && opts.signal?.aborted !== true) {
            const why = e instanceof Error ? e.message : String(e);
            this.log('error', `${why}, retrying with a response on every write`);
            safe = true;
            continue;
          }
          throw e;
        }
      }
      if (opts.slot !== undefined && opts.draw === false) {
        // Stored only: the badge answers SLOT instead of drawing.
        try {
          await this.expect(Evt.SLOT, this.timeouts.info);
        } catch (e) {
          if (!(e instanceof TimeoutError)) throw e;
          this.log('info', 'no SLOT after a store-only upload; it was stored at RECEIVED');
        }
        release();
        return { ...stats, attempts, displayed: Promise.resolve({ status: 'stored' as const }) };
      }
      const displayed = this.waitDisplayed().finally(release);
      return { ...stats, attempts, displayed };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      // A failed upload leaves the badge waiting for data, and it refuses
      // SHOW and CLEAR until it gets ABORT (or reboots). Tell it, if we still can.
      if (began && this.connected && !(e instanceof TagError)) await this.abort().catch(() => {});
      release();
      this.log('error', `upload failed: ${err.message}`);
      throw new UploadError(err, began);
    }
  }

  private async uploadOnce(
    frame: Uint8Array,
    safe: boolean,
    opts: UploadOptions,
    attempt: number,
    onBegan: () => void,
  ) {
    const { signal, onProgress, onStage, ackEvery = 32 } = opts;
    onStage?.('erasing', attempt);
    await this.beginWithRetry(frame.length, signal, opts.slot, opts.draw === false ? 0 : BEGIN_SHOW);
    onBegan();
    onStage?.('sending', attempt);

    const stats = await this.streamData(frame, safe, signal, onProgress, ackEvery);

    onStage?.('verifying', attempt);
    await this.send(encodeEnd(crc32(frame)));
    await this.expect(Evt.RECEIVED, this.timeouts.received, signal);
    return stats;
  }

  /** Writes `data` to the Data characteristic in MTU-sized chunks. */
  private async streamData(
    data: Uint8Array,
    safe: boolean,
    signal: AbortSignal | undefined,
    onProgress: ((sent: number, total: number) => void) | undefined,
    ackEvery: number,
  ) {
    const chunk = Math.max(20, Math.min(MAX_ATTR_LEN, this.link.mtu - 3));
    this.log('info', `sending ${data.length} bytes in ${chunk}-byte chunks (MTU ${this.link.mtu})`);
    const t0 = Date.now();
    for (let i = 0, off = 0; off < data.length; i++, off += chunk) {
      if (signal?.aborted) {
        await this.abort().catch(() => {});
        throw new CancelledError();
      }
      if (this.disconnected) throw new DisconnectedError();
      await this.link.writeData(data.subarray(off, off + chunk), safe || i % ackEvery === ackEvery - 1);
      onProgress?.(Math.min(off + chunk, data.length), data.length);
    }
    const sendSeconds = Math.max((Date.now() - t0) / 1000, 1e-3);
    const bytesPerSecond = data.length / sendSeconds;
    this.log('info', `sent in ${sendSeconds.toFixed(1)} s (${(bytesPerSecond / 1024).toFixed(1)} KiB/s)`);
    return { sendSeconds, bytesPerSecond, chunkSize: chunk };
  }

  // ------------------------------------------------------------ firmware update (fw 0.6+)

  /**
   * Installs a firmware app image. Resolves when the badge has checked it and
   * answered UPDATED; it restarts into the new firmware half a second later,
   * so the connection drops. A failure before that leaves the badge running
   * its old firmware. Needs an authorized connection on a locked badge.
   */
  updateFirmware(image: Uint8Array, opts: FirmwareUpdateOptions = {}): Promise<void> {
    return this.exclusive(async () => {
      let safe = false;
      let began = false;
      for (let attempt = 1; ; attempt++) {
        try {
          await this.updateOnce(image, safe, opts, attempt, () => (began = true));
          return;
        } catch (e) {
          const lost =
            e instanceof TagError && (e.code === ErrorCode.CRC || e.code === ErrorCode.BAD_LENGTH);
          const refused =
            !(e instanceof TagError) &&
            !(e instanceof CancelledError) &&
            !(e instanceof DisconnectedError) &&
            !(e instanceof TimeoutError) &&
            this.connected;
          if ((lost || refused) && !safe && opts.signal?.aborted !== true) {
            this.log('error', `${e instanceof Error ? e.message : String(e)}, retrying with a response on every write`);
            safe = true;
            continue;
          }
          // The badge drops a half-written update on ABORT (or on disconnect).
          if (began && this.connected && !(e instanceof TagError)) await this.abort().catch(() => {});
          this.log('error', `firmware update failed: ${e instanceof Error ? e.message : String(e)}`);
          throw e;
        }
      }
    });
  }

  private async updateOnce(
    image: Uint8Array,
    safe: boolean,
    opts: FirmwareUpdateOptions,
    attempt: number,
    onBegan: () => void,
  ) {
    const { signal, onProgress, onStage, ackEvery = 32 } = opts;
    const wait = this.timeouts.update ?? 60_000;
    onStage?.('erasing', attempt);
    await this.send(encodeUpdateBegin(image.length));
    await this.expect(Evt.READY, wait, signal);
    onBegan();
    onStage?.('sending', attempt);
    await this.streamData(image, safe, signal, onProgress, ackEvery);
    onStage?.('installing', attempt);
    await this.send(encodeUpdateEnd(crc32(image)));
    await this.expect(Evt.UPDATED, wait, signal);
    onStage?.('restarting', attempt);
  }

  /** BEGIN; on "bad state" (a stale upload on the badge) ABORT and try once more. */
  private async beginWithRetry(length: number, signal?: AbortSignal, slot?: number, flags = BEGIN_SHOW) {
    for (let retried = false; ; retried = true) {
      await this.send(encodeBegin(length, FMT_NATIVE_4BPP, slot, flags));
      try {
        await this.expect(Evt.READY, this.timeouts.ready, signal);
        return;
      } catch (e) {
        if (e instanceof TagError && e.code === ErrorCode.BAD_STATE && !retried) {
          this.log('info', 'badge busy with an old upload, aborting it');
          await this.abort();
          continue;
        }
        throw e;
      }
    }
  }
}

/** The AUTH answer: HMAC-SHA-256(key, nonce), first 16 bytes. Same on the badge. */
export const lockAnswer = (key: Uint8Array, nonce: Uint8Array) =>
  hmacSha256(key, nonce).subarray(0, LOCK_KEY_BYTES);
