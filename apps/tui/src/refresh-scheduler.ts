/**
 * A small completion-based refresh scheduler for the TUI.
 *
 * There is at most one refresh callback in flight. Requests received while it
 * is running are coalesced into one trailing refresh; an immediate request is
 * remembered as immediate so a manual refresh is not delayed by the normal
 * interval. The next automatic run is scheduled only after the previous run
 * completes, which prevents slow reads from stacking timers and subprocesses.
 */

export interface RefreshSchedulerOptions {
  readonly intervalMs: number;
  readonly onRefresh: () => void | Promise<void>;
  readonly onError?: (error: unknown) => void;
  /** Maximum delay after repeated failures. Defaults to two minutes. */
  readonly maxBackoffMs?: number;
  readonly setTimeout?: typeof globalThis.setTimeout;
  readonly clearTimeout?: typeof globalThis.clearTimeout;
}

export interface RefreshScheduler {
  start(): void;
  stop(): void;
  /** Queue a refresh. Immediate requests run now or immediately after an in-flight run. */
  request(options?: { readonly immediate?: boolean }): void;
}

export function createRefreshScheduler(options: RefreshSchedulerOptions): RefreshScheduler {
  const intervalMs = Math.max(500, Math.floor(options.intervalMs));
  const maxBackoffMs = Math.max(intervalMs, Math.floor(options.maxBackoffMs ?? 120_000));
  const scheduleTimeout = options.setTimeout ?? globalThis.setTimeout;
  const cancelTimeout = options.clearTimeout ?? globalThis.clearTimeout;
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let stopped = true;
  let inFlight = false;
  let pending = false;
  let pendingImmediate = false;
  let failures = 0;

  const clearTimer = (): void => {
    if (timer === undefined) return;
    cancelTimeout(timer);
    timer = undefined;
  };

  const delayAfterFailure = (): number => {
    if (failures === 0) return intervalMs;
    return Math.min(maxBackoffMs, intervalMs * 2 ** Math.min(failures - 1, 16));
  };

  const schedule = (delayMs: number): void => {
    if (stopped || timer !== undefined) return;
    timer = scheduleTimeout(() => {
      timer = undefined;
      void run();
    }, Math.max(0, delayMs));
  };

  const run = async (): Promise<void> => {
    if (stopped || inFlight) return;
    inFlight = true;
    pending = false;
    const wasImmediate = pendingImmediate;
    pendingImmediate = false;
    try {
      await options.onRefresh();
      failures = 0;
    } catch (error) {
      failures += 1;
      options.onError?.(error);
    } finally {
      inFlight = false;
      if (stopped) return;
      if (pending) {
        // A request made during the read is the trailing edge of the burst.
        // Preserve the manual/immediate intent without starting a second read.
        if (pendingImmediate) {
          pendingImmediate = false;
          void run();
        } else {
          schedule(delayAfterFailure());
        }
      } else {
        schedule(wasImmediate ? intervalMs : delayAfterFailure());
      }
    }
  };

  return {
    start(): void {
      if (!stopped) return;
      stopped = false;
      schedule(intervalMs);
    },
    stop(): void {
      stopped = true;
      clearTimer();
      pending = false;
      pendingImmediate = false;
    },
    request(requestOptions = {}): void {
      if (stopped) return;
      pending = true;
      if (requestOptions.immediate) {
        pendingImmediate = true;
        clearTimer();
        if (!inFlight) void run();
      } else if (!inFlight) {
        clearTimer();
        schedule(0);
      }
    }
  };
}
