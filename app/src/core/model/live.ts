// Live templates (clock, countdown, day and date). Today's badge firmware
// can't keep time, so the phone draws a fresh picture and sends it on a
// schedule. Times come in steps, never every minute, because every update
// flashes the screen for about 20 seconds.
//
// The runner has no timers of its own: the app gives it setTimer, so tests
// drive it with a fake clock. JavaScript timers stop while the app is in the
// background on a phone, so the app calls resume() when it comes back, and
// an update that was due is sent then.

import type { LiveRule } from '../design/specs';
import type { Values } from '../design/templates';

/** Updates run between these hours (hourly and quarter rules). */
export const DAY_START = 8;
export const DAY_END = 20;
export const MORNING_HOUR = 7;

const at = (base: Date, dayOffset: number, h: number, m = 0) =>
  new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, h, m, 0, 0).getTime();

/** The next update strictly after `after`. */
export function nextRun(rule: LiveRule, after: number): number {
  const d = new Date(after);
  if (rule === 'morning') {
    const today = at(d, 0, MORNING_HOUR);
    return today > after ? today : at(d, 1, MORNING_HOUR);
  }
  const step = rule === 'hourly' ? 60 : 15;
  const minutes = d.getHours() * 60 + d.getMinutes();
  let next = (Math.floor(minutes / step) + 1) * step;
  if (next < DAY_START * 60) next = DAY_START * 60;
  if (next > DAY_END * 60) return at(d, 1, DAY_START);
  return at(d, 0, Math.floor(next / 60), next % 60);
}

export interface LiveJob {
  badgeId: string;
  templateId: string;
  values: Values;
  layout: number;
  rule: LiveRule;
  startedAt: number;
  /** Last update that reached the badge. */
  lastAt?: number;
  /** Scheduled time of the next update. */
  nextAt: number;
  /** The last update's problem, in plain words; cleared by a good one. */
  lastError?: string;
}

export interface LiveDeps {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => () => void;
  /** Draws the picture for `drawAt` and sends it. Throws on failure. */
  send: (job: LiveJob, drawAt: number) => Promise<void>;
  /** Persist the job (null when stopped). */
  save: (job: LiveJob | null) => Promise<void> | void;
  describe?: (e: unknown) => string;
}

/** Runs one live template at a time. */
export class LiveRunner {
  private job: LiveJob | null = null;
  private cancel: (() => void) | null = null;
  private running = false;
  private listeners = new Set<() => void>();

  constructor(private readonly deps: LiveDeps) {}

  current(): LiveJob | null {
    return this.job;
  }

  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  /** Starts (or replaces) the live template: sends now, then on the schedule. */
  async start(job: Omit<LiveJob, 'nextAt' | 'startedAt' | 'lastAt' | 'lastError'>): Promise<void> {
    const now = this.deps.now();
    this.clearTimer();
    this.job = { ...job, startedAt: now, nextAt: now };
    await this.tick(true);
  }

  /** After a launch or coming back to the foreground: catch up, then keep going. */
  async resume(job: LiveJob | null = this.job): Promise<void> {
    this.clearTimer();
    this.job = job;
    if (!job) return;
    if (job.nextAt <= this.deps.now()) await this.tick(false);
    else this.schedule();
  }

  async stop() {
    this.clearTimer();
    this.job = null;
    await this.deps.save(null);
    this.emit();
  }

  /** Pause timers (app in background) without forgetting the job. */
  pause() {
    this.clearTimer();
  }

  private clearTimer() {
    this.cancel?.();
    this.cancel = null;
  }

  private schedule() {
    const job = this.job;
    if (!job) return;
    const ms = Math.max(0, job.nextAt - this.deps.now());
    this.cancel = this.deps.setTimer(() => {
      this.cancel = null;
      // A timer may fire early (the app caps long timers): wait on.
      if (this.job && this.deps.now() < this.job.nextAt) this.schedule();
      else void this.tick(false);
    }, ms);
  }

  private async tick(first: boolean) {
    const job = this.job;
    if (!job || this.running) return;
    this.running = true;
    const now = this.deps.now();
    // Draw the time the update was due, so a send that runs a little late
    // still reads 09:00; when it's long overdue (phone was away), draw now.
    const due = first || now - job.nextAt > 10 * 60_000 ? now : job.nextAt;
    try {
      await this.deps.send(job, due);
      if (this.job === job) {
        job.lastAt = this.deps.now();
        job.lastError = undefined;
      }
    } catch (e) {
      if (this.job === job) job.lastError = this.deps.describe?.(e) ?? String(e);
    } finally {
      this.running = false;
    }
    if (this.job !== job) return;
    job.nextAt = nextRun(job.rule, Math.max(now, due));
    await this.deps.save(job);
    this.schedule();
    this.emit();
  }
}
