/**
 * Error used to reject debounced calls that were superseded or aborted.
 * Callers should treat this as "ignore", not as a failure.
 */
export class DebounceCancelled extends Error {
  constructor() {
    super('debounced call cancelled');
    this.name = 'DebounceCancelled';
  }
}

/**
 * Runs async work after a quiet period.
 *
 * - A new `run()` cancels any previously scheduled (not-yet-started) run.
 * - An aborted `AbortSignal` cancels the scheduled run.
 * - Cancelled runs reject with {@link DebounceCancelled}.
 * - Once the work has actually started (timer fired), it is allowed to
 *   finish; cancellation of in-flight work is the caller's job via the
 *   AbortSignal it also passes down to the network layer.
 */
export class AsyncDebouncer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cancelPending: (() => void) | undefined;

  constructor(private delayMs: number) {}

  setDelay(ms: number): void {
    this.delayMs = ms;
  }

  run<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
    this.clear();

    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        this.clear();
        reject(new DebounceCancelled());
      };

      this.cancelPending = (): void => {
        signal.removeEventListener('abort', onAbort);
        reject(new DebounceCancelled());
      };

      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });

      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.cancelPending = undefined;
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          reject(new DebounceCancelled());
          return;
        }
        fn().then(resolve, reject);
      }, this.delayMs);
    });
  }

  private clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.cancelPending) {
      const cancel = this.cancelPending;
      this.cancelPending = undefined;
      cancel();
    }
  }

  dispose(): void {
    this.clear();
  }
}
