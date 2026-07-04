import type { BorealErrorCode } from "./errors.js";

export interface BorealErrorRecovery {
  readonly summary: string;
  readonly nextCommand?: string;
  readonly terminal?: boolean;
}

export interface BorealErrorClassification {
  readonly retryable: boolean;
  readonly recovery: BorealErrorRecovery;
}

type NotFoundDomain = "workflow" | "summary" | "evidence" | "lock" | "work";

export function classifyBorealError(
  code: BorealErrorCode | string,
  details?: unknown
): BorealErrorClassification {
  switch (code) {
    case "BOREAL_COMMAND_TIMEOUT":
    case "BOREAL_STORAGE_ERROR":
      return {
        retryable: true,
        recovery: {
          summary: "The command failed due to a transient runtime or storage condition. Inspect health before retrying.",
          nextCommand: "bwrk doctor --strict --json"
        }
      };
    case "BOREAL_COMMAND_OUTPUT_LIMIT":
      return {
        retryable: false,
        recovery: {
          summary: "The command output exceeded the configured limit. Re-run with narrower filters or inspect the spooled result path.",
          terminal: true
        }
      };
    case "BOREAL_NOT_FOUND":
      return {
        retryable: false,
        recovery: {
          summary: notFoundRecoverySummary(details),
          terminal: true
        }
      };
    case "BOREAL_CONFLICT":
      return {
        retryable: false,
        recovery: {
          summary: "The requested mutation conflicts with current runtime state. Inspect the returned details and refresh the work item before choosing a new action.",
          nextCommand: detailsWorkCommand(details),
          terminal: true
        }
      };
    case "BOREAL_POLICY_VIOLATION":
      return {
        retryable: false,
        recovery: {
          summary: "The command was refused by policy. Satisfy the reported gap or use an explicit force path when the workflow permits it.",
          nextCommand: policyRecoveryCommand(details),
          terminal: true
        }
      };
    case "BOREAL_INVALID_INPUT":
    case "BOREAL_JSON_PARSE":
    case "BOREAL_UNSAFE_UNICODE":
      return {
        retryable: false,
        recovery: {
          summary: "The command input is invalid. Correct the arguments or data before retrying.",
          terminal: true
        }
      };
    case "BOREAL_INVARIANT":
    default:
      return {
        retryable: false,
        recovery: {
          summary: "An internal invariant failed. Run doctor and report the command if the workspace is otherwise healthy.",
          nextCommand: "bwrk doctor --strict --json",
          terminal: true
        }
      };
  }
}

function detailsWorkCommand(details: unknown): string | undefined {
  const workId = stringField(details, "workId");
  return workId ? `bwrk work show ${workId} --json` : undefined;
}

function policyRecoveryCommand(details: unknown): string | undefined {
  const evidenceCommand = evidenceRecoveryCommand(details);
  if (evidenceCommand) {
    return evidenceCommand;
  }
  return detailsWorkCommand(details) ?? "bwrk gate closeout --strict --json";
}

function evidenceRecoveryCommand(details: unknown): string | undefined {
  const workId = stringField(details, "workId");
  if (!workId) {
    return undefined;
  }
  return `bwrk evidence add ${workId} --summary '<evidence summary>' --kind command --outcome passed --command '<validation command>' --json`;
}

function notFoundRecoverySummary(details: unknown): string {
  const closedBy = stringField(details, "closedBy");
  const closedAt = stringField(details, "closedAt");
  if (closedBy || closedAt) {
    return `The requested work is already terminal${closedBy ? `, closed by ${closedBy}` : ""}${closedAt ? ` at ${closedAt}` : ""}. No retry is needed unless you intend to reopen it.`;
  }
  switch (notFoundDomain(details)) {
    case "workflow":
      return "The referenced workflow was not found. Check the workflow id or workflows/... path, inspect details.didYouMean when present, or run `bwrk workflows list --json` before retrying.";
    case "summary":
      return "The referenced agent summary was not found. Re-check the bw_summary_ id against the subject summaries or re-run the summary-producing command before retrying.";
    case "evidence":
      return "The referenced evidence record was not found. Re-check the bw_evidence_ id against the subject evidence or add replacement evidence with `bwrk evidence add ... --json` before retrying.";
    case "lock":
      return "The referenced runtime lock was not found or is no longer active. Refresh runtime health with `bwrk doctor --strict --json` before retrying lock-sensitive actions.";
    case "work":
      return "The referenced work item or reservation does not exist in current state. Refresh the work item or queue before taking another action.";
    default:
      return "The referenced record does not exist in current state. Inspect the returned details and refresh the relevant view before taking another action.";
  }
}

