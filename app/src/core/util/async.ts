/**
 * Yields to the event loop once. setTimeout(0) can take 1 to 15 ms (Windows
 * rounds timers up), which made the simulators crawl; setImmediate doesn't.
 */
export const tick = () =>
  new Promise<void>((resolve) =>
    typeof setImmediate === 'function' ? setImmediate(resolve) : setTimeout(resolve, 0),
  );

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Promise-based mutex: acquire() resolves with a release function. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => (release = resolve));
    const ready = this.tail.then(() => release);
    this.tail = this.tail.then(() => next);
    return ready;
  }
}
