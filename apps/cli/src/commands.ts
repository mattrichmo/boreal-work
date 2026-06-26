import {
  BorealError,
  createRecordMeta,
  isBorealError,
  isIsoTimestamp,
  normalizeActorId,
  normalizeLabels,
  normalizeMachineString,
  normalizeSearchQuery,
  nowIso,
  randomId,
  touchRecord,
  withContentHash,
  type ActorRef,
  type AgentReservation,
  type ClaimId,
  type ClaimRecord,
  type ClaimStatus,
  type ContextPack,
  type DecisionId,
  type DecisionRecord,
  type DecisionStatus,
  type EventId,
  type EvidenceRecord,
  type EvidenceKind,
  type EvidenceOutcome,
  type GraphEdge,
  type IsoTimestamp,
  type KnowledgeSource,
  type KnowledgeSourceId,
  type KnowledgeSourceKind,
  type OperationId,
  type ReservationId,
  type ReservationStatus,
  type RuntimeOperation,
  type RuntimeOperationStatus,
  type RuntimeEvent,
  type VerificationId,
  type VerificationRecord,
  type VerificationVerdict,
  type WorkId,
  type WorkItem,
  type WorkKind,
  type WorkPriority,
  type WorkStatus
} from "@boreal/core";
import type { SearchResult } from "@boreal/search";
import { breakStaleFileLock, inspectFileLock } from "@boreal/storage";
import { toWorkItemView, type WorkItemView } from "@boreal/ui-model";
import { deriveReadinessStatus } from "@boreal/work-engine";

import { flagValue, flagValues, hasFlag, requiredFlag, type ParsedArgs } from "./args.js";
import {
  COMMAND_DEFINITIONS,
  commandBehavior,
  commandPath,
  findCommandDefinition,
  registryValueFlagNames,
  serializeCommandDefinition,
  validateCommandFlags,
  type CommandDefinition
} from "./command-registry.js";
import { asEvidenceId, asWorkId, runDoctor, type Diagnostic } from "./doctor.js";
import { assertInitialized, createCliContext, ensureWorkspaceDirs, type CliContext } from "./context.js";
import {
  createSnapshot,
  deleteClaimWithTombstone,
  deleteDecisionWithTombstone,
  deleteEvidenceWithTombstone,
  deleteKnowledgeSourceWithTombstone,
  deleteVerificationWithTombstone,
  deleteWorkItemWithTombstone,
  exportLedgers,
  exportJson,
  exportMarkdown,
  importLedgers,
  importJson,
  ledgerStatus,
  listSnapshots,
  showSnapshot
} from "./import-export.js";
import { createResultSpoolingOutput, formatRecord, table, type CliOutput } from "./output.js";
import { runSearch, writeSearchIndex } from "./search-cli.js";

const DEFAULT_HANDOFF_SEARCH_LIMIT = 8;
const HANDOFF_SEARCH_MIN_CANDIDATES = 24;
const HANDOFF_CONTEXT_CHUNK_LIMIT_RATIO = 3;

export interface CommandResult {
  readonly exitCode: number;
}

interface WorkListRow {
  readonly id: string;
  readonly status: WorkStatus;
  readonly priority: string;
  readonly title: string;
  readonly labels: readonly string[];
}

interface DependencyTreeNode {
  readonly id: string;
  readonly title?: string;
  readonly status?: WorkStatus;
  readonly missing?: boolean;
  readonly cycle?: boolean;
  readonly dependencies: readonly DependencyTreeNode[];
}

interface ReservationListRow {
  readonly id: string;
  readonly status: ReservationStatus;
  readonly expired: boolean;
  readonly agentId: string;
  readonly workId: string;
  readonly workStatus?: string;
  readonly workTitle?: string;
  readonly reservedAt: string;
  readonly expiresAt?: string;
  readonly purpose?: string;
}

interface OperationListRow {
  readonly id: string;
  readonly sessionId: string;
  readonly commandPath: string;
  readonly status: RuntimeOperationStatus;
  readonly exitCode: number;
  readonly stateChanged: boolean;
  readonly generatedArtifactsChanged: boolean;
  readonly actorId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly eventCount: number;
}

interface OperationPruneResult {
  readonly deleted: number;
  readonly keptBeforeOperationLog: number;
  readonly remainingAfterOperationLog: number;
  readonly keep?: number;
  readonly before?: IsoTimestamp;
  readonly deletedIds: readonly string[];
}

interface OperationRepairResult {
  readonly dryRun: boolean;
  readonly inspected: {
    readonly operations: number;
    readonly events: number;
  };
  readonly linkedEvents: readonly string[];
  readonly markedLegacyEvents: readonly string[];
  readonly repairedOperations: readonly string[];
  readonly removedDanglingEventRefs: Array<{ readonly operationId: string; readonly eventId: string }>;
  readonly removedConflictingEventRefs: Array<{
    readonly operationId: string;
    readonly eventId: string;
    readonly eventOperationId: string;
  }>;
  readonly ambiguousEvents: Array<{ readonly eventId: string; readonly operationIds: readonly string[] }>;
}

interface AgentStatus {
  readonly agentId: string;
  readonly labels: readonly string[];
  readonly policy: {
    readonly maxActiveReservations: number;
  };
  readonly reservations: {
    readonly activeCount: number;
    readonly expiredActiveCount: number;
    readonly capacityRemaining: number;
    readonly active: readonly ReservationListRow[];
    readonly expiredActive: readonly ReservationListRow[];
  };
  readonly readyWork: {
    readonly claimableCount: number;
    readonly next?: WorkListRow;
  };
  readonly recommendedAction: {
    readonly kind: string;
    readonly command?: string;
    readonly reason: string;
  };
}

interface AgentGuideStep {
  readonly step: string;
  readonly command: string;
  readonly when: string;
}

interface AgentGuide {
  readonly agentId: string;
  readonly labels: readonly string[];
  readonly commands: {
    readonly status: string;
    readonly start: string;
    readonly finish: string;
    readonly renew: string;
    readonly evidence: string;
    readonly verify: string;
    readonly close: string;
    readonly release: string;
    readonly doctor: string;
    readonly repair: string;
  };
  readonly loop: readonly AgentGuideStep[];
  readonly recovery: readonly AgentGuideStep[];
}

type AgentStartReason = "expired_active_reservations" | "reservation_capacity_reached" | "no_ready_work";

interface HandoffBundle {
  readonly work: WorkItemView;
  readonly contextPack: ContextPack;
  readonly search: {
    readonly query: string;
    readonly results: readonly SearchResult[];
  };
}

