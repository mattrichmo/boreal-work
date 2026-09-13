import { describe, expect, it } from "vitest";
import { installTerminalLifecycle } from "../../apps/tui/src/runtime.js";

class FakeProcess {
  readonly listeners = new Map<string, Set<(...args: never[]) => void>>();
  readonly exits: number[] = [];
  on(event: string, listener: (...args: never[]) => void): this {
    const set = this.listeners.get(event) ?? new Set<(...args: never[]) => void>();
    set.add(listener); this.listeners.set(event, set); return this;
  }
  off(event: string, listener: (...args: never[]) => void): this { this.listeners.get(event)?.delete(listener); return this; }
  exit(code: number): void { this.exits.push(code); }
  emit(event: string): void { for (const listener of this.listeners.get(event) ?? []) listener(); }
}

describe("terminal lifecycle", () => {
  it("restores alt screen and mouse exactly once on cleanup", () => {
    const processLike = new FakeProcess(); const writes: string[] = [];
    const restore = installTerminalLifecycle({ write: (value) => writes.push(value), processLike, enableMouse: true });
    expect(writes).toHaveLength(1);
    restore(); restore(); processLike.emit("exit");
    expect(writes).toHaveLength(2);
    expect(writes[1]).toContain("[?1006l");
    expect([...processLike.listeners.values()].every((set) => set.size === 0)).toBe(true);
  });

  it.each(["SIGINT", "SIGTERM", "SIGHUP"] as const)("restores and exits safely on %s", (signal) => {
    const processLike = new FakeProcess(); const writes: string[] = [];
    installTerminalLifecycle({ write: (value) => writes.push(value), processLike, enableMouse: false });
    processLike.emit(signal);
    expect(writes).toHaveLength(2);
    expect(processLike.exits).toEqual([signal === "SIGINT" ? 130 : 143]);
  });
});
