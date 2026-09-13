import { describe, expect, it, vi } from "vitest";

import { headsDiffer, normalizeRefreshInterval, type EventLogHead } from "../../apps/tui/src/head-poll.js";
import { createRefreshScheduler } from "../../apps/tui/src/refresh-scheduler.js";

const first: EventLogHead = { seq: 4, hash: "hash-a" };

describe("tui head polling", () => {
  it("waits thirty seconds after completion, retries with bounded backoff, and cancels timers", async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const refresh = vi.fn<() => Promise<void>>().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    refresh.mockRejectedValue(new Error("offline"));
    const scheduler = createRefreshScheduler({ intervalMs: 30_000, maxBackoffMs: 120_000, onRefresh: refresh });
    try {
      scheduler.start();
      scheduler.request({ immediate: true });
      await vi.advanceTimersByTimeAsync(90_000);
      expect(refresh).toHaveBeenCalledTimes(1);
      finish?.();
      await vi.advanceTimersByTimeAsync(29_999);
      expect(refresh).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(refresh).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(refresh).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(refresh).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(refresh).toHaveBeenCalledTimes(4);
      scheduler.stop();
      await vi.advanceTimersByTimeAsync(240_000);
      expect(refresh).toHaveBeenCalledTimes(4);
    } finally { scheduler.stop(); vi.useRealTimers(); }
  });
  it("uses both sequence and hash to detect a changed head", () => {
    expect(headsDiffer(undefined, first)).toBe(false);
    expect(headsDiffer(first, first)).toBe(false);
    expect(headsDiffer(first, { seq: 5, hash: "hash-a" })).toBe(true);
    expect(headsDiffer(first, { seq: 4, hash: "hash-b" })).toBe(true);
  });

  it("applies a safe refresh floor while retaining the configured interval", () => {
    expect(normalizeRefreshInterval(undefined)).toBe(30_000);
    expect(normalizeRefreshInterval(1_250)).toBe(1_250);
    expect(normalizeRefreshInterval(0)).toBe(500);
    expect(normalizeRefreshInterval(Number.NaN)).toBe(30_000);
  });

  it("coalesces in-flight requests and schedules from completion", async () => {
    let resolveRefresh: (() => void) | undefined;
    let calls = 0;
    const scheduler = createRefreshScheduler({
      intervalMs: 30_000,
      onRefresh: () => {
        calls += 1;
        return new Promise<void>((resolve) => { resolveRefresh = resolve; });
      }
    });
    scheduler.start();
    scheduler.request({ immediate: true });
    scheduler.request({ immediate: true });
    expect(calls).toBe(1);
    resolveRefresh?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(2);
    scheduler.stop();
  });

  it("backs off failures without stacking automatic timers", async () => {
    const delays: number[] = [];
    let calls = 0;
    const scheduler = createRefreshScheduler({
      intervalMs: 1_000,
      maxBackoffMs: 4_000,
      onRefresh: () => {
        calls += 1;
        throw new Error("offline");
      },
      onError: () => undefined,
      setTimeout: ((callback: () => void, delay?: number) => {
        delays.push(delay ?? 0);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout
    });
    scheduler.start();
    scheduler.request({ immediate: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(delays).toEqual([1_000, 1_000]);
    scheduler.stop();
  });

  it("cancels a scheduled refresh when stopped", async () => {
    let callback: (() => void) | undefined;
    let calls = 0;
    const scheduler = createRefreshScheduler({
      intervalMs: 1_000,
      onRefresh: () => { calls += 1; },
      setTimeout: ((next: () => void) => { callback = next; return 1 as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout
    });
    scheduler.start();
    scheduler.stop();
    callback?.();
    await Promise.resolve();
    expect(calls).toBe(0);
  });
});
