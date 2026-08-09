import { describe, expect, it } from "vitest";

import {
  GLOBAL_STATUS_PROJECT_CONCURRENCY,
  mapWithConcurrencyLimit as mapDashboardWithConcurrencyLimit
} from "../../apps/cli/src/commands/dashboard.ts";
import { selectTopK } from "../../apps/cli/src/rollup.ts";
import {
  boundedSearchOptions,
  MAX_SEARCH_RESULT_LIMIT
} from "../../apps/cli/src/search-cli.ts";
import {
  CONSOLE_GLOBAL_PROJECT_CONCURRENCY,
  CONSOLE_SPRINT_DETAIL_CONCURRENCY,
  MAX_CONSOLE_GLOBAL_PROJECTS,
  mapWithConcurrencyLimit as mapConsoleWithConcurrencyLimit
} from "../../apps/console/src/app/live-data.ts";
import {
  DAEMON_RESERVATION_RENEWAL_BATCH_LIMIT,
  selectDaemonRenewalBatch
} from "../../apps/daemon/src/runtime.ts";

describe("bounded performance paths", () => {
  it("selects the same ordered top-k result as a full sort", () => {
    const values = Array.from({ length: 10_000 }, (_, index) => ({
      score: (index * 37) % 101,
      id: `item-${String(index).padStart(5, "0")}`
    }));
    const compare = (left: (typeof values)[number], right: (typeof values)[number]) =>
      left.score - right.score || left.id.localeCompare(right.id);

    const expected = values.slice().sort(compare).slice(0, 25);
    const selected = selectTopK(values, 25, compare);

    expect(selected.total).toBe(values.length);
    expect(selected.items).toEqual(expected);
  });

  it("keeps search responses within the CLI payload budget", () => {
    expect(MAX_SEARCH_RESULT_LIMIT).toBe(100);
    expect(boundedSearchOptions({ limit: 10_000 }).limit).toBe(MAX_SEARCH_RESULT_LIMIT);
    expect(boundedSearchOptions({ limit: 0 }).limit).toBe(1);
    expect(boundedSearchOptions({ explain: true }).explain).toBe(true);
  });

  it("bounds CLI global status work while preserving result order", async () => {
    const observed = await exerciseConcurrency(mapDashboardWithConcurrencyLimit, GLOBAL_STATUS_PROJECT_CONCURRENCY);

    expect(observed.maxActive).toBeLessThanOrEqual(GLOBAL_STATUS_PROJECT_CONCURRENCY);
    expect(observed.results).toEqual(Array.from({ length: 18 }, (_, index) => index));
  });

  it("bounds console project fan-out and sprint detail work", async () => {
    const projectObserved = await exerciseConcurrency(mapConsoleWithConcurrencyLimit, CONSOLE_GLOBAL_PROJECT_CONCURRENCY);
    const detailObserved = await exerciseConcurrency(mapConsoleWithConcurrencyLimit, CONSOLE_SPRINT_DETAIL_CONCURRENCY);

    expect(MAX_CONSOLE_GLOBAL_PROJECTS).toBe(50);
    expect(projectObserved.maxActive).toBeLessThanOrEqual(CONSOLE_GLOBAL_PROJECT_CONCURRENCY);
    expect(detailObserved.maxActive).toBeLessThanOrEqual(CONSOLE_SPRINT_DETAIL_CONCURRENCY);
    expect(projectObserved.results).toEqual(Array.from({ length: 18 }, (_, index) => index));
  });

  it("publishes an explicit daemon renewal batch budget", () => {
    expect(DAEMON_RESERVATION_RENEWAL_BATCH_LIMIT).toBe(100);
  });

  it("selects the deterministic daemon batch without sorting all candidates", () => {
    const values = Array.from({ length: 1_000 }, (_, index) => ({
      agent: `agent-${index % 17}`,
      work: `work-${String((index * 19) % 1_000).padStart(4, "0")}`,
      id: `reservation-${String(index).padStart(4, "0")}`
    }));
    const compare = (left: (typeof values)[number], right: (typeof values)[number]) =>
      left.agent.localeCompare(right.agent) || left.work.localeCompare(right.work) || left.id.localeCompare(right.id);

    const expected = values.slice().sort(compare).slice(0, DAEMON_RESERVATION_RENEWAL_BATCH_LIMIT);
    const batch = selectDaemonRenewalBatch(values, DAEMON_RESERVATION_RENEWAL_BATCH_LIMIT, compare);

    expect(batch.selected).toEqual(expected);
    expect(batch.deferred).toHaveLength(values.length - expected.length);
    expect(new Set([...batch.selected, ...batch.deferred]).size).toBe(values.length);
  });
});

async function exerciseConcurrency(
  mapper: <T, U>(
    values: readonly T[],
    limit: number,
    worker: (value: T, index: number) => Promise<U>
  ) => Promise<readonly U[]>,
  limit: number
): Promise<{ readonly maxActive: number; readonly results: readonly number[] }> {
  let active = 0;
  let maxActive = 0;
  const results = await mapper(
    Array.from({ length: 18 }, (_, index) => index),
    limit,
    async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return value;
    }
  );
  return { maxActive, results };
}
