// Refresh contract: poll the event-log head (seq + hash) on the configured
// refresh interval (5s by default) while the
// shell is focused. Head unchanged -> do nothing. Head advanced -> caller
// refetches only the current route payload.
//
// A fresh `FileEventLog` is constructed on every tick rather than reused,
// because `FileEventLog` caches its head in-process after the first read and
// never invalidates that cache on its own -- reusing one instance across
// polls would never see writes made by another process (e.g. an agent
// running `bwrk work reserve` in a separate CLI invocation). Constructing a
// new instance re-reads the log file from disk, so "cheap" here is
// aspirational for very large logs (a tail-read variant is noted as a
// follow-up in the plan) but correct across processes.

import { resolveWorkspacePaths } from "@boreal/core";
import { FileEventLog } from "@boreal/storage";

export interface EventLogHead {
  readonly seq: number;
  readonly hash: string;
}

export const DEFAULT_TUI_REFRESH_MS = 5_000;

export async function readHead(workspaceRoot: string): Promise<EventLogHead> {
  const paths = resolveWorkspacePaths(workspaceRoot);
  const log = new FileEventLog({ path: paths.eventLogFile });
  return log.head();
}

export function headsDiffer(previous: EventLogHead | undefined, next: EventLogHead): boolean {
  return previous !== undefined && (previous.seq !== next.seq || previous.hash !== next.hash);
}

export function normalizeRefreshInterval(intervalMs: number | undefined, defaultMs = DEFAULT_TUI_REFRESH_MS): number {
  if (intervalMs === undefined || !Number.isFinite(intervalMs)) return defaultMs;
  return Math.max(500, Math.floor(intervalMs));
}

export function watchHead(
  workspaceRoot: string,
  onChange: (head: EventLogHead) => void,
  intervalMs = DEFAULT_TUI_REFRESH_MS
): () => void {
  let lastHead: EventLogHead | undefined;
  let cancelled = false;
  let inFlight = false;

  const tick = async (): Promise<void> => {
    if (cancelled || inFlight) return;
    inFlight = true;
    try {
      const head = await readHead(workspaceRoot);
      // The first read establishes the baseline. The route effect already
      // performs the initial payload load; emitting here would duplicate it.
      if (cancelled) return;
      if (headsDiffer(lastHead, head)) {
        onChange(head);
      }
      lastHead = head;
    } catch {
      // Uninitialized workspace or transient read error: skip this tick.
    } finally {
      inFlight = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), normalizeRefreshInterval(intervalMs));
  return () => {
    cancelled = true;
    clearInterval(timer);
  };
}