interface HandoffWarning {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

interface HandoffSuccess extends HandoffBundle {
  readonly handoffComplete: true;
  readonly warnings: readonly HandoffWarning[];
}

interface HandoffFailure {
  readonly handoffComplete: false;
  readonly work?: WorkItemView;
  readonly warnings: readonly HandoffWarning[];
  readonly repairCommand: string;
}

type HandoffResult = HandoffSuccess | HandoffFailure;

interface AgentStartBlocked {
  readonly started: false;
  readonly reason: AgentStartReason;
  readonly agentId: string;
  readonly labels: readonly string[];
  readonly status: AgentStatus;
  readonly recommendedAction: AgentStatus["recommendedAction"];
}

interface AgentStartReadyBase {
  readonly started: true;
  readonly action: "claimed_work" | "continue_reserved_work";
  readonly agentId: string;
  readonly labels: readonly string[];
  readonly status: AgentStatus;
  readonly reservation: AgentReservation;
  readonly releasedReservations: readonly AgentReservation[];
}

type AgentStartReady = AgentStartReadyBase & HandoffResult;

type AgentStartResult = AgentStartBlocked | AgentStartReady;

interface AgentFinishResult {
  readonly finished: true;
  readonly action: "verified_and_released" | "verified_and_closed";
  readonly agentId: string;
  readonly work: WorkItemView;
  readonly evidence: EvidenceRecord;
  readonly verification: VerificationRecord;
  readonly reservation: AgentReservation;
  readonly closedWork?: WorkItem;
  readonly release?: ReservationLifecycleResult;
  readonly status: AgentStatus;
}

interface ReservationLifecycleResult {
  readonly work: WorkItem;
  readonly reservation: AgentReservation;
}

export async function runCommand(args: ParsedArgs, output: CliOutput, cwd: string): Promise<CommandResult> {
  if (args.command.length === 0) {
    output.write(helpText());
    return { exitCode: 0 };
  }
  if (args.command[0] === "help") {
    output.write(helpText(args.command[1]));
    return { exitCode: 0 };
  }
  if (hasFlag(args, "help")) {
    output.write(helpText(args.command[0]));
    return { exitCode: 0 };
  }

  const definition = findCommandDefinition(args.command);
  if (!definition) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown command: ${args.command.join(" ")}`);
  }
  validateCommandFlags(args, definition);
  const json = hasFlag(args, "json");
  if (definition.path[0] === "commands") {
    return commandsCommand(output, json);
  }

  const shouldLogOperation = shouldRecordOperation(definition);
  const operationId = shouldLogOperation ? randomId<OperationId>("operation") : undefined;
  const context = await createCliContext(args, cwd, { operationId });
  const [group, action, ...rest] = args.command;
  if (definition.requiresWorkspace) {
    assertInitialized(context);
  }
  const startedAt = shouldLogOperation ? nowIso() : undefined;
  const eventIdsBefore = shouldLogOperation ? await listEventIds(context) : new Set<EventId>();
  const spoolingOutput = json
    ? createResultSpoolingOutput(output, {
        workspaceRoot: context.workspaceRoot,
        command: commandPath(definition),
        maxResultSizeChars: commandBehavior(definition).maxResultSizeChars
      })
    : undefined;
  const commandOutput = spoolingOutput ?? output;

  let result: CommandResult | undefined;
  let thrown: unknown;
  try {
    switch (group) {
      case "init":
        result = await initCommand(context, args, commandOutput, json);
        break;
      case "work":
        result = await workCommand(action, rest, context, args, commandOutput, json);
        break;
      case "dep":
        result = await depCommand(action, rest, context, args, commandOutput, json);
        break;
      case "evidence":
        result = await evidenceCommand(action, rest, context, args, commandOutput, json);
        break;
      case "source":
        result = await sourceCommand(action, rest, context, args, commandOutput, json);
        break;
      case "claim":
        result = await claimCommand(action, rest, context, args, commandOutput, json);
        break;
      case "decision":
        result = await decisionCommand(action, rest, context, args, commandOutput, json);
        break;
      case "context":
        result = await contextCommand(action, rest, context, args, commandOutput, json);
        break;
      case "search":
        result = await searchCommand(action, rest, context, args, commandOutput, json);
        break;
      case "reservation":
        result = await reservationCommand(action, context, args, commandOutput, json);
        break;
      case "agent":
        result = await agentCommand(action, rest, context, args, commandOutput, json);
        break;
      case "operation":
        result = await operationCommand(action, rest, context, args, commandOutput, json);
        break;
      case "export":
        result = await exportCommand(action, context, args, commandOutput, json);
        break;
      case "import":
        result = await importCommand(action, context, args, commandOutput, json);
        break;
      case "ledger":
        result = await ledgerCommand(action, rest, context, args, commandOutput, json);
        break;
      case "snapshot":
        result = await snapshotCommand(action, rest, context, args, commandOutput, json);
        break;
      case "doctor":
        result = await doctorCommand(context, args, commandOutput, json);
        break;
      case "lock":
        result = await lockCommand(action, context, args, commandOutput, json);
        break;
      default:
        throw new BorealError("BOREAL_INVALID_INPUT", `Unknown command: ${group ?? ""}`);
    }
  } catch (error) {
    thrown = error;
  }
  if (operationId && startedAt) {
    await recordCliOperation(context, operationId, definition, args, startedAt, eventIdsBefore, result, thrown);
  }
  if (thrown) {
    throw thrown;
  }
  await spoolingOutput?.flush();
  if (!result) {
    throw new BorealError("BOREAL_INVARIANT", "Command did not return a result");
  }
  return result;
}

async function operationCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "list": {
      const sessionId = optionalSessionId(flagValue(args, "session-id"));
      const command = optionalCommandPath(flagValue(args, "command"));
      const status = parseOperationStatus(flagValue(args, "status"));
      const limit = parseLimit(flagValue(args, "limit")) ?? 50;
      const rows = await context.store.read(async (reader) => {
        const operations = await reader.listOperations();
        return [...operations]
          .filter((operation) => !sessionId || operation.sessionId === sessionId)
          .filter((operation) => !command || operation.commandPath === command)
          .filter((operation) => !status || operation.status === status)
          .sort(compareOperationsNewestFirst)
          .slice(0, limit)
          .map(operationListRow);
      });
      output.write(json ? formatRecord(rows, true) : table(rows.map(textOperationListRow)));
      return { exitCode: 0 };
    }
    case "show": {
      const operation = await resolveOperation(context, requiredPositional(rest, 0, "operation id"));
      output.write(formatRecord(operation, json));
      return { exitCode: 0 };
    }
    case "prune": {
      output.write(formatRecord(await pruneOperations(context, args), json));
      return { exitCode: 0 };
    }
    case "repair": {
      output.write(formatRecord(await repairOperationLinks(context, hasFlag(args, "dry-run")), json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown operation command: ${action ?? ""}`);
  }
}

