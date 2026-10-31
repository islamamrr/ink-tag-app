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
