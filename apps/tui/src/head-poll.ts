// Refresh contract: poll the event-log head (seq + hash) every ~2s while the
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

export async function readHead(workspaceRoot: string): Promise<EventLogHead> {
  const paths = resolveWorkspacePaths(workspaceRoot);
  const log = new FileEventLog({ path: paths.eventLogFile });
  return log.head();
}

export function watchHead(
  workspaceRoot: string,
  onChange: (head: EventLogHead) => void,
  intervalMs = 2000
): () => void {
  let lastSeq: number | undefined;
  let cancelled = false;

  const tick = async (): Promise<void> => {
    if (cancelled) return;
    try {
      const head = await readHead(workspaceRoot);
      if (head.seq !== lastSeq) {
        lastSeq = head.seq;
        onChange(head);
      }
    } catch {
      // Uninitialized workspace or transient read error: skip this tick.
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), Math.max(500, intervalMs));
  return () => {
    cancelled = true;
    clearInterval(timer);
  };
}