async function resolveOperation(context: CliContext, value: string): Promise<RuntimeOperation> {
  if (!value.startsWith("bw_operation_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected an operation id, got ${value}`);
  }
  const operations = await context.store.read((reader) => reader.listOperations());
  const exact = operations.find((operation) => operation.meta.id === value);
  if (exact) {
    return exact;
  }
  const minPrefixLength = "bw_operation_".length + 12;
  if (value.length < minPrefixLength) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Operation id prefix must include at least 12 hex characters, got ${value}`);
  }
  const candidates = operations.filter((operation) => operation.meta.id.startsWith(value));
  if (candidates.length === 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Operation not found", { operationId: value });
  }
  if (candidates.length > 1) {
    throw new BorealError("BOREAL_CONFLICT", "Operation id prefix is ambiguous", {
      operationId: value,
      candidates: candidates.map((operation) => operation.meta.id)
    });
  }
  return candidates[0] as RuntimeOperation;
}

async function pruneOperations(context: CliContext, args: ParsedArgs): Promise<OperationPruneResult> {
  const keep = parseOperationKeep(flagValue(args, "keep"));
  const before = parseOperationBefore(flagValue(args, "before"));
  if (keep === undefined && before === undefined) {
    throw new BorealError("BOREAL_INVALID_INPUT", "operation prune requires --keep or --before");
  }

  return context.store.write(async (writer) => {
    const operations = [...(await writer.listOperations())].sort(compareOperationsNewestFirst);
    const beforeMs = before ? Date.parse(before) : undefined;
    const eligibleByAge = operations.filter(
      (operation) => beforeMs === undefined || Date.parse(operation.finishedAt) >= beforeMs
    );
    const keepBeforeOperationLog = keep === undefined ? eligibleByAge.length : Math.max(0, keep - 1);
    const keptIds = new Set(eligibleByAge.slice(0, keepBeforeOperationLog).map((operation) => operation.meta.id));
    const deleted = operations.filter((operation) => !keptIds.has(operation.meta.id));
    for (const operation of deleted) {
      await writer.deleteOperation(operation.meta.id);
    }
    const keptBeforeOperationLog = operations.length - deleted.length;
    return {
      deleted: deleted.length,
      keptBeforeOperationLog,
      remainingAfterOperationLog: keptBeforeOperationLog + 1,
      keep,
      before,
      deletedIds: deleted.map((operation) => operation.meta.id)
    };
  });
}

async function repairOperationLinks(context: CliContext, dryRun: boolean): Promise<OperationRepairResult> {
  return context.store.write(async (writer) => {
    const events = await writer.listEvents();
    const operations = await writer.listOperations();
    const eventById = new Map(events.map((event) => [event.meta.id, event]));
    const operationById = new Map(operations.map((operation) => [operation.meta.id, operation]));
    const operationIdsByEvent = eventOperationReferences(operations);

    const updatedEvents = new Map<string, RuntimeEvent>();
    const updatedOperations = new Map<string, RuntimeOperation>();
    const linkedEvents: string[] = [];
    const markedLegacyEvents: string[] = [];
    const removedDanglingEventRefs: Array<{ operationId: string; eventId: string }> = [];
    const removedConflictingEventRefs: Array<{ operationId: string; eventId: string; eventOperationId: string }> = [];
    const ambiguousEvents: Array<{ eventId: string; operationIds: readonly string[] }> = [];
    const repairNow = nowIso();

    for (const operation of operations) {
      const nextEventIds = operation.eventIds.filter((eventId) => {
        const event = eventById.get(eventId);
        if (!event) {
          removedDanglingEventRefs.push({ operationId: operation.meta.id, eventId });
          return false;
        }
        if (event.operationId && event.operationId !== operation.meta.id) {
          removedConflictingEventRefs.push({
            operationId: operation.meta.id,
            eventId,
            eventOperationId: event.operationId
          });
          return false;
        }
        return true;
      });
      if (!arraysEqual(nextEventIds, operation.eventIds)) {
        updatedOperations.set(operation.meta.id, touchRecord({ ...operation, eventIds: nextEventIds }, repairNow, context.actor));
      }
    }

    for (const event of events) {
      const referencedBy = operationIdsByEvent.get(event.meta.id) ?? [];
      const retainedOperation = event.operationId ? operationById.get(event.operationId) : undefined;
      if (event.operationId && retainedOperation) {
        if (!retainedOperation.eventIds.some((eventId) => eventId === event.meta.id)) {
          const existing = updatedOperations.get(retainedOperation.meta.id) ?? retainedOperation;
          updatedOperations.set(
            retainedOperation.meta.id,
            touchRecord({ ...existing, eventIds: [...existing.eventIds, event.meta.id] }, repairNow, context.actor)
          );
        }
        if (event.operationLink === "legacy") {
          const { operationLink: _operationLink, ...nextEvent } = event;
          updatedEvents.set(event.meta.id, touchRecord(nextEvent, repairNow, context.actor));
        }
        continue;
      }

      if (event.operationId && !retainedOperation) {
        const { operationId: _operationId, ...legacyEvent } = event;
        updatedEvents.set(event.meta.id, legacyEventRecord(legacyEvent, repairNow, context.actor));
        markedLegacyEvents.push(event.meta.id);
        continue;
      }

      if (referencedBy.length === 1) {
        const nextEvent = { ...event, operationId: referencedBy[0] as OperationId, operationLink: undefined };
        updatedEvents.set(event.meta.id, touchRecord(nextEvent, repairNow, context.actor));
        linkedEvents.push(event.meta.id);
        continue;
      }

      if (referencedBy.length > 1) {
        ambiguousEvents.push({ eventId: event.meta.id, operationIds: referencedBy });
      }

      if (event.operationLink !== "legacy") {
        updatedEvents.set(event.meta.id, legacyEventRecord(event, repairNow, context.actor));
        markedLegacyEvents.push(event.meta.id);
      }
    }

    if (!dryRun) {
      for (const event of updatedEvents.values()) {
        await writer.putEvent(event);
      }
      for (const operation of updatedOperations.values()) {
        await writer.putOperation(operation);
      }
    }

    return {
      dryRun,
      inspected: {
        operations: operations.length,
        events: events.length
      },
      linkedEvents,
      markedLegacyEvents,
      repairedOperations: [...updatedOperations.keys()],
      removedDanglingEventRefs,
      removedConflictingEventRefs,
      ambiguousEvents
    };
  });
}

function eventOperationReferences(operations: readonly RuntimeOperation[]): ReadonlyMap<string, readonly OperationId[]> {
  const result = new Map<string, OperationId[]>();
  for (const operation of operations) {
    for (const eventId of operation.eventIds) {
      result.set(eventId, [...(result.get(eventId) ?? []), operation.meta.id]);
    }
  }
  return result;
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function legacyEventRecord<TEvent extends RuntimeEvent | Omit<RuntimeEvent, "operationId">>(
  event: TEvent,
  now: IsoTimestamp,
  actor: ActorRef
): TEvent {
  return touchRecord({ ...event, operationLink: "legacy" }, now, actor) as TEvent;
}

function operationListRow(operation: RuntimeOperation): OperationListRow {
  return {
    id: operation.meta.id,
    sessionId: operation.sessionId,
    commandPath: operation.commandPath,
    status: operation.status,
    exitCode: operation.exitCode,
    stateChanged: operation.stateChanged,
    generatedArtifactsChanged: operation.generatedArtifactsChanged,
    actorId: operation.actorId,
    startedAt: operation.startedAt,
    finishedAt: operation.finishedAt,
    eventCount: operation.eventIds.length
  };
}

function compareOperationsNewestFirst(left: RuntimeOperation, right: RuntimeOperation): number {
  return (
    Date.parse(right.finishedAt) - Date.parse(left.finishedAt) ||
    Date.parse(right.startedAt) - Date.parse(left.startedAt) ||
    right.meta.id.localeCompare(left.meta.id)
  );
}

function optionalSessionId(value: string | undefined): string | undefined {
  return value ? normalizeActorId(value) : undefined;
}

function optionalCommandPath(value: string | undefined): string | undefined {
  return value ? normalizeMachineString(value, "command path", { lowerCase: true }) : undefined;
}

function shouldRecordOperation(definition: CommandDefinition): boolean {
  return definition.requiresWorkspace || definition.path[0] === "init";
}

async function recordCliOperation(
  context: CliContext,
  operationId: OperationId,
  definition: CommandDefinition,
  args: ParsedArgs,
  startedAt: IsoTimestamp,
  eventIdsBefore: ReadonlySet<EventId>,
  result: CommandResult | undefined,
  error: unknown
): Promise<void> {
  const finishedAt = nowIso();
  const exitCode = error ? commandErrorExitCode(error) : result?.exitCode ?? 1;
  const behavior = commandBehavior(definition);
  const status = exitCode === 0 ? "succeeded" : "failed";
  const operation = {
    meta: createRecordMeta({
      id: operationId,
      now: finishedAt,
      actor: context.actor,
      tags: ["operation"]
    }),
    sessionId: context.sessionId,
    commandPath: commandPath(definition),
    argv: redactedArgv(definition, args),
    actorId: String(context.actor.id),
    startedAt,
    finishedAt,
    exitCode,
    status,
    stateChanged: status === "succeeded" && behavior.writesState,
    generatedArtifactsChanged: status === "succeeded" && behavior.writesGeneratedArtifacts,
    eventIds: [],
    ...operationErrorFields(error, exitCode)
  } satisfies RuntimeOperation;

  await context.store.write(async (writer) => {
    const eventIds = (await writer.listEvents())
      .filter((event) => !eventIdsBefore.has(event.meta.id) && event.operationId === operationId)
      .map((event) => event.meta.id);
    await writer.putOperation(withContentHash({ ...operation, eventIds } satisfies RuntimeOperation));
  });
}

async function listEventIds(context: CliContext): Promise<ReadonlySet<EventId>> {
  return new Set((await context.store.read((reader) => reader.listEvents())).map((event) => event.meta.id));
}

function commandErrorExitCode(error: unknown): number {
  return isBorealError(error) && (error.code === "BOREAL_INVALID_INPUT" || error.code === "BOREAL_UNSAFE_UNICODE")
    ? 2
    : 1;
}

function operationErrorFields(error: unknown, exitCode: number): Pick<RuntimeOperation, "errorCode" | "errorMessage"> {
  if (error) {
    return {
      errorCode: isBorealError(error) ? error.code : "BOREAL_UNEXPECTED_ERROR",
      errorMessage: isBorealError(error) ? error.code : "Unexpected command failure"
    };
  }
  return exitCode === 0 ? {} : { errorCode: "BOREAL_COMMAND_EXIT_NONZERO", errorMessage: "Command returned a non-zero exit code" };
}

function redactedArgv(definition: CommandDefinition, args: ParsedArgs): readonly string[] {
  const values: string[] = [...definition.path];
  const valueFlags = registryValueFlagNames();
  for (const [name, flagValuesForName] of args.flags.entries()) {
    for (const value of flagValuesForName) {
      if (valueFlags.has(name)) {
        values.push(`--${name}`, "<redacted>");
      } else if (value === "false") {
        values.push(`--${name}=false`);
      } else {
        values.push(`--${name}`);
      }
    }
  }
  return values;
}

function commandsCommand(output: CliOutput, json: boolean): CommandResult {
  const registry = {
    commands: COMMAND_DEFINITIONS.map(serializeCommandDefinition)
  };
  if (json) {
    output.write(formatRecord(registry, true));
  } else {
    output.write(
      table(
        COMMAND_DEFINITIONS.map((definition) => ({
          command: commandPath(definition),
          category: definition.category,
          workspace: definition.requiresWorkspace ? "yes" : "no",
          summary: definition.summary
        }))
      )
    );
  }
  return { exitCode: 0 };
}

async function agentCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "guide": {
      const guide = buildAgentGuide(agentIdFromArgs(args, context.actor.id), labelsFromArgs(args));
      output.write(json ? formatRecord(guide, true) : formatAgentGuide(guide));
      return { exitCode: 0 };
    }
    case "finish":
      return agentFinishCommand(rest, context, args, output, json);
    case "start":
      return agentStartCommand(context, args, output, json);
    case "status": {
      const agentId = agentIdFromArgs(args, context.actor.id);
      const labels = labelsFromArgs(args);
      output.write(formatRecord(await buildAgentStatus(context, agentId, labels), json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown agent command: ${action ?? ""}`);
  }
}

async function agentStartCommand(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const agentId = agentIdFromArgs(args, context.actor.id);
  const labels = labelsFromArgs(args);
  const status = await buildAgentStatus(context, agentId, labels);

  if (status.reservations.expiredActiveCount > 0) {
    output.write(formatRecord(agentStartBlocked(agentId, labels, status, "expired_active_reservations"), json));
    return { exitCode: 1 };
  }

  const activeReservation = status.reservations.active[0];
  if (activeReservation) {
    const reservation = await requireReservation(context, activeReservation.id);
    const handoff = await buildHandoffResult(context, asWorkId(activeReservation.workId), args);
    output.write(
      formatRecord(
        {
          started: true,
          action: "continue_reserved_work",
          agentId,
          labels,
          status: await buildAgentStatus(context, agentId, labels),
          reservation,
          releasedReservations: [],
          ...handoff
        } satisfies AgentStartResult,
        json
      )
    );
    return { exitCode: 0 };
  }

  if (status.reservations.capacityRemaining <= 0) {
    output.write(formatRecord(agentStartBlocked(agentId, labels, status, "reservation_capacity_reached"), json));
    return { exitCode: 1 };
  }

  const claim = await context.runtime.claimNextWork({
    agentId,
    labels,
    purpose: flagValue(args, "purpose"),
    expiresAt: parseReservationExpiresAt(args)
  });
  if (!claim) {
    const currentStatus = await buildAgentStatus(context, agentId, labels);
    output.write(formatRecord(agentStartBlocked(agentId, labels, currentStatus, "no_ready_work"), json));
    return { exitCode: 0 };
  }

  const handoff = await buildHandoffResult(context, claim.work.meta.id, args, claim.work);
  output.write(
    formatRecord(
      {
        started: true,
        action: "claimed_work",
        agentId,
        labels,
        status: await buildAgentStatus(context, agentId, labels),
        reservation: claim.reservation,
        releasedReservations: claim.releasedReservations,
        ...handoff
      } satisfies AgentStartResult,
      json
    )
  );
  return { exitCode: 0 };
}

