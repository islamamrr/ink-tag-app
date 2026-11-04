// A simulated badge that speaks the same protocol as the firmware. Port of
// devtool/inktag_devtool/fake_device.py, which follows firmware/main/main.c:
// one command at a time (commands sent during a refresh wait), BEGIN erases
// then notifies READY, data outside an upload is dropped, END checks length
// and CRC, then RECEIVED, a refresh, and DISPLAYED.

import { lockAnswer } from '../protocol/client';
import { crc32 } from '../protocol/crc32';
import {
  Cmd,
  Evt,
  FMT_NATIVE_4BPP,
  FRAME_BYTES,
  LOCK_KEY_BYTES,
  PANEL_HEIGHT,
  PANEL_WIDTH,
  PROTOCOL_VERSION,
  TEMP_UNKNOWN,
} from '../protocol/constants';
import { sleep } from '../util/async';

export type Timing = 'instant' | 'fast' | 'realistic';

const DELAYS: Record<Timing, { erase: number; refresh: number; coldRefresh: number }> = {
  instant: { erase: 0, refresh: 5, coldRefresh: 5 },
  fast: { erase: 600, refresh: 3_000, coldRefresh: 3_000 },
  realistic: { erase: 2_000, refresh: 30_000, coldRefresh: 45_000 },
};

export interface FakeTagOptions {
  timing?: Timing;
  firmware?: [number, number, number];
  /** Made up: the UC8279E's real answer is unknown. */
  panelId?: Uint8Array;
  sensorTemp?: number;
  mtu?: number;
  log?: (line: string) => void;
}

export class FakeTag {
  timing: Timing;
  firmware: [number, number, number];
  panelId: Uint8Array;
  sensorTemp: number;
  mtu: number;
  log: (line: string) => void;
  /** Called with the frame the panel now shows. */
  onDisplay: ((frame: Uint8Array) => void) | null = null;

  // Fault injection
  /** Flip one byte of the next upload, so END fails with CRC mismatch. */
  corruptNextUpload = false;
  /** Fail the next refresh with "panel timeout", as a badge without a panel does. */
  failNextRefresh = false;

  /** Owner key (fw 0.4+), kept across connections like the badge's NVS. */
  ownerKey: Uint8Array | null = null;
  /** This connection answered a CHALLENGE correctly. Reset on disconnect. */
  authorized = false;
  private nonce: Uint8Array | null = null;

  stored: Uint8Array | null = null;
  shown: Uint8Array | null = null;
  tempOverride = TEMP_UNKNOWN;
  lastTemp = TEMP_UNKNOWN;
  receiving = false;
  private buf = new Uint8Array(FRAME_BYTES);
  private received = 0;
  private overflow = false;

  constructor(opts: FakeTagOptions = {}) {
    this.timing = opts.timing ?? 'fast';
    this.firmware = opts.firmware ?? [0, 4, 0];
    this.panelId = opts.panelId ?? Uint8Array.of(0x00, 0x00, 0x66);
    this.sensorTemp = opts.sensorTemp ?? 22;
    this.mtu = opts.mtu ?? 247;
    this.log = opts.log ?? (() => {});
  }

  private atLeast(major: number, minor: number) {
    const [ma, mi] = this.firmware;
    return ma > major || (ma === major && mi >= minor);
  }

  private readTemp() {
    if (this.tempOverride !== TEMP_UNKNOWN) {
      this.log(`W epd: temperature override: ${this.tempOverride} C`);
      return this.tempOverride;
    }
    const t = this.sensorTemp + [-1, 0, 0, 1][Math.floor(Math.random() * 4)];
    this.log(`I epd: temperature byte 0x${(t & 0xff).toString(16).padStart(2, '0')}`);
    return t;
  }

  /** Returns false if the refresh failed (panel timeout). */
  private async refresh(frame: Uint8Array): Promise<boolean> {
    this.lastTemp = this.readTemp();
    const d = DELAYS[this.timing];
    const ms = this.lastTemp >= 10 ? d.refresh : d.coldRefresh;
    this.log(`I epd: panel ${this.lastTemp} C, refreshing (${ms / 1000} s simulated)`);
    await sleep(ms);
    if (this.failNextRefresh) {
      this.failNextRefresh = false;
      this.log('E epd: BUSY timeout');
      return false;
    }
    this.log('I epd: refresh done');
    this.shown = frame;
    this.onDisplay?.(frame);
    return true;
  }

  /** A write to the Data characteristic. */
  data(chunk: Uint8Array) {
    if (!this.receiving) return;
    if (this.received + chunk.length > FRAME_BYTES) {
      this.overflow = true;
      return;
    }
    if (this.corruptNextUpload && this.received === 0) {
      this.corruptNextUpload = false;
      chunk = chunk.slice();
      chunk[0] ^= 0x55;
      this.log('W sim: corrupted one byte on purpose');
    }
    this.buf.set(chunk, this.received);
    this.received += chunk.length;
  }

  /** The link dropped: an upload in progress is cancelled, as on the badge. */
  disconnected() {
    this.receiving = false;
    this.authorized = false;
    this.nonce = null;
  }

  /** The badge's button held for 10 s: forgets the owner key. */
  resetLock() {
    this.ownerKey = null;
    this.authorized = false;
    this.log('W lock: owner key erased (button reset)');
  }

