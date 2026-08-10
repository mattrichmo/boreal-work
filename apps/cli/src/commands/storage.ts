import { stat } from "node:fs/promises";

import {
  BorealError,
  type ClaimId,
  type DecisionId,
  type EvidenceId,
  type GraphEdgeId,
  type KnowledgeSourceId,
  type ProjectionId,
  type ReservationId,
  type VerificationId,
  type WorkId
} from "@boreal/core";
import { FileEventLog } from "@boreal/storage";

import { flagValue, hasFlag, requiredFlag, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import {
  createSnapshot,
  deleteClaimWithTombstone,
  deleteContextPackWithTombstone,
  deleteDecisionWithTombstone,
  deleteEvidenceWithTombstone,
  deleteGraphEdgeWithTombstone,
  deleteKnowledgeSourceWithTombstone,
  deleteProjectionWithTombstone,
  deleteReservationWithTombstone,
  deleteVerificationWithTombstone,
  deleteWorkItemWithTombstone,
  exportJson,
  exportLedgers,
  exportMarkdown,
  importJson,
  importLedgers,
  ledgerStatus,
  listSnapshots,
  showSnapshot
} from "../import-export.js";
import { withRuntimeWriteLock } from "../locks.js";
import { formatRecord, type CliOutput } from "../output.js";
import { migrateStorage } from "../storage-migrate.js";
import type { CommandResult } from "./shared.js";

type StorageCommandGroup = "storage" | "export" | "import" | "ledger" | "snapshot";

export interface StorageCommandDependencies {
  readonly requiredPositional: (values: readonly string[], index: number, label: string) => string;
  readonly asWorkId: (value: string) => WorkId;
  readonly asEvidenceId: (value: string) => EvidenceId;
  readonly asVerificationId: (value: string) => VerificationId;
  readonly asSourceId: (value: string) => KnowledgeSourceId;
  readonly asClaimId: (value: string) => ClaimId;
  readonly asDecisionId: (value: string) => DecisionId;
  readonly asGraphEdgeId: (value: string) => GraphEdgeId;
  readonly asReservationId: (value: string) => ReservationId;
  readonly asProjectionId: (value: string) => ProjectionId;
}

export async function storageCommand(
  group: StorageCommandGroup,
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: StorageCommandDependencies
): Promise<CommandResult> {
  switch (group) {
    case "storage":
      return storageMigrationCommand(action, context, args, output, json);
    case "export":
      return exportCommand(action, context, args, output, json);
    case "import":
      return importCommand(action, context, args, output, json);
    case "ledger":
      return ledgerCommand(action, rest, context, args, output, json, dependencies);
    case "snapshot":
      return snapshotCommand(action, rest, context, args, output, json, dependencies);
  }
}

async function storageMigrationCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "migrate": {
      const to = requiredFlag(args, "to");
      if (to !== "objects" && to !== "file") {
        throw new BorealError("BOREAL_INVALID_INPUT", "--to must be objects or file", { to });
      }
      output.write(formatRecord(await migrateStorage(context, to), json));
      return { exitCode: 0 };
    }
    case "rotate-log": {
      output.write(formatRecord(await rotateEventLog(context, flagValue(args, "max-bytes")), json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown storage command: ${action ?? ""}`);
  }
}

async function rotateEventLog(context: CliContext, maxBytesFlag: string | undefined) {
  return withRuntimeWriteLock(context, async () => {
    const maxBytes = maxBytesFlag === undefined ? undefined : parsePositiveInteger(maxBytesFlag, "--max-bytes");
    const sizeBytes = await stat(context.paths.eventLogFile).then((stats) => stats.size).catch((error) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return 0;
      }
      throw error;
    });
    const base = {
      path: context.paths.eventLogFile,
      sizeBytes,
      ...(maxBytes === undefined ? {} : { maxBytes })
    };
    if (maxBytes !== undefined && sizeBytes <= maxBytes) {
      return {
        ...base,
        rotated: false,
        skipped: true,
        reason: "below_max_bytes"
      };
    }
    const log = new FileEventLog({ path: context.paths.eventLogFile });
    const rotation = await log.rotate();
    return {
      ...base,
      rotated: true,
      skipped: false,
      ...rotation,
      verification: await log.verifyDeep()
    };
  });
}

async function exportCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "json": {
      output.write(formatRecord(await exportJson(context, flagValue(args, "out")), json));
      return { exitCode: 0 };
    }
    case "markdown": {
      output.write(formatRecord(await exportMarkdown(context, flagValue(args, "out")), json));
      return { exitCode: 0 };
    }
    case "ledgers": {
      output.write(formatRecord(await exportLedgers(context, flagValue(args, "out")), json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown export command: ${action ?? ""}`);
  }
}

async function importCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "json": {
      output.write(
        formatRecord(
          await importJson(context, requiredFlag(args, "from"), {
            allowExternalRead: hasFlag(args, "allow-external-read")
          }),
          json
        )
      );
      return { exitCode: 0 };
    }
    case "ledgers": {
      output.write(
        formatRecord(
          await importLedgers(context, requiredFlag(args, "from"), {
            allowExternalRead: hasFlag(args, "allow-external-read")
          }),
          json
        )
      );
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown import command: ${action ?? ""}`);
  }
}

async function ledgerCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: StorageCommandDependencies
): Promise<CommandResult> {
  switch (action) {
    case "status": {
      const status = await ledgerStatus(context, flagValue(args, "dir"));
      output.write(formatRecord(status, json));
      return { exitCode: status.ok ? 0 : 1 };
    }
    case "delete": {
      const kind = dependencies.requiredPositional(rest, 0, "ledger record kind");
      const id = dependencies.requiredPositional(rest, 1, "record id");
      const reason = flagValue(args, "reason");
      if (kind === "work") {
        output.write(formatRecord(await deleteWorkItemWithTombstone(context, dependencies.asWorkId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "evidence") {
        output.write(formatRecord(await deleteEvidenceWithTombstone(context, dependencies.asEvidenceId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "verification") {
        output.write(formatRecord(await deleteVerificationWithTombstone(context, dependencies.asVerificationId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "source") {
        output.write(formatRecord(await deleteKnowledgeSourceWithTombstone(context, dependencies.asSourceId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "claim") {
        output.write(formatRecord(await deleteClaimWithTombstone(context, dependencies.asClaimId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "decision") {
        output.write(formatRecord(await deleteDecisionWithTombstone(context, dependencies.asDecisionId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "graph-edge") {
        output.write(formatRecord(await deleteGraphEdgeWithTombstone(context, dependencies.asGraphEdgeId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "reservation") {
        output.write(formatRecord(await deleteReservationWithTombstone(context, dependencies.asReservationId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "projection") {
        output.write(formatRecord(await deleteProjectionWithTombstone(context, dependencies.asProjectionId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "context-pack") {
        output.write(formatRecord(await deleteContextPackWithTombstone(context, dependencies.asProjectionId(id), reason), json));
        return { exitCode: 0 };
      }
      throw new BorealError(
        "BOREAL_INVALID_INPUT",
        "ledger delete currently supports work, evidence, verification, source, claim, decision, graph-edge, reservation, projection, and context-pack records",
        { kind }
      );
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown ledger command: ${action ?? ""}`);
  }
}

async function snapshotCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: StorageCommandDependencies
): Promise<CommandResult> {
  switch (action) {
    case "create": {
      output.write(formatRecord(await createSnapshot(context, flagValue(args, "name")), json));
      return { exitCode: 0 };
    }
    case "list": {
      output.write(formatRecord(await listSnapshots(context), json));
      return { exitCode: 0 };
    }
    case "show": {
      output.write(formatRecord(await showSnapshot(context, dependencies.requiredPositional(rest, 0, "snapshot id")), json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown snapshot command: ${action ?? ""}`);
  }
}

function parsePositiveInteger(value: string, label: string): number {
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new BorealError("BOREAL_INVALID_INPUT", `${label} must be a positive integer`, { value });
  }
  return Number(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