async function agentFinishCommand(
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const workId = await resolveWorkId(context, requiredPositional(rest, 0, "work reference"));
  const agentId = agentIdFromArgs(args, context.actor.id);
  const verdict = parseVerdict(flagValue(args, "verdict"));
  const close = hasFlag(args, "close");
  const release = hasFlag(args, "release");

  if (close && release) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--close and --release cannot be used together");
  }
  if (!close && !release) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Agent finish requires --close or --release");
  }
  if (close && verdict !== "passed") {
    throw new BorealError("BOREAL_INVALID_INPUT", "--close requires a passed verification verdict");
  }

  const finished = await context.runtime.finishReservedWork({
    workId,
    agentId,
    evidence: {
      kind: parseEvidenceKind(flagValue(args, "kind")),
      summary: requiredFlag(args, "summary"),
      outcome: parseFinishOutcome(flagValue(args, "outcome"), verdict),
      command: flagValue(args, "command"),
      uri: flagValue(args, "uri")
    },
    verification: {
      verdict,
      notes: flagValue(args, "notes")
    },
    close: close ? { reason: requiredFlag(args, "reason") } : undefined,
    release
  });

  output.write(
    formatRecord(
      {
        finished: true,
        action: close ? "verified_and_closed" : "verified_and_released",
        agentId,
        work: await context.runtime.getWorkView(workId),
        evidence: finished.evidence,
        verification: finished.verification,
        reservation: finished.reservation,
        closedWork: finished.closedWork,
        release: finished.release,
        status: await buildAgentStatus(context, agentId, [])
      } satisfies AgentFinishResult,
      json
    )
  );
  return { exitCode: 0 };
}

async function reservationCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  if (action !== "list") {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown reservation command: ${action ?? ""}`);
  }

  const agentId = optionalAgentIdFromArgs(args);
  const workRef = flagValue(args, "work");
  const workId = workRef ? await resolveWorkId(context, workRef) : undefined;
  const status = parseReservationStatus(flagValue(args, "status"));
  const onlyExpired = hasFlag(args, "expired");
  const limit = parseLimit(flagValue(args, "limit"));
  const now = Date.now();
  const rows = await context.store.read(async (reader) => {
    const reservations = await reader.listReservations();
    const workItems = await reader.listWorkItems();
    const workById = new Map(workItems.map((work) => [work.meta.id, work]));
    return reservations
      .map((reservation) => reservationListRow(reservation, workById.get(reservation.workId), now))
      .filter((row) => !agentId || row.agentId === agentId)
      .filter((row) => !workId || row.workId === workId)
      .filter((row) => !status || row.status === status)
      .filter((row) => !onlyExpired || row.expired)
      .sort(compareReservationRows)
      .slice(0, limit ?? reservations.length);
  });
  output.write(json ? formatRecord(rows, true) : table(rows.map(textReservationListRow)));
  return { exitCode: 0 };
}

async function buildAgentStatus(
  context: CliContext,
  agentId: string,
  labels: readonly string[]
): Promise<AgentStatus> {
  const normalizedAgentId = normalizeActorId(agentId);
  const normalizedLabels = normalizeLabels(labels);
  const now = Date.now();
  const maxActiveReservations = context.runtime.policy.maxActiveReservationsPerAgent;
  return context.store.read(async (reader) => {
    const [reservations, workItems, graphEdges] = await Promise.all([
      reader.listReservations(),
      reader.listWorkItems(),
      reader.listGraphEdges()
    ]);
    const workById = new Map(workItems.map((work) => [work.meta.id, work]));
    const reservationRows = reservations.map((reservation) => reservationListRow(reservation, workById.get(reservation.workId), now));
    const active = reservationRows
      .filter((row) => row.agentId === normalizedAgentId && row.status === "active")
      .sort(compareReservationRows);
    const expiredActive = active.filter((row) => row.expired);
    const claimableWork = [...claimableWorkItems(workItems, normalizedLabels, graphEdges)].sort(compareWorkItems);
    const capacityRemaining = Math.max(0, maxActiveReservations - active.length);

    return {
      agentId: normalizedAgentId,
      labels: normalizedLabels,
      policy: {
        maxActiveReservations
      },
      reservations: {
        activeCount: active.length,
        expiredActiveCount: expiredActive.length,
        capacityRemaining,
        active,
        expiredActive
      },
      readyWork: {
        claimableCount: claimableWork.length,
        next: claimableWork[0] ? workListRow(claimableWork[0]) : undefined
      },
      recommendedAction: recommendedAgentAction({
        agentId: normalizedAgentId,
        labels: normalizedLabels,
        active,
        expiredActive,
        capacityRemaining,
        claimableWork
      })
    };
  });
}

async function initCommand(
  context: CliContext,
  _args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  await ensureWorkspaceDirs(context);
  const result = await context.runtime.ensureWorkspaceInitialized();
  output.write(
    formatRecord(
      { initialized: result.initialized, workspaceRoot: context.workspaceRoot, eventId: result.event.meta.id },
      json
    )
  );
  return { exitCode: 0 };
}

async function workCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "create": {
      const title = flagValue(args, "title") ?? rest.join(" ").trim();
      if (!title) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Work title is required");
      }
      const work = await context.runtime.createWork({
        title,
        description: flagValue(args, "description"),
        kind: parseWorkKind(flagValue(args, "kind")),
        priority: parsePriority(flagValue(args, "priority")),
        acceptanceCriteria: flagValues(args, "acceptance"),
        labels: labelsFromArgs(args),
        ready: hasFlag(args, "ready")
      });
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "ready": {
      const work = await context.runtime.markReady(await resolveWorkId(context, requiredPositional(rest, 0, "work reference")));
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "list": {
      const status = listStatus(args);
      const labels = labelsFromArgs(args);
      const limit = parseLimit(flagValue(args, "limit"));
      const items = await context.store.read((reader) =>
        reader.listWorkItems({
          status,
          labels: labels.length > 0 ? labels : undefined
        })
      );
      const rows = items.slice(0, limit ?? items.length).map(workListRow);
      output.write(json ? formatRecord(rows, true) : table(rows.map(textWorkListRow)));
      return { exitCode: 0 };
    }
    case "next": {
      const labels = labelsFromArgs(args);
      const limit = parseLimit(flagValue(args, "limit")) ?? 10;
      const views = await context.runtime.listReadyWork();
      const rows = views
        .filter((view) => labels.every((label) => view.labels.includes(label)))
        .sort(compareWorkViews)
        .slice(0, limit)
        .map(workViewListRow);
      output.write(json ? formatRecord(rows, true) : table(rows.map(textWorkListRow)));
      return { exitCode: 0 };
    }
    case "show": {
      const view = await context.runtime.getWorkView(await resolveWorkId(context, requiredPositional(rest, 0, "work reference")));
      output.write(formatRecord(view, json));
      return { exitCode: 0 };
    }
    case "block": {
      const blockedWorkId = await resolveWorkId(context, requiredPositional(rest, 0, "blocked work reference"));
      const blockingWorkId = await resolveWorkId(context, requiredPositional(rest, 1, "blocking work reference"));
      const work = await context.runtime.addBlockingDependency({ blockedWorkId, blockingWorkId });
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "reserve": {
      const work = await context.runtime.reserveWork({
        workId: await resolveWorkId(context, requiredPositional(rest, 0, "work reference")),
        agentId: agentIdFromArgs(args, context.actor.id),
        purpose: flagValue(args, "purpose"),
        expiresAt: parseReservationExpiresAt(args),
        force: hasFlag(args, "force"),
        forceReason: flagValue(args, "reason")
      });
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "claim": {
      const agentId = agentIdFromArgs(args, context.actor.id);
      const labels = labelsFromArgs(args);
      const claim = await context.runtime.claimNextWork({
        agentId,
        labels,
        purpose: flagValue(args, "purpose"),
        expiresAt: parseReservationExpiresAt(args)
      });
      if (!claim) {
        output.write(
          formatRecord(
            {
              claimed: false,
              reason: "no_ready_work",
              agentId,
              labels
            },
            json
          )
        );
        return { exitCode: 0 };
      }

      const handoff = await buildHandoffResult(context, claim.work.meta.id, args, claim.work);
      output.write(
        formatRecord(
          {
            claimed: true,
            work: handoff.work,
            reservation: claim.reservation,
            releasedReservations: claim.releasedReservations,
            ...handoff
          },
          json
        )
      );
      return { exitCode: 0 };
    }
    case "release": {
      const result = await context.runtime.releaseWorkReservation(
        await resolveWorkId(context, requiredPositional(rest, 0, "work reference"))
      );
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    case "renew": {
      const result = await context.runtime.renewWorkReservation({
        workId: await resolveWorkId(context, requiredPositional(rest, 0, "work reference")),
        expiresAt: requiredReservationExpiresAt(args)
      });
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    case "verify": {
      const evidenceIds = flagValues(args, "evidence").map(asEvidenceId);
      const verification = await context.runtime.verifyWork({
        workId: await resolveWorkId(context, requiredPositional(rest, 0, "work reference")),
        verdict: parseVerdict(flagValue(args, "verdict")),
        evidenceIds,
        notes: flagValue(args, "notes")
      });
      output.write(formatRecord(verification, json));
      return { exitCode: 0 };
    }
    case "close": {
      const work = await context.runtime.closeWork({
        workId: await resolveWorkId(context, requiredPositional(rest, 0, "work reference")),
        reason: requiredFlag(args, "reason")
      });
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown work command: ${action ?? ""}`);
  }
}

