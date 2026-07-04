import { BorealError, type EvidenceKind, type EvidenceOutcome, type EvidenceRecord, type WorkId } from "@boreal/core";

import { flagValue, requiredFlag, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { formatRecord, type CliOutput } from "../output.js";
import type { CommandResult } from "./shared.js";

export interface EvidenceCommandDependencies {
  readonly requiredPositional: (values: readonly string[], index: number, label: string) => string;
  readonly resolveWorkId: (context: CliContext, value: string) => Promise<WorkId>;
  readonly parseEvidenceKind: (value: string | undefined) => EvidenceKind;
  readonly parseOutcome: (value: string | undefined) => EvidenceOutcome;
  readonly resultForEvidence: (evidence: EvidenceRecord) => object;
}

export async function evidenceCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: EvidenceCommandDependencies
): Promise<CommandResult> {
  if (action !== "add") {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown evidence command: ${action ?? ""}`);
  }

  const evidence = await context.runtime.recordEvidence({
    subjectId: await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "work reference")),
    subjectType: "work",
    kind: dependencies.parseEvidenceKind(flagValue(args, "kind")),
    summary: requiredFlag(args, "summary"),
    outcome: dependencies.parseOutcome(flagValue(args, "outcome")),
    command: flagValue(args, "command"),
    uri: flagValue(args, "uri")
  });
  const result = dependencies.resultForEvidence(evidence);
  output.write(formatRecord(result, json));
  return { exitCode: 0 };
}
