import { BorealError } from "@boreal/core";

import { flagValue, flagValues, hasFlag, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { formatRecord, table, type CliOutput } from "../output.js";
import { addRawSource, initVault, listRawSourceRows, type RawSourceRow } from "../vault.js";
import type { CommandResult } from "./shared.js";

export interface CaptureCommandDependencies {
  readonly defaultListLimit: number;
  readonly parseLimit: (value: string | undefined) => number | undefined;
}

export async function captureCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: CaptureCommandDependencies
): Promise<CommandResult> {
  if (hasFlag(args, "list") || action === "list") {
    const limit = dependencies.parseLimit(flagValue(args, "limit")) ?? dependencies.defaultListLimit;
    const rows = await listRawSourceRows(context, { limit });
    output.write(json ? formatRecord(rows, true) : table(rows.map(captureRawSourceRow)));
    return { exitCode: 0 };
  }

  const text = [action, ...rest].filter(Boolean).join(" ").trim();
  if (!text) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Usage: bwrk capture <text> [--label <label>...] [--uri <ref>] [--json]");
  }

  await initVault(context);
  output.write(
    formatRecord(
      await addRawSource(context, {
        title: text,
        kind: flagValue(args, "kind"),
        uri: flagValue(args, "uri"),
        tags: [...flagValues(args, "label"), ...flagValues(args, "tag")]
      }),
      json
    )
  );
  return { exitCode: 0 };
}

function captureRawSourceRow(row: RawSourceRow): Record<string, string | number> {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    status: row.processingStatus,
    wiki: row.linkedPageCount,
    tags: row.tags.join(","),
    uri: row.uri ?? ""
  };
}