async function depCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "add": {
      const type = dependencyTypeFromArgs(args);
      const blockedWorkId = await resolveWorkId(context, requiredPositional(rest, 0, "dependent work reference"));
      const blockingWorkId = await resolveWorkId(context, requiredPositional(rest, 1, "dependency work reference"));
      const work = await context.runtime.addBlockingDependency({ blockedWorkId, blockingWorkId });
      output.write(formatRecord({ type, work }, json));
      return { exitCode: 0 };
    }
    case "tree": {
      const workId = await resolveWorkId(context, requiredPositional(rest, 0, "work reference"));
      const tree = await context.store.read(async (reader) =>
        dependencyTreeForWork(workId, await reader.listWorkItems(), await reader.listGraphEdges())
      );
      output.write(json ? formatRecord(tree, true) : table(dependencyTreeRows(tree)));
      return { exitCode: 0 };
    }
    case "cycles": {
      const cycles = await context.store.read(async (reader) => dependencyCyclesFromGraph(await reader.listGraphEdges()));
      output.write(
        json
          ? formatRecord(cycles, true)
          : table(cycles.map((cycle, index) => ({ cycle: index + 1, path: cycle.cycle.join(" -> ") })))
      );
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown dep command: ${action ?? ""}`);
  }
}

async function evidenceCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  if (action !== "add") {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown evidence command: ${action ?? ""}`);
  }

  const evidence = await context.runtime.recordEvidence({
    subjectId: await resolveWorkId(context, requiredPositional(rest, 0, "work reference")),
    subjectType: "work",
    kind: parseEvidenceKind(flagValue(args, "kind")),
    summary: requiredFlag(args, "summary"),
    outcome: parseOutcome(flagValue(args, "outcome")),
    command: flagValue(args, "command"),
    uri: flagValue(args, "uri")
  });
  output.write(formatRecord(evidence, json));
  return { exitCode: 0 };
}

async function sourceCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "add": {
      const source = await context.runtime.createKnowledgeSource({
        kind: parseSourceKind(flagValue(args, "kind")) ?? "document",
        title: requiredFlag(args, "title"),
        uri: requiredFlag(args, "uri"),
        summary: flagValue(args, "summary")
      });
      output.write(formatRecord(source, json));
      return { exitCode: 0 };
    }
    case "list": {
      const kind = parseSourceKind(flagValue(args, "kind"));
      const limit = parseLimit(flagValue(args, "limit"));
      const sources = await context.runtime.listKnowledgeSources();
      const rows = sources
        .filter((source) => !kind || source.kind === kind)
        .slice(0, limit ?? sources.length)
        .map(sourceListRow);
      output.write(json ? formatRecord(rows, true) : table(rows));
      return { exitCode: 0 };
    }
    case "show": {
      const source = await context.runtime.getKnowledgeSource(asSourceId(requiredPositional(rest, 0, "source id")));
      output.write(formatRecord(source, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown source command: ${action ?? ""}`);
  }
}

async function claimCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "create": {
      const claim = await context.runtime.createClaim({
        statement: requiredFlag(args, "statement"),
        status: parseClaimStatus(flagValue(args, "status")),
        sourceIds: flagValues(args, "source").map(asSourceId),
        evidenceIds: flagValues(args, "evidence").map(asEvidenceId)
      });
      output.write(formatRecord(claim, json));
      return { exitCode: 0 };
    }
    case "list": {
      const status = parseClaimStatus(flagValue(args, "status"));
      const sourceId = optionalSourceId(flagValue(args, "source"));
      const limit = parseLimit(flagValue(args, "limit"));
      const claims = await context.runtime.listClaims();
      const rows = claims
        .filter((claim) => !status || claim.status === status)
        .filter((claim) => !sourceId || claim.sourceIds.includes(sourceId))
        .slice(0, limit ?? claims.length)
        .map(claimListRow);
      output.write(json ? formatRecord(rows, true) : table(rows));
      return { exitCode: 0 };
    }
    case "show": {
      const claim = await context.runtime.getClaim(asClaimId(requiredPositional(rest, 0, "claim id")));
      output.write(formatRecord(claim, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown claim command: ${action ?? ""}`);
  }
}

async function decisionCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "create": {
      const decision = await context.runtime.createDecision({
        title: requiredFlag(args, "title"),
        context: flagValue(args, "context") ?? "",
        decision: requiredFlag(args, "decision"),
        status: parseDecisionStatus(flagValue(args, "status")),
        consequences: flagValues(args, "consequence"),
        sourceIds: flagValues(args, "source").map(asSourceId)
      });
      output.write(formatRecord(decision, json));
      return { exitCode: 0 };
    }
    case "list": {
      const status = parseDecisionStatus(flagValue(args, "status"));
      const sourceId = optionalSourceId(flagValue(args, "source"));
      const limit = parseLimit(flagValue(args, "limit"));
      const decisions = await context.runtime.listDecisions();
      const rows = decisions
        .filter((decision) => !status || decision.status === status)
        .filter((decision) => !sourceId || decision.sourceIds.includes(sourceId))
        .slice(0, limit ?? decisions.length)
        .map(decisionListRow);
      output.write(json ? formatRecord(rows, true) : table(rows));
      return { exitCode: 0 };
    }
    case "show": {
      const decision = await context.runtime.getDecision(asDecisionId(requiredPositional(rest, 0, "decision id")));
      output.write(formatRecord(decision, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown decision command: ${action ?? ""}`);
  }
}

async function contextCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "rebuild": {
      const views = await context.runtime.rebuildProjections();
      output.write(formatRecord({ rebuilt: views.length, views }, json));
      return { exitCode: 0 };
    }
    case "show": {
      const pack = await context.runtime.getContextPack(await resolveWorkId(context, requiredPositional(rest, 0, "work reference")));
      output.write(formatRecord(pack, json));
      return { exitCode: 0 };
    }
    case "search": {
      const results = await runSearch(context, rest.join(" "), {
        limit: parseLimit(flagValue(args, "limit")),
        types: ["context_pack", "context_chunk"],
        explain: hasFlag(args, "explain")
      });
      output.write(json ? formatRecord(results, true) : table(results.map(searchResultRow)));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown context command: ${action ?? ""}`);
  }
}

async function searchCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "index": {
      output.write(formatRecord(await writeSearchIndex(context), json));
      return { exitCode: 0 };
    }
    case "query": {
      const results = await runSearch(context, rest.join(" "), {
        limit: parseLimit(flagValue(args, "limit")),
        explain: hasFlag(args, "explain")
      });
      output.write(json ? formatRecord(results, true) : table(results.map(searchResultRow)));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown search command: ${action ?? ""}`);
  }
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
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "status": {
      const status = await ledgerStatus(context, flagValue(args, "dir"));
      output.write(formatRecord(status, json));
      return { exitCode: status.ok ? 0 : 1 };
    }
    case "delete": {
      const kind = requiredPositional(rest, 0, "ledger record kind");
      const id = requiredPositional(rest, 1, "record id");
      const reason = flagValue(args, "reason");
      if (kind === "work") {
        output.write(formatRecord(await deleteWorkItemWithTombstone(context, asWorkId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "evidence") {
        output.write(formatRecord(await deleteEvidenceWithTombstone(context, asEvidenceId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "verification") {
        output.write(formatRecord(await deleteVerificationWithTombstone(context, asVerificationId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "source") {
        output.write(formatRecord(await deleteKnowledgeSourceWithTombstone(context, asSourceId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "claim") {
        output.write(formatRecord(await deleteClaimWithTombstone(context, asClaimId(id), reason), json));
        return { exitCode: 0 };
      }
      if (kind === "decision") {
        output.write(formatRecord(await deleteDecisionWithTombstone(context, asDecisionId(id), reason), json));
        return { exitCode: 0 };
      }
      throw new BorealError(
        "BOREAL_INVALID_INPUT",
        "ledger delete currently supports work, evidence, verification, source, claim, and decision records",
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
  json: boolean
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
      output.write(formatRecord(await showSnapshot(context, requiredPositional(rest, 0, "snapshot id")), json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown snapshot command: ${action ?? ""}`);
  }
}

async function doctorCommand(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const result = await runDoctor(context, hasFlag(args, "fix"), hasFlag(args, "strict"));
  if (json) {
    output.write(formatRecord(result, true));
  } else {
    output.write(result.diagnostics.map(formatDiagnostic).join("\n") + "\n");
  }
  return { exitCode: result.ok ? 0 : 1 };
}