  /** A write to the Control characteristic; replies go through notify. */
  async handle(cmd: Uint8Array, notify: (data: Uint8Array) => void) {
    const op = cmd[0];
    const error = (code: number) => {
      this.log(`W inktag: command 0x${op.toString(16).padStart(2, '0')} failed: ${code}`);
      notify(Uint8Array.of(Evt.ERROR, code, op));
    };
    const displayed = () => notify(Uint8Array.of(Evt.DISPLAYED, 0, this.lastTemp & 0xff));
    const v = new DataView(cmd.buffer, cmd.byteOffset, cmd.byteLength);

    const hasLock = this.atLeast(0, 4);
    const open = !this.ownerKey || this.authorized;
    const gated = [Cmd.BEGIN, Cmd.END, Cmd.SHOW, Cmd.CLEAR, Cmd.TEMP, Cmd.LOCK, Cmd.UNLOCK];
    if (hasLock && !open && (gated as number[]).includes(op)) return error(10);

    switch (op) {
      case Cmd.BEGIN: {
        if (cmd.length < 6) return error(1);
        if (cmd[1] !== FMT_NATIVE_4BPP) return error(9);
        const length = v.getUint32(2, true);
        if (length !== FRAME_BYTES) return error(2);
        this.receiving = false; // a new BEGIN discards an unfinished upload
        this.stored = null; // erasing loses the old image, as on the badge
        await sleep(DELAYS[this.timing].erase);
        this.received = 0;
        this.overflow = false;
        this.receiving = true;
        this.log(`I inktag: receiving ${length} bytes`);
        return notify(Uint8Array.of(Evt.READY, 0));
      }
      case Cmd.END: {
        if (cmd.length < 5) return error(1);
        if (!this.receiving) return error(3);
        this.receiving = false;
        if (this.overflow) return error(4);
        if (this.received !== FRAME_BYTES) {
          this.log(`W store: got ${this.received} of ${FRAME_BYTES} bytes`);
          return error(2);
        }
        const crc = crc32(this.buf);
        if (crc !== v.getUint32(1, true)) {
          this.log(`E store: CRC mismatch, computed ${crc.toString(16).padStart(8, '0')}`);
          return error(5);
        }
        this.stored = this.buf.slice();
        notify(Uint8Array.of(Evt.RECEIVED, 0));
        return (await this.refresh(this.stored)) ? displayed() : error(7);
      }
      case Cmd.SHOW:
        if (this.receiving) return error(3);
        if (!this.stored) return error(8);
        return (await this.refresh(this.stored)) ? displayed() : error(7);
      case Cmd.CLEAR: {
        if (this.receiving) return error(3);
        const c = cmd.length > 1 ? cmd[1] & 0x0f : 1;
        return (await this.refresh(new Uint8Array(FRAME_BYTES).fill((c << 4) | c)))
          ? displayed()
          : error(7);
      }
      case Cmd.INFO:
        return notify(this.info());
      case Cmd.ABORT:
        this.receiving = false;
        this.log('I inktag: upload aborted');
        return;
      case Cmd.TEMP:
        if (!this.atLeast(0, 2)) return error(1);
        if (cmd.length < 2) return error(1);
        this.tempOverride = v.getInt8(1);
        this.log(
          `I epd: temperature override ${this.tempOverride === TEMP_UNKNOWN ? 'off' : `${this.tempOverride} C`}`,
        );
        return notify(this.info());
      case Cmd.LOCK:
        if (!hasLock || cmd.length !== 1 + LOCK_KEY_BYTES) return error(1);
        this.ownerKey = cmd.slice(1);
        this.authorized = true;
        this.log('I lock: owner key set');
        return notify(this.info());
      case Cmd.AUTH: {
        if (!hasLock) return error(1);
        if (cmd.length === 1) {
          this.nonce = Uint8Array.from({ length: LOCK_KEY_BYTES }, () =>
            Math.floor(Math.random() * 256),
          );
          const msg = new Uint8Array(2 + LOCK_KEY_BYTES);
          msg[0] = Evt.CHALLENGE;
          msg.set(this.nonce, 2);
          return notify(msg);
        }
        if (cmd.length !== 1 + LOCK_KEY_BYTES) return error(1);
        const nonce = this.nonce;
        this.nonce = null; // one answer per challenge
        if (!this.ownerKey) {
          this.authorized = true;
          return notify(this.info());
        }
        if (!nonce) return error(3);
        const want = lockAnswer(this.ownerKey, nonce);
        if (!want.every((b, i) => b === cmd[1 + i])) {
          this.log('W lock: wrong answer');
          return error(10);
        }
        this.authorized = true;
        this.log('I lock: authorized');
        return notify(this.info());
      }
      case Cmd.UNLOCK:
        if (!hasLock) return error(1);
        this.ownerKey = null;
        this.log('I lock: owner key erased');
        return notify(this.info());
      default:
        return error(1);
    }
  }

  info(): Uint8Array {
    const size = this.atLeast(0, 4) ? 22 : this.atLeast(0, 3) ? 21 : this.atLeast(0, 2) ? 18 : 17;
    const b = new Uint8Array(size);
    const v = new DataView(b.buffer);
    b.set([Evt.INFO, 0, PROTOCOL_VERSION, ...this.firmware]);
    v.setUint16(6, PANEL_WIDTH, true);
    v.setUint16(8, PANEL_HEIGHT, true);
    b[10] = FMT_NATIVE_4BPP;
    b[11] = this.stored ? 1 : 0;
    v.setInt8(12, this.lastTemp);
    v.setUint32(13, FRAME_BYTES, true);
    if (size >= 18) v.setInt8(17, this.tempOverride);
    if (size >= 21) b.set(this.panelId, 18);
    if (size >= 22) b[21] = (this.ownerKey ? 1 : 0) | (this.authorized || !this.ownerKey ? 2 : 0);
    return b;
  }
}
