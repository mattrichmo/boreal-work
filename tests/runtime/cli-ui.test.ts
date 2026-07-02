import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import {
  choiceList,
  keyValueRows,
  resultSummary,
  section,
  shortcutHint,
  statusIcon,
  stepper,
  withPromptSession,
  type CliPromptIO
} from "../../apps/cli/src/cli-ui.ts";

class FakeInput extends EventEmitter {
  isTTY = true;
  isRaw = false;
  readonly rawModes: boolean[] = [];

  setRawMode(value: boolean): this {
    this.isRaw = value;
    this.rawModes.push(value);
    return this;
  }

  resume(): this {
    return this;
  }

  pause(): this {
    return this;
  }
}

class FakeOutput extends EventEmitter {
  isTTY = true;
  text = "";

  write(chunk: string | Uint8Array): boolean {
    this.text += chunk instanceof Uint8Array ? Buffer.from(chunk).toString("utf8") : chunk;
    return true;
  }
}

describe("cli ui", () => {
  it("renders deterministic status, section, key-value, and result summary primitives", () => {
    expect(statusIcon("success")).toBe("OK");
    expect(statusIcon("success", { unicode: true })).toBe("✓");
    expect(shortcutHint("Enter", "accept")).toBe("[Enter] accept");
    expect(section("Health", ["doctor ok", "sync ok"])).toBe("Health\n  doctor ok\n  sync ok");
    expect(
      keyValueRows([
        { key: "workspace", value: "/repo" },
        { key: "ok", value: true }
      ])
    ).toBe("workspace  /repo\nok         true");
    expect(
      resultSummary({
        status: "warning",
        title: "Search stale",
        detail: "Index is 2 commits behind.",
        action: "bwrk sync refresh --json"
      })
    ).toBe("WARN Search stale\n  Index is 2 commits behind.\n  next: bwrk sync refresh --json");
  });

  it("renders stepper and windowed choice list primitives", () => {
    expect(
      stepper([
        { label: "Detect", status: "complete" },
        { label: "Review", status: "current" },
        { label: "Write", status: "pending" }
      ])
    ).toBe(" 1 OK Detect\n 2 > Review\n 3   Write");

    expect(
      choiceList({
        label: "Memory layout",
        activeIndex: 2,
        selectedValues: ["sibling"],
        windowSize: 3,
        options: [
          { value: "in-repo", label: "In repo", description: "Use local memory." },
          { value: "child", label: "Child", description: "Use child memory." },
          { value: "sibling", label: "Sibling", description: "Use sibling memory." },
          { value: "submodule", label: "Submodule", description: "Use submodule memory." }
        ]
      })
    ).toBe("Memory layout:\n  ( ) Child\n> (*) Sibling\n  ( ) Submodule\n\nUse sibling memory.\n[Enter] accept");
  });

  it("selects choices with arrow keys and restores raw mode", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const selectedPromise = withPromptSession(fakeIo(input, output), (prompt) =>
      prompt.select(
        "Memory layout",
        [
          { value: "in-repo", label: "In repo", description: "Use local memory." },
          { value: "sibling", label: "Sibling", description: "Use sibling memory." }
        ],
        "in-repo"
      )
    );

    input.emit("keypress", "", { name: "down" });
    input.emit("keypress", "", { name: "return" });

    await expect(selectedPromise).resolves.toBe("sibling");
    expect(input.rawModes[0]).toBe(true);
    expect(input.rawModes.at(-1)).toBe(false);
    expect(output.text).toContain("Memory layout");
    expect(output.text).toContain("Use sibling memory.");
    expect(output.text).toContain("\x1B[?25h");
  });

  it("toggles multiselect values without allowing an empty selection", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const selectedPromise = withPromptSession(fakeIo(input, output), (prompt) =>
      prompt.multiselect(
        "Skill targets",
        [
          { value: "codex", label: "Codex", description: "Install Codex skills." },
          { value: "claude", label: "Claude", description: "Install Claude skills." }
        ],
        ["codex"]
      )
    );

    input.emit("keypress", "", { name: "space" });
    input.emit("keypress", "", { name: "down" });
    input.emit("keypress", "", { name: "space" });
    input.emit("keypress", "", { name: "return" });

    await expect(selectedPromise).resolves.toEqual(["codex", "claude"]);
    expect(input.rawModes[0]).toBe(true);
    expect(input.rawModes.at(-1)).toBe(false);
    expect(output.text).toContain("Space toggle   Enter accept   Up/Down move");
  });

  it("cancels prompts with ctrl-c and restores terminal state", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const selectedPromise = withPromptSession(fakeIo(input, output), (prompt) =>
      prompt.select(
        "Memory layout",
        [
          { value: "in-repo", label: "In repo", description: "Use local memory." },
          { value: "sibling", label: "Sibling", description: "Use sibling memory." }
        ],
        "in-repo"
      )
    );

    input.emit("keypress", "", { name: "c", ctrl: true });

    await expect(selectedPromise).rejects.toMatchObject({
      code: "BOREAL_INVALID_INPUT",
      details: { reason: "cancelled" }
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(input.rawModes[0]).toBe(true);
    expect(input.rawModes.at(-1)).toBe(false);
    expect(output.text).toContain("\x1B[?25h");
  });
});

function fakeIo(input: FakeInput, output: FakeOutput): CliPromptIO {
  return {
    input: input as unknown as NodeJS.ReadStream,
    output: output as unknown as NodeJS.WriteStream
  };
}