async function lockCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "inspect": {
      const inspection = await inspectFileLock(context.paths.stateLockDir);
      output.write(formatRecord(inspection, json));
      return { exitCode: 0 };
    }
    case "break": {
      if (!hasFlag(args, "stale-only")) {
        throw new BorealError("BOREAL_INVALID_INPUT", "`bwrk lock break` requires --stale-only");
      }
      const result = await breakStaleFileLock(context.paths.stateLockDir);
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown lock command: ${action ?? ""}`);
  }
}

function requiredPositional(values: readonly string[], index: number, label: string): string {
  const value = values[index];
  if (!value) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Missing ${label}`);
  }
  return value;
}

function asSourceId(value: string): KnowledgeSourceId {
  if (!value.startsWith("bw_source_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected a source id, got ${value}`);
  }
  return value as KnowledgeSourceId;
}

function asClaimId(value: string): ClaimId {
  if (!value.startsWith("bw_claim_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected a claim id, got ${value}`);
  }
  return value as ClaimId;
}

function asDecisionId(value: string): DecisionId {
  if (!value.startsWith("bw_decision_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected a decision id, got ${value}`);
  }
  return value as DecisionId;
}

function asVerificationId(value: string): VerificationId {
  if (!value.startsWith("bw_verification_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected a verification id, got ${value}`);
  }
  return value as VerificationId;
}

function parseWorkKind(value: string | undefined): WorkKind | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "issue" || value === "task" || value === "sprint" || value === "milestone") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--kind must be issue, task, sprint, or milestone");
}

function parsePriority(value: string | undefined): WorkPriority | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "low" || value === "normal" || value === "high" || value === "critical") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--priority must be low, normal, high, or critical");
}

function listStatus(args: ParsedArgs): WorkStatus | undefined {
  const status = parseWorkStatus(flagValue(args, "status"));
  if (!hasFlag(args, "ready")) {
    return status;
  }
  if (status && status !== "ready") {
    throw new BorealError("BOREAL_INVALID_INPUT", "--ready cannot be combined with a different --status value");
  }
  return "ready";
}

function parseWorkStatus(value: string | undefined): WorkStatus | undefined {
  if (!value) {
    return undefined;
  }
  if (
    value === "draft" ||
    value === "ready" ||
    value === "reserved" ||
    value === "in_progress" ||
    value === "blocked" ||
    value === "needs_verification" ||
    value === "verified" ||
    value === "closed" ||
    value === "cancelled"
  ) {
    return value;
  }
  throw new BorealError(
    "BOREAL_INVALID_INPUT",
    "--status must be draft, ready, reserved, in_progress, blocked, needs_verification, verified, closed, or cancelled"
  );
}

function dependencyTypeFromArgs(args: ParsedArgs): "blocks" {
  const type = flagValue(args, "type") ?? "blocks";
  if (type !== "blocks") {
    throw new BorealError("BOREAL_INVALID_INPUT", "Only --type blocks is currently supported");
  }
  return "blocks";
}

function parseReservationStatus(value: string | undefined): ReservationStatus | undefined {
  if (!value) {
    return "active";
  }
  if (value === "all") {
    return undefined;
  }
  if (value === "active" || value === "released" || value === "expired") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--status must be active, released, expired, or all");
}

function parseOperationStatus(value: string | undefined): RuntimeOperationStatus | undefined {
  if (!value || value === "all") {
    return undefined;
  }
  if (value === "succeeded" || value === "failed") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--status must be succeeded, failed, or all");
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--limit must be a positive integer");
  }
  return parsed;
}

function parseOperationKeep(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--keep must be a positive integer");
  }
  return parsed;
}

function parseOperationBefore(value: string | undefined): IsoTimestamp | undefined {
  if (!value) {
    return undefined;
  }
  if (!isIsoTimestamp(value)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--before must be an ISO timestamp");
  }
  return value;
}

function parseReservationExpiresAt(args: ParsedArgs): IsoTimestamp | undefined {
  const expiresAt = flagValue(args, "expires-at");
  const ttl = flagValue(args, "ttl");
  if (expiresAt && ttl) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--expires-at cannot be combined with --ttl");
  }
  if (expiresAt) {
    if (!isIsoTimestamp(expiresAt)) {
      throw new BorealError("BOREAL_INVALID_INPUT", "--expires-at must be an ISO timestamp");
    }
    return expiresAt;
  }
  if (ttl) {
    return expiresAtFromTtl(ttl);
  }
  return undefined;
}

function requiredReservationExpiresAt(args: ParsedArgs): IsoTimestamp {
  const expiresAt = parseReservationExpiresAt(args);
  if (!expiresAt) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Reservation renewal requires --expires-at or --ttl");
  }
  return expiresAt;
}

function expiresAtFromTtl(value: string): IsoTimestamp {
  const match = /^([1-9][0-9]*)(s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--ttl must be a positive duration like 30m, 2h, or 1d");
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "s" ? 1_000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return new Date(Date.now() + amount * multiplier).toISOString() as IsoTimestamp;
}

function parseEvidenceKind(value: string | undefined): EvidenceKind {
  const kind = value ?? "command";
  if (kind === "command" || kind === "test" || kind === "diff" || kind === "review" || kind === "artifact" || kind === "note") {
    return kind;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--kind must be command, test, diff, review, artifact, or note");
}

function parseOutcome(value: string | undefined): EvidenceOutcome {
  const outcome = value ?? "observed";
  if (outcome === "passed" || outcome === "failed" || outcome === "observed" || outcome === "unknown") {
    return outcome;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--outcome must be passed, failed, observed, or unknown");
}

function parseFinishOutcome(value: string | undefined, verdict: VerificationVerdict): EvidenceOutcome {
  if (value) {
    return parseOutcome(value);
  }
  return verdict === "passed" ? "passed" : "failed";
}

function parseSourceKind(value: string | undefined): KnowledgeSourceKind | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "raw" || value === "document" || value === "chat" || value === "code" || value === "artifact") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--kind must be raw, document, chat, code, or artifact");
}

function parseClaimStatus(value: string | undefined): ClaimStatus | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "proposed" || value === "accepted" || value === "rejected" || value === "stale") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--status must be proposed, accepted, rejected, or stale");
}

function parseDecisionStatus(value: string | undefined): DecisionStatus | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "proposed" || value === "accepted" || value === "superseded" || value === "rejected") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--status must be proposed, accepted, superseded, or rejected");
}

function parseVerdict(value: string | undefined): VerificationVerdict {
  const verdict = value ?? "passed";
  if (verdict === "passed" || verdict === "failed") {
    return verdict;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--verdict must be passed or failed");
}

function optionalSourceId(value: string | undefined): KnowledgeSourceId | undefined {
  return value ? asSourceId(value) : undefined;
}

function agentIdFromArgs(args: ParsedArgs, fallback: string): string {
  return normalizeActorId(flagValue(args, "agent") ?? fallback);
}

function optionalAgentIdFromArgs(args: ParsedArgs): string | undefined {
  const value = flagValue(args, "agent");
  return value ? normalizeActorId(value) : undefined;
}

function labelsFromArgs(args: ParsedArgs): readonly string[] {
  return normalizeLabels(flagValues(args, "label"));
}

async function resolveWorkId(context: CliContext, value: string): Promise<WorkId> {
  return context.runtime.resolveWorkReference(value);
}

async function requireReservation(context: CliContext, reservationId: string): Promise<AgentReservation> {
  const reservation = await context.store.read((reader) => reader.getReservation(reservationId as ReservationId));
  if (!reservation || reservation.status !== "active") {
    throw new BorealError("BOREAL_CONFLICT", "Active reservation changed while starting agent", { reservationId });
  }
  return reservation;
}

async function buildHandoffBundle(context: CliContext, workId: WorkId, args: ParsedArgs): Promise<HandoffBundle> {
  await context.runtime.rebuildProjections();
  const [work, contextPack] = await Promise.all([context.runtime.getWorkView(workId), context.runtime.getContextPack(workId)]);
  await writeSearchIndex(context);
  const queryFlag = flagValue(args, "query");
  const query = queryFlag ? normalizeSearchQuery(queryFlag) : handoffSearchQuery(work, contextPack);
  const resultLimit = parseLimit(flagValue(args, "limit")) ?? DEFAULT_HANDOFF_SEARCH_LIMIT;
  const candidates = await runSearch(context, query, {
    limit: Math.max(resultLimit * HANDOFF_CONTEXT_CHUNK_LIMIT_RATIO, HANDOFF_SEARCH_MIN_CANDIDATES)
  });
  return {
    work,
    contextPack,
    search: {
      query,
      results: diversifyHandoffSearchResults(candidates, resultLimit)
    }
  };
}

async function buildHandoffResult(
  context: CliContext,
  workId: WorkId,
  args: ParsedArgs,
  fallbackWork?: WorkItem
): Promise<HandoffResult> {
  try {
    return {
      handoffComplete: true,
      warnings: [],
      ...(await buildHandoffBundle(context, workId, args))
    };
  } catch (error) {
    return {
      handoffComplete: false,
      work: await fallbackWorkView(context, workId, fallbackWork),
      warnings: [handoffFailureWarning(error)],
      repairCommand: "bwrk doctor --fix --json"
    };
  }
}

async function fallbackWorkView(
  context: CliContext,
  workId: WorkId,
  fallbackWork: WorkItem | undefined
): Promise<WorkItemView | undefined> {
  if (fallbackWork) {
    return toWorkItemView({ work: fallbackWork });
  }
  const work = await context.store.read((reader) => reader.getWorkItem(workId));
  return work ? toWorkItemView({ work }) : undefined;
}

function handoffFailureWarning(error: unknown): HandoffWarning {
  return {
    code: "handoff.failed",
    message: "Handoff generation failed after reservation; run the repair command before relying on context or search.",
    details: errorDetails(error)
  };
}

function errorDetails(error: unknown): unknown {
  if (error instanceof BorealError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    };
  }
  if (error instanceof Error) {
    return {
      message: error.message
    };
  }
  return String(error);
}

