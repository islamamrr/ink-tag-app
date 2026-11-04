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
  encodeBegin,
  encodeClear,
  encodeEnd,
  encodeInfo,
  encodeShow,
  encodeTemp,
  parseInfo,
  type TagInfo,
} from './codec';
import {
  ErrorCode,
  Evt,
  EVENT_NAMES,
  FMT_NATIVE_4BPP,
  MAX_ATTR_LEN,
  PROTOCOL_VERSION,
} from './constants';
import { crc32 } from './crc32';
import {
  CancelledError,
  DisconnectedError,
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
}

export type DisplayOutcome =
  | { status: 'displayed'; temperature: number | null }
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

  /** Redraws the stored image. Resolves with the panel temperature. */
  show(): Promise<number | null> {
    return this.exclusive(async () => {
      await this.send(encodeShow());
      return this.displayedOrThrow();
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
    await this.beginWithRetry(frame.length, signal);
    onBegan();
    onStage?.('sending', attempt);

    const chunk = Math.max(20, Math.min(MAX_ATTR_LEN, this.link.mtu - 3));
    this.log(
      'info',
      `sending ${frame.length} bytes in ${chunk}-byte chunks (MTU ${this.link.mtu})`,
    );
    const t0 = Date.now();
    for (let i = 0, off = 0; off < frame.length; i++, off += chunk) {
      if (signal?.aborted) {
        await this.abort().catch(() => {});
        throw new CancelledError();
      }
      if (this.disconnected) throw new DisconnectedError();
      await this.link.writeData(
        frame.subarray(off, off + chunk),
        safe || i % ackEvery === ackEvery - 1,
      );
      onProgress?.(Math.min(off + chunk, frame.length), frame.length);
    }
    const sendSeconds = Math.max((Date.now() - t0) / 1000, 1e-3);
    const bytesPerSecond = frame.length / sendSeconds;
    this.log(
      'info',
      `sent in ${sendSeconds.toFixed(1)} s (${(bytesPerSecond / 1024).toFixed(1)} KiB/s)`,
    );

    onStage?.('verifying', attempt);
    await this.send(encodeEnd(crc32(frame)));
    await this.expect(Evt.RECEIVED, this.timeouts.received, signal);
    return { sendSeconds, bytesPerSecond, chunkSize: chunk };
  }

  /** BEGIN; on "bad state" (a stale upload on the badge) ABORT and try once more. */
  private async beginWithRetry(length: number, signal?: AbortSignal) {
    for (let retried = false; ; retried = true) {
      await this.send(encodeBegin(length, FMT_NATIVE_4BPP));
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
