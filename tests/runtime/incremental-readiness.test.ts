import { describe, expect, it } from "vitest";

import { createBorealRuntime } from "@boreal/engine";
import { InMemoryBorealStore, type BorealReader, type BorealStore, type BorealWriter } from "@boreal/storage";

describe("incremental readiness recompute", () => {
  it("closing a blocker readies only its transitive dependents", async () => {
    const store = new CountingGraphEdgeStore();
    const runtime = createBorealRuntime({
      store,
      policy: { requireAgentSummaryForClose: false }
    });
    const a = await runtime.createWork({ title: "a", kind: "task" });
    const b = await runtime.createWork({ title: "b", kind: "task", ready: true });
    const c = await runtime.createWork({ title: "c", kind: "task", ready: true });

    await runtime.addBlockingDependency({ blockedWorkId: b.meta.id, blockingWorkId: a.meta.id });
    await runtime.addBlockingDependency({ blockedWorkId: c.meta.id, blockingWorkId: b.meta.id });
    await runtime.markReady(a.meta.id);
    await runtime.claimWork({ workId: a.meta.id, agentId: "t" });

    store.resetGraphEdgeCalls();
    await runtime.finishReservedWork({
      workId: a.meta.id,
      agentId: "t",
      evidence: {
        kind: "test",
        summary: "incremental readiness close passed",
        outcome: "passed"
      },
      verification: { verdict: "passed" },
      close: { reason: "done" }
    });
    const graphEdgeCalls = store.listGraphEdgesCalls;

    expect(graphEdgeCalls).toBeLessThanOrEqual(4);
    expect((await runtime.getWorkView(b.meta.id)).status).toBe("ready");
    expect((await runtime.getWorkView(c.meta.id)).status).toBe("blocked");
  });
});

class CountingGraphEdgeStore implements BorealStore {
  readonly inner = new InMemoryBorealStore();
  listGraphEdgesCalls = 0;

  async read<T>(operation: (reader: BorealReader) => Promise<T> | T): Promise<T> {
    return this.inner.read((reader) => operation(this.wrap(reader)));
  }

  async write<T>(operation: (writer: BorealWriter) => Promise<T> | T): Promise<T> {
    return this.inner.write((writer) => operation(this.wrap(writer)));
  }

  resetGraphEdgeCalls(): void {
    this.listGraphEdgesCalls = 0;
  }

  private wrap<TReader extends BorealReader>(reader: TReader): TReader {
    return new Proxy(reader, {
      get: (target, property, receiver) => {
        if (property === "listGraphEdges") {
          return async () => {
            this.listGraphEdgesCalls += 1;
            return target.listGraphEdges();
          };
        }
        return Reflect.get(target, property, receiver);
      }
    });
  }
}