function agentStartBlocked(
  agentId: string,
  labels: readonly string[],
  status: AgentStatus,
  reason: AgentStartReason
): AgentStartBlocked {
  return {
    started: false,
    reason,
    agentId,
    labels,
    status,
    recommendedAction: status.recommendedAction
  };
}

function buildAgentGuide(agentId: string, labels: readonly string[]): AgentGuide {
  const normalizedAgentId = normalizeActorId(agentId);
  const normalizedLabels = normalizeLabels(labels);
  const agentFlag = `--agent ${shellArg(normalizedAgentId)}`;
  const scopedFlags = `${agentFlag}${labelFlags(normalizedLabels)}`;
  const commands = {
    status: `bwrk agent status ${scopedFlags} --json`,
    start: `bwrk agent start ${scopedFlags} --purpose ${shellArg("start implementation")} --json`,
    finish:
      `bwrk agent finish <work-id> ${agentFlag} --summary ${shellArg("implemented and tested")} ` +
      `--command ${shellArg("pnpm test")} --close --reason ${shellArg("verified by evidence")} --json`,
    renew: "bwrk work renew <work-id> --ttl 2h --json",
    evidence:
      "bwrk evidence add <work-id> --summary 'implemented and tested' --kind command --outcome passed --command 'pnpm test' --json",
    verify: "bwrk work verify <work-id> --evidence <evidence-id> --verdict passed --json",
    close: "bwrk work close <work-id> --reason 'verified by evidence' --json",
    release: "bwrk work release <work-id> --json",
    doctor: "bwrk doctor --json",
    repair: "bwrk doctor --fix --json"
  };
  return {
    agentId: normalizedAgentId,
    labels: normalizedLabels,
    commands,
    loop: [
      {
        step: "Check coordination state",
        command: commands.status,
        when: "Use before work and after repair to see stale reservations, capacity, and the next recommended action."
      },
      {
        step: "Start or resume work",
        command: commands.start,
        when: "Use as the normal entrypoint; it resumes active work before claiming another ready item."
      },
      {
        step: "Renew if work continues",
        command: commands.renew,
        when: "Use before the reservation TTL expires when the same agent is still actively working."
      },
      {
        step: "Finish with evidence",
        command: commands.finish,
        when: "Use after implementation or investigation to record evidence, verify, close, and release in one guarded exit."
      },
      {
        step: "Release if stopping",
        command: commands.release,
        when: "Use when handing the item back before it is verified or closed."
      }
    ],
    recovery: [
      {
        step: "Inspect workspace health",
        command: commands.doctor,
        when: "Use when start/status reports stale state, missing projections, or inconsistent reservations."
      },
      {
        step: "Repair safe diagnostics",
        command: commands.repair,
        when: "Use for stale active reservations and repairable projections before trying agent start again."
      },
      {
        step: "Recheck coordination state",
        command: commands.status,
        when: "Use after repair to confirm capacity and the next recommended action."
      }
    ]
  };
}

function formatAgentGuide(guide: AgentGuide): string {
  const labels = guide.labels.length > 0 ? guide.labels.join(", ") : "(none)";
  return [
    "Boreal agent guide",
    "",
    `Agent: ${guide.agentId}`,
    `Labels: ${labels}`,
    "",
    "Loop:",
    ...formatGuideSteps(guide.loop),
    "",
    "Recovery:",
    ...formatGuideSteps(guide.recovery)
  ].join("\n") + "\n";
}

function formatGuideSteps(steps: readonly AgentGuideStep[]): readonly string[] {
  return steps.map((step, index) => `${index + 1}. ${step.step}\n   ${step.command.replace(/\n/gu, "\n   ")}\n   ${step.when}`);
}

function isWorkItem(value: WorkItem | undefined): value is WorkItem {
  return value !== undefined;
}

function workListRow(work: {
  readonly meta: { readonly id: string };
  readonly title: string;
  readonly status: WorkStatus;
  readonly priority: string;
  readonly labels: readonly string[];
}): WorkListRow {
  return {
    id: work.meta.id,
    status: work.status,
    priority: work.priority,
    title: work.title,
    labels: [...work.labels]
  };
}

function reservationListRow(
  reservation: AgentReservation,
  work: { readonly title: string; readonly status: WorkStatus } | undefined,
  now: number
): ReservationListRow {
  const expiresAt = reservation.expiresAt;
  return {
    id: reservation.meta.id,
    status: reservation.status,
    expired: expiresAt !== undefined && Date.parse(expiresAt) <= now,
    agentId: String(reservation.agentId),
    workId: reservation.workId,
    workStatus: work?.status,
    workTitle: work?.title,
    reservedAt: reservation.reservedAt,
    expiresAt,
    purpose: reservation.purpose
  };
}

function claimableWorkItems(
  workItems: readonly WorkItem[],
  labels: readonly string[],
  graphEdges: readonly GraphEdge[]
): readonly WorkItem[] {
  const workById = new Map(workItems.map((work) => [work.meta.id, work]));
  const dependencyIdsByWork = dependencyIdsByWorkFromGraph(workItems, graphEdges);
  return workItems.filter((work) => {
    if (work.status !== "ready" || work.reservationId) {
      return false;
    }
    if (!labels.every((label) => work.labels.includes(label))) {
      return false;
    }
    const dependencyIds = dependencyIdsByWork.get(work.meta.id) ?? [];
    const dependencies = dependencyIds.map((dependencyId) => workById.get(dependencyId)).filter(isWorkItem);
    if (dependencies.length !== dependencyIds.length) {
      return false;
    }
    return deriveReadinessStatus({ ...work, dependencyIds }, dependencies) === "ready";
  });
}

function dependencyIdsByWorkFromGraph(
  workItems: readonly WorkItem[],
  graphEdges: readonly GraphEdge[]
): ReadonlyMap<WorkId, readonly WorkId[]> {
  const workIds = new Set(workItems.map((work) => work.meta.id));
  const dependencyIdsByWork = new Map<WorkId, WorkId[]>();
  for (const work of workItems) {
    dependencyIdsByWork.set(work.meta.id, []);
  }
  for (const edge of graphEdges) {
    if (edge.kind !== "blocks" || edge.fromType !== "work" || edge.toType !== "work" || !workIds.has(edge.toId as WorkId)) {
      continue;
    }
    const workId = edge.toId as WorkId;
    dependencyIdsByWork.set(workId, [...(dependencyIdsByWork.get(workId) ?? []), edge.fromId as WorkId]);
  }
  return new Map(
    [...dependencyIdsByWork.entries()].map(([workId, dependencyIds]) => [
      workId,
      [...new Set(dependencyIds)].sort((left, right) => left.localeCompare(right))
    ])
  );
}

function dependencyTreeForWork(
  workId: WorkId,
  workItems: readonly WorkItem[],
  graphEdges: readonly GraphEdge[]
): DependencyTreeNode {
  const workById = new Map(workItems.map((work) => [work.meta.id, work]));
  const dependencyIdsByWork = dependencyIdsByWorkFromGraph(workItems, graphEdges);
  return dependencyTreeNode(workId, workById, dependencyIdsByWork, []);
}

function dependencyTreeNode(
  workId: WorkId,
  workById: ReadonlyMap<WorkId, WorkItem>,
  dependencyIdsByWork: ReadonlyMap<WorkId, readonly WorkId[]>,
  path: readonly WorkId[]
): DependencyTreeNode {
  const work = workById.get(workId);
  if (path.includes(workId)) {
    return {
      id: workId,
      title: work?.title,
      status: work?.status,
      missing: work === undefined ? true : undefined,
      cycle: true,
      dependencies: []
    };
  }
  return {
    id: workId,
    title: work?.title,
    status: work?.status,
    missing: work === undefined ? true : undefined,
    dependencies: (dependencyIdsByWork.get(workId) ?? []).map((dependencyId) =>
      dependencyTreeNode(dependencyId, workById, dependencyIdsByWork, [...path, workId])
    )
  };
}

