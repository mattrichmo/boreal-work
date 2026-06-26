import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { withPromptSession, type CliPromptIO } from "../../apps/cli/src/cli-ui.ts";

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
    expect(output.text).toContain("Memory layout:");
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
    expect(output.text).toContain("Space toggles. Enter accepts.");
  });
});

function fakeIo(input: FakeInput, output: FakeOutput): CliPromptIO {
  return {
    input: input as unknown as NodeJS.ReadStream,
    output: output as unknown as NodeJS.WriteStream
  };
}
