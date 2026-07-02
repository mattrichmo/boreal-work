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
  return "The referenced record or reservation does not exist in current state. Refresh the work item or queue before taking another action.";
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim() ? field : undefined;
}