function notFoundDomain(details: unknown): NotFoundDomain | undefined {
  const explicit = explicitRecordDomain(details);
  if (explicit) {
    return explicit;
  }
  const record = recordDetails(details);
  if (!record) {
    return undefined;
  }
  // Deprecated fallback for old spooled results and legacy throw sites that
  // predate explicit `details.domain` declarations.
  if (hasAnyField(record, ["workflowId", "workflowRef", "workflowRefs", "recoveryWorkflow", "normalizedRef", "didYouMean"])) {
    return "workflow";
  }
  if (workflowReference(stringField(record, "ref")) || workflowReference(stringField(record, "reference"))) {
    return "workflow";
  }
  if (hasAnyField(record, ["evidenceId", "evidenceIds", "missingEvidence", "missingEvidenceIds"])) {
    return "evidence";
  }
  if (hasAnyField(record, ["summaryId", "summaryIds", "agentSummaryId", "agentSummaryIds", "missingSummaryIds", "parentSummaryId", "childSummaryIds"])) {
    return "summary";
  }
  if (hasAnyField(record, ["lockId", "lockIds", "lockPath", "lockPaths", "lockName", "missingLockPath", "missingLockPaths"])) {
    return "lock";
  }
  if (
    hasAnyField(record, [
      "workId",
      "workIds",
      "sprintId",
      "reservationId",
      "reservationIds",
      "survivorId",
      "duplicateIds",
      "blockerId",
      "blockerIds",
      "dependencyId",
      "dependencyIds"
    ])
  ) {
    return "work";
  }
  if (detailsContainStringPrefix(record, "bw_evidence_")) {
    return "evidence";
  }
  if (detailsContainStringPrefix(record, "bw_summary_")) {
    return "summary";
  }
  if (detailsContainStringPrefix(record, "bw_work_") || detailsContainStringPrefix(record, "bw_reservation_")) {
    return "work";
  }
  if (detailsContainLockPath(record)) {
    return "lock";
  }
  return undefined;
}

function explicitRecordDomain(details: unknown): NotFoundDomain | undefined {
  const value = (stringField(details, "recordType") ?? stringField(details, "recordDomain") ?? stringField(details, "domain"))?.trim().toLowerCase();
  switch (value) {
    case "workflow":
    case "workflow_doc":
    case "workflow_asset":
      return "workflow";
    case "summary":
    case "agent_summary":
      return "summary";
    case "evidence":
      return "evidence";
    case "lock":
    case "runtime_lock":
      return "lock";
    case "work":
    case "reservation":
    case "sprint":
      return "work";
    default:
      return undefined;
  }
}

function hasAnyField(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => Object.hasOwn(record, key));
}

function workflowReference(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return value.startsWith("boreal.workflow.") || value.startsWith("workflows/") || (value.includes("/") && value.endsWith(".md"));
}

function detailsContainStringPrefix(value: unknown, prefix: string): boolean {
  if (typeof value === "string") {
    return value.startsWith(prefix);
  }
  if (Array.isArray(value)) {
    return value.some((item) => detailsContainStringPrefix(item, prefix));
  }
  const record = recordDetails(value);
  return record ? Object.values(record).some((item) => detailsContainStringPrefix(item, prefix)) : false;
}

function detailsContainLockPath(value: unknown): boolean {
  if (typeof value === "string") {
    return value.includes(".lock") || value.includes("/locks/");
  }
  if (Array.isArray(value)) {
    return value.some((item) => detailsContainLockPath(item));
  }
  const record = recordDetails(value);
  return record ? Object.values(record).some((item) => detailsContainLockPath(item)) : false;
}

function stringField(value: unknown, key: string): string | undefined {
  const record = recordDetails(value);
  if (!record) {
    return undefined;
  }
  const field = record[key];
  return typeof field === "string" && field.trim() ? field : undefined;
}

function recordDetails(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
