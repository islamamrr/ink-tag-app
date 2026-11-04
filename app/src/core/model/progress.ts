// Clear progress while sending: which stage, how far, roughly how long is
// left, and when it is safe to walk away (the picture is in the badge's
// flash at RECEIVED; the refresh finishes without the phone).
//
// Time left comes from what earlier sends on this phone took, so it gets
// better with use. The estimate is saved with the app's settings.

export type SendStage =
  | 'preparing' // drawing and dithering on the phone
  | 'connecting'
  | 'erasing'
  | 'sending'
  | 'verifying'
  | 'refreshing'
  | 'done'
  | 'failed';

export const STAGE_LABELS: Record<SendStage, string> = {
  preparing: 'Preparing the picture',
  connecting: 'Connecting to the badge',
  erasing: 'Making room on the badge',
  sending: 'Sending',
  verifying: 'Checking it arrived intact',
  refreshing: 'The screen is redrawing',
  done: 'Done',
  failed: 'Not sent',
};

/** Typical durations, refined from real sends. */
export interface Timings {
  preparingMs: number;
  connectingMs: number;
  erasingMs: number;
  bytesPerSecond: number;
  verifyingMs: number;
  /** At 10 °C and above. */
  refreshMs: number;
  /** Below 10 °C the panel uses a slower waveform. */
  coldRefreshMs: number;
}

export const DEFAULT_TIMINGS: Timings = {
  preparingMs: 1_500,
  connectingMs: 2_500,
  erasingMs: 2_000,
  bytesPerSecond: 20 * 1024,
  verifyingMs: 600,
  refreshMs: 30_000,
  coldRefreshMs: 45_000,
};

export interface SendProgress {
  stage: SendStage;
  label: string;
  /** 0..1 over the whole send, refresh included. */
  fraction: number;
  /** Seconds, rounded; null when unknown. */
  secondsLeft: number | null;
  /** The badge has the picture stored: the phone may leave. */
  safeToLeave: boolean;
  /** Bytes sent in the sending stage. */
  sent: number;
  total: number;
  /** A CRC or write retry is under way. */
  attempt: number;
}

const ORDER: SendStage[] = ['preparing', 'connecting', 'erasing', 'sending', 'verifying', 'refreshing'];

/** Feeds stage events in; reports SendProgress out; learns the timings at the end. */
export class ProgressTracker {
  private stage: SendStage = 'preparing';
  private stageStart: number;
  private sent = 0;
  private total: number;
  private attempt = 1;
  private readonly started: Record<string, number> = {};
  private readonly durations: Partial<Record<SendStage, number>> = {};

  constructor(
    private readonly timings: Timings,
    private readonly opts: {
      total: number;
      /** Panel temperature, if known, to pick the cold refresh time. */
      temperature?: number | null;
      /** Already connected: skip the connecting stage. */
      connected?: boolean;
      now?: () => number;
      onChange?: (p: SendProgress) => void;
    },
  ) {
    this.total = opts.total;
    this.stageStart = this.now();
    this.started.preparing = this.stageStart;
  }

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  enter(stage: SendStage, attempt = this.attempt) {
    const t = this.now();
    if (this.stage !== stage) {
      this.durations[this.stage] = (this.durations[this.stage] ?? 0) + (t - this.stageStart);
      this.stage = stage;
      this.stageStart = t;
      this.started[stage] ??= t;
    }
    if (attempt !== this.attempt) {
      this.attempt = attempt;
      this.sent = 0;
    }
    this.emit();
  }

  bytes(sent: number, total = this.total) {
    this.sent = sent;
    this.total = total;
    this.emit();
  }

  private expected(stage: SendStage): number {
    const T = this.timings;
    switch (stage) {
      case 'preparing':
        return T.preparingMs;
      case 'connecting':
        return this.opts.connected ? 0 : T.connectingMs;
      case 'erasing':
        return T.erasingMs;
      case 'sending':
        return (this.total / T.bytesPerSecond) * 1000;
      case 'verifying':
        return T.verifyingMs;
      case 'refreshing':
        return this.opts.temperature != null && this.opts.temperature < 10
          ? T.coldRefreshMs
          : T.refreshMs;
      default:
        return 0;
    }
  }

  snapshot(): SendProgress {
    const t = this.now();
    const idx = ORDER.indexOf(this.stage);
    const final = this.stage === 'done' || this.stage === 'failed';
    let doneMs = 0;
    let leftMs = 0;
    let totalMs = 0;
    ORDER.forEach((s, i) => {
      const e = this.expected(s);
      totalMs += e;
      if (final || i < idx) doneMs += e;
      else if (i === idx) {
        const elapsed = t - this.stageStart;
        // Sending is measured in bytes; the rest in time, never past 95%.
        const part =
          s === 'sending' && this.total > 0
            ? this.sent / this.total
            : e > 0
              ? Math.min(0.95, elapsed / e)
              : 1;
        doneMs += e * part;
        const rest =
          s === 'sending' && this.sent > 0
            ? (elapsed / this.sent) * (this.total - this.sent)
            : Math.max(0, e - elapsed);
        leftMs += rest;
      } else leftMs += e;
    });
    const safe = idx >= ORDER.indexOf('refreshing') || this.stage === 'done';
    return {
      stage: this.stage,
      label:
        this.stage === 'sending' && this.attempt > 1
          ? 'Sending again, more carefully'
          : STAGE_LABELS[this.stage],
      fraction: final ? (this.stage === 'done' ? 1 : doneMs / totalMs) : Math.min(0.99, doneMs / totalMs),
      secondsLeft: final ? 0 : Math.max(1, Math.round(leftMs / 1000)),
      safeToLeave: safe && this.stage !== 'failed',
      sent: this.sent,
      total: this.total,
      attempt: this.attempt,
    };
  }

  private emit() {
    this.opts.onChange?.(this.snapshot());
  }

  /** Blends what this send measured into the timings (a slow moving average). */
  learned(): Timings {
    const T = { ...this.timings };
    const mix = (old: number, measured: number | undefined) =>
      measured === undefined || !Number.isFinite(measured) || measured <= 0
        ? old
        : Math.round(old * 0.7 + measured * 0.3);
    const d = this.durations;
    T.preparingMs = mix(T.preparingMs, d.preparing);
    if (!this.opts.connected) T.connectingMs = mix(T.connectingMs, d.connecting);
    T.erasingMs = mix(T.erasingMs, d.erasing);
    T.verifyingMs = mix(T.verifyingMs, d.verifying);
    if (d.sending && this.attempt === 1 && this.sent === this.total)
      T.bytesPerSecond = mix(T.bytesPerSecond, this.total / (d.sending / 1000));
    if (d.refreshing) {
      if (this.opts.temperature != null && this.opts.temperature < 10)
        T.coldRefreshMs = mix(T.coldRefreshMs, d.refreshing);
      else T.refreshMs = mix(T.refreshMs, d.refreshing);
    }
    return T;
  }
}
