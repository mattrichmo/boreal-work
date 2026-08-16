import { describe, expect, it } from "vitest";

import { descriptorCanRun, formatCommandDescriptor, quoteShellArg } from "../../apps/tui/src/command-panel.js";

describe("tui command previews", () => {
  it("quotes argv values without changing their exact contents", () => {
    expect(quoteShellArg("--json")).toBe("--json");
    expect(quoteShellArg("two words")).toBe("'two words'");
    expect(quoteShellArg("O'Reilly")).toBe("'O'\\''Reilly'");
    expect(quoteShellArg("")).toBe("''");

    expect(
      formatCommandDescriptor({
        displayCommand: "bwrk work close bw_work_1",
        argv: ["work", "close", "bw_work_1", "--reason", "needs review"]
      })
    ).toBe("bwrk work close bw_work_1 --reason 'needs review'");
  });

  it("preserves a quoted command binary and blocks disabled descriptors", () => {
    expect(
      formatCommandDescriptor({
        displayCommand: '"/opt/Boreal CLI/bwrk" work show "a b"',
        argv: ["work", "show", "a b"]
      })
    ).toBe("'/opt/Boreal CLI/bwrk' work show 'a b'");
    expect(descriptorCanRun({ disabled: false })).toBe(true);
    expect(descriptorCanRun({})).toBe(true);
    expect(descriptorCanRun({ disabled: true })).toBe(false);
  });
});