function dependencyTreeRows(tree: DependencyTreeNode): Array<Record<string, string | number>> {
  const rows: Array<Record<string, string | number>> = [];
  const visit = (node: DependencyTreeNode, depth: number): void => {
    rows.push({
      depth,
      id: node.id,
      status: node.status ?? (node.missing ? "missing" : ""),
      title: node.title ?? "",
      flags: [node.cycle ? "cycle" : "", node.missing ? "missing" : ""].filter(Boolean).join(",")
    });
    for (const dependency of node.dependencies) {
      visit(dependency, depth + 1);
    }
  };
  visit(tree, 0);
  return rows;
}

function dependencyCyclesFromGraph(graphEdges: readonly GraphEdge[]): Array<{ readonly cycle: readonly string[] }> {
  const adjacency = new Map<string, string[]>();
  for (const edge of graphEdges) {
    if (edge.kind !== "blocks" || edge.fromType !== "work" || edge.toType !== "work") {
      continue;
    }
    adjacency.set(edge.fromId, [...(adjacency.get(edge.fromId) ?? []), edge.toId].sort((left, right) => left.localeCompare(right)));
  }

  const cycles = new Map<string, readonly string[]>();
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (workId: string): void => {
    const existingIndex = path.indexOf(workId);
    if (existingIndex >= 0) {
      const cycle = [...path.slice(existingIndex), workId];
      cycles.set(cycleKey(cycle), cycle);
      return;
    }
    if (visited.has(workId)) {
      return;
    }
    path.push(workId);
    for (const next of adjacency.get(workId) ?? []) {
      visit(next);
    }
    path.pop();
    visited.add(workId);
  };

  for (const workId of [...adjacency.keys()].sort((left, right) => left.localeCompare(right))) {
    visit(workId);
  }
  return [...cycles.values()].map((cycle) => ({ cycle })).sort((left, right) => left.cycle.join("|").localeCompare(right.cycle.join("|")));
}

function cycleKey(cycle: readonly string[]): string {
  const values = cycle.slice(0, -1);
  const rotations = values.map((_, index) => [...values.slice(index), ...values.slice(0, index)].join("|"));
  return rotations.sort()[0] ?? cycle.join("|");
}

function workViewListRow(view: WorkItemView): WorkListRow {
  return {
    id: view.id,
    status: view.status,
    priority: view.priority,
    title: view.title,
    labels: [...view.labels]
  };
}

function textReservationListRow(row: ReservationListRow): Record<string, string> {
  return {
    id: row.id,
    status: row.status,
    expired: row.expired ? "yes" : "no",
    agent: row.agentId,
    work: row.workId,
    workStatus: row.workStatus ?? "",
    title: row.workTitle ?? "",
    expiresAt: row.expiresAt ?? "",
    purpose: row.purpose ?? ""
  };
}

function textOperationListRow(row: OperationListRow): Record<string, string> {
  return {
    id: row.id,
    session: row.sessionId,
    command: row.commandPath,
    status: row.status,
    exit: String(row.exitCode),
    state: row.stateChanged ? "yes" : "no",
    artifacts: row.generatedArtifactsChanged ? "yes" : "no",
    actor: row.actorId,
    finished: row.finishedAt,
    events: String(row.eventCount)
  };
}

function textWorkListRow(row: WorkListRow): Record<string, string> {
  return {
    id: row.id,
    status: row.status,
    priority: row.priority,
    title: row.title,
    labels: row.labels.join(",")
  };
}

function sourceListRow(source: KnowledgeSource): Record<string, string> {
  return {
    id: source.meta.id,
    kind: source.kind,
    title: source.title,
    uri: source.uri
  };
}

function claimListRow(claim: ClaimRecord): Record<string, string> {
  return {
    id: claim.meta.id,
    status: claim.status,
    statement: claim.statement,
    sources: claim.sourceIds.join(","),
    evidence: claim.evidenceIds.join(",")
  };
}

function decisionListRow(decision: DecisionRecord): Record<string, string> {
  return {
    id: decision.meta.id,
    status: decision.status,
    title: decision.title,
    decision: decision.decision,
    sources: decision.sourceIds.join(",")
  };
}

function searchResultRow(result: SearchResult): Record<string, string | number> {
  return {
    score: result.score,
    type: result.type,
    id: result.recordId,
    subject: result.subjectId ?? "",
    title: result.title,
    matches: result.matches.join(",")
  };
}

function handoffSearchQuery(work: WorkItemView, contextPack: ContextPack): string {
  return [
    work.title,
    work.labels.join(" "),
    contextPack.summary,
    contextPack.facts.join(" "),
    contextPack.evidence.join(" ")
  ]
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

function diversifyHandoffSearchResults(results: readonly SearchResult[], limit: number): readonly SearchResult[] {
  const selected: SearchResult[] = [];
  const deferredContextChunks: SearchResult[] = [];
  const contextChunkLimit = Math.max(1, Math.floor(limit / HANDOFF_CONTEXT_CHUNK_LIMIT_RATIO));
  let contextChunkCount = 0;

  for (const result of results) {
    if (result.type === "context_chunk") {
      if (contextChunkCount >= contextChunkLimit) {
        deferredContextChunks.push(result);
        continue;
      }
      contextChunkCount += 1;
    }
    selected.push(result);
    if (selected.length >= limit) {
      return selected;
    }
  }

  for (const result of deferredContextChunks) {
    selected.push(result);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function compareReservationRows(left: ReservationListRow, right: ReservationListRow): number {
  return (
    reservationStatusRank(left.status) - reservationStatusRank(right.status) ||
    Number(right.expired) - Number(left.expired) ||
    compareOptionalIso(left.expiresAt, right.expiresAt) ||
    right.reservedAt.localeCompare(left.reservedAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareWorkItems(left: WorkItem, right: WorkItem): number {
  return (
    priorityRank(right.priority) - priorityRank(left.priority) ||
    left.title.localeCompare(right.title) ||
    left.meta.id.localeCompare(right.meta.id)
  );
}

function reservationStatusRank(status: ReservationStatus): number {
  switch (status) {
    case "active":
      return 0;
    case "expired":
      return 1;
    case "released":
      return 2;
  }
}

function compareOptionalIso(left: string | undefined, right: string | undefined): number {
  if (left && right) {
    return left.localeCompare(right);
  }
  if (left) {
    return -1;
  }
  if (right) {
    return 1;
  }
  return 0;
}

function recommendedAgentAction(input: {
  readonly agentId: string;
  readonly labels: readonly string[];
  readonly active: readonly ReservationListRow[];
  readonly expiredActive: readonly ReservationListRow[];
  readonly capacityRemaining: number;
  readonly claimableWork: readonly WorkItem[];
}): AgentStatus["recommendedAction"] {
  if (input.expiredActive.length > 0) {
    return {
      kind: "repair_expired_reservations",
      command: "bwrk doctor --fix",
      reason: "Expired active reservations should be repaired before claiming more work."
    };
  }
  if (input.capacityRemaining <= 0) {
    return {
      kind: "release_or_finish_work",
      command: `bwrk reservation list --agent ${shellArg(input.agentId)} --status active`,
      reason: "The agent has reached the active reservation limit."
    };
  }
  if (input.active.length > 0) {
    return {
      kind: "continue_reserved_work",
      command: `bwrk work show ${shellArg(input.active[0]?.workId ?? "")}`,
      reason: "The agent already has active reserved work."
    };
  }
  if (input.claimableWork.length > 0) {
    return {
      kind: "claim_work",
      command: `bwrk work claim --agent ${shellArg(input.agentId)}${labelFlags(input.labels)}`,
      reason: "The agent has available reservation capacity and claimable ready work."
    };
  }
  return {
    kind: "wait_for_ready_work",
    command: "bwrk work list --ready",
    reason: "The agent has capacity, but no claimable ready work matches the requested filters."
  };
}

function labelFlags(labels: readonly string[]): string {
  return labels.length > 0 ? ` ${labels.map((label) => `--label ${shellArg(label)}`).join(" ")}` : "";
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function compareWorkViews(left: WorkItemView, right: WorkItemView): number {
  return (
    priorityRank(right.priority) - priorityRank(left.priority) ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

function priorityRank(priority: WorkPriority): number {
  switch (priority) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "normal":
      return 2;
    case "low":
      return 1;
  }
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  return `[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`;
}

function helpText(topic?: string): string {
  if (topic === undefined) {
    return rootHelpText();
  }
  const definitions = COMMAND_DEFINITIONS.filter((definition) => definition.path[0] === topic);
  if (definitions.length === 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown help topic: ${topic}`);
  }
  return `${topic === "commands" ? "bwrk commands" : `bwrk ${topic}`}

Usage:
${definitions.map((definition) => `  ${definition.usage}`).join("\n")}
${definitions.some((definition) => definition.description)
    ? `\n${definitions
        .filter((definition) => definition.description)
        .map((definition) => definition.description)
        .join("\n")}\n`
    : ""}`;
}

function rootHelpText(): string {
  return `bwrk - Boreal Work CLI

Usage:
${COMMAND_DEFINITIONS.map((definition) => `  ${definition.usage}`).join("\n")}

Help:
  bwrk help [init|work|dep|evidence|source|claim|decision|context|search|reservation|agent|operation|export|import|ledger|snapshot|doctor|lock|commands]
`;
}
