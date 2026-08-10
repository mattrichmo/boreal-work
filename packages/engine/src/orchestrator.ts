import {
  BorealError,
  createRecordMeta,
  normalizeActorId,
  nowIso,
  randomId,
  touchRecord,
  withContentHash,
  type ActorRef,
  type AgentReservation,
  type AgentId,
  type EventId,
  type IsoTimestamp,
  type OrchestrationAssignment,
  type OrchestrationAssignmentState,
  type OrchestrationId,
  type OrchestrationNudge,
  type OrchestrationNudgeKind,
  type OrchestrationNudgeSeverity,
  type OrchestrationNudgeId,
  type OrchestrationPolicy,
  type OrchestrationProgress,
  type OrchestrationProgressState,
  type OrchestrationRun,
  type OrchestrationStatus,
  type RuntimeEvent,
  type WorkId,
  type WorkItem
} from "@boreal/core";
import type { BorealStore, BorealWriter } from "@boreal/storage";

const DEFAULT_ORCHESTRATION_POLICY: OrchestrationPolicy = {
  maxConcurrent: 3,
  nudgeAfterMs: 15 * 60_000,
  staleAfterMs: 60 * 60_000,
  maxNudgesPerWork: 3
};

const TERMINAL_WORK_STATUSES = new Set<WorkItem["status"]>(["closed", "verified", "cancelled"]);
const TERMINAL_ORCHESTRATION_STATUSES = new Set<OrchestrationStatus>(["succeeded", "failed", "cancelled"]);

export interface StartOrchestrationInput {
  readonly rootWorkId: WorkId;
  readonly agentPool?: readonly (AgentId | string)[];
  readonly policy?: Partial<OrchestrationPolicy>;
  readonly purpose?: string;
  readonly sessionId?: string;
  readonly worktree?: boolean;
}

export interface ListOrchestrationsOptions {
  readonly status?: OrchestrationStatus;
  readonly limit?: number;
}

export interface OrchestrationProgressInput {
  readonly orchestrationId: OrchestrationId;
  readonly workId: WorkId;
  readonly agentId: AgentId | string;
  readonly state: OrchestrationProgressState;
  readonly phase?: string;
  readonly nextCheckpoint?: string;
  readonly blockerCode?: string;
  readonly note?: string;
  readonly evidenceIds?: readonly string[];
  readonly artifactUris?: readonly string[];
  readonly touchedPaths?: readonly string[];
}

export interface TickOrchestrationInput {
  readonly orchestrationId: OrchestrationId;
  readonly dispatch?: boolean;
}

export interface NudgeOrchestrationInput {
  readonly orchestrationId: OrchestrationId;
  readonly workId: WorkId;
  readonly agentId?: AgentId | string;
  readonly kind: OrchestrationNudgeKind;
}

export interface OrchestrationCandidate {
  readonly workId: WorkId;
  readonly title: string;
  readonly description?: string;
  readonly acceptanceCriteria: readonly string[];
  readonly labels: readonly string[];
  readonly dependencyIds: readonly string[];
  readonly contextSummary?: string;
  readonly priority: WorkItem["priority"];
  readonly status: WorkItem["status"];
  readonly agentId: AgentId | string;
  readonly command: string;
  readonly contextCommand: string;
}

export interface OrchestrationShowResult {
  readonly run: OrchestrationRun;
  readonly rootWork?: WorkItem;
  readonly scopeWorkIds: readonly WorkId[];
  readonly readyCandidates: readonly OrchestrationCandidate[];
}

export interface OrchestrationTickResult extends OrchestrationShowResult {
  readonly assigned: readonly OrchestrationAssignment[];
  readonly issuedNudges: readonly OrchestrationNudge[];
  readonly expiredReservationCount: number;
  readonly dispatchErrors: readonly {
    readonly workId: WorkId;
    readonly agentId: AgentId | string;
    readonly code: string;
    readonly message: string;
  }[];
}

export interface OrchestrationNudgeResult {
  readonly run: OrchestrationRun;
  readonly nudge: OrchestrationNudge;
}

export interface OrchestratorRuntimeBridge {
  readonly listReadyWork: () => Promise<readonly {
    readonly id: string;
    readonly title: string;
    readonly description?: string;
    readonly acceptanceCriteria?: readonly string[];
    readonly labels: readonly string[];
    readonly dependencyIds: readonly string[];
    readonly contextSummary?: string;
    readonly priority: WorkItem["priority"];
    readonly status: WorkItem["status"];
  }[]>;
  readonly claimWork: (input: {
    readonly workId: WorkId;
    readonly agentId: AgentId | string;
    readonly purpose?: string;
    readonly sessionId?: string;
    readonly worktree?: boolean;
  }) => Promise<{
    readonly work: WorkItem;
    readonly reservation: AgentReservation;
  }>;
  readonly expireStaleReservations: () => Promise<{ readonly expired: readonly unknown[] }>;
}

export interface OrchestrationService {
  start(input: StartOrchestrationInput): Promise<OrchestrationRun>;
  list(options?: ListOrchestrationsOptions): Promise<readonly OrchestrationRun[]>;
  show(orchestrationId: OrchestrationId): Promise<OrchestrationShowResult>;
  tick(input: TickOrchestrationInput): Promise<OrchestrationTickResult>;
  progress(input: OrchestrationProgressInput): Promise<OrchestrationRun>;
  nudge(input: NudgeOrchestrationInput): Promise<OrchestrationNudgeResult>;
  transition(orchestrationId: OrchestrationId, status: "paused" | "resumed" | "cancelled" | "failed"): Promise<OrchestrationRun>;
}

export function createOrchestrationService(options: {
  readonly store: BorealStore;
  readonly actor: ActorRef;
  readonly operationId?: string;
  readonly clock?: () => Date;
  readonly bridge: OrchestratorRuntimeBridge;
}): OrchestrationService {
  const now = () => nowIso(options.clock?.() ?? new Date());

  async function appendSnapshot(
    writer: BorealWriter,
    type: string,
    run: OrchestrationRun,
    payload: Record<string, unknown> = {}
  ): Promise<RuntimeEvent> {
    const timestamp = now();
    const event = withContentHash({
      meta: createRecordMeta({
        id: randomId<EventId>("event"),
        now: timestamp,
        actor: options.actor
      }),
      type,
      subjectId: run.meta.id,
      subjectType: "orchestration",
      ...(options.operationId ? { operationId: options.operationId as RuntimeEvent["operationId"] } : {}),
      payload: {
        schemaVersion: "boreal.orchestration.event.v1",
        orchestration: run,
        ...payload
      }
    });
    await writer.putEvent(event);
    return event;
  }

  async function getRun(orchestrationId: OrchestrationId): Promise<OrchestrationRun> {
    return options.store.read(async (reader) => {
      const run = latestRun(await reader.listEvents(), orchestrationId);
      if (!run) {
        throw new BorealError("BOREAL_NOT_FOUND", "Orchestration not found", { orchestrationId });
      }
      return run;
    });
  }

  async function scopeFor(rootWorkId: WorkId): Promise<{
    readonly rootWork?: WorkItem;
    readonly workItems: readonly WorkItem[];
    readonly ids: readonly WorkId[];
  }> {
    return options.store.read(async (reader) => {
      const workItems = await reader.listWorkItems();
      const workById = new Map(workItems.map((work) => [work.meta.id, work]));
      const edges = await reader.listGraphEdges();
      const ids = new Set<WorkId>([rootWorkId]);
      const visit = (workId: WorkId): void => {
        const work = workById.get(workId);
        if (!work) return;
        const dependencyIds = new Set<WorkId>(work.dependencyIds);
        for (const edge of edges) {
          if (
            edge.kind === "blocks" &&
            edge.fromType === "work" &&
            edge.toType === "work" &&
            edge.fromProjectId === undefined &&
            edge.toProjectId === undefined &&
            edge.toId === workId
          ) {
            dependencyIds.add(edge.fromId as WorkId);
          }
        }
        for (const dependencyId of dependencyIds) {
          if (ids.has(dependencyId) || !workById.has(dependencyId)) continue;
          ids.add(dependencyId);
          visit(dependencyId);
        }
      };
      visit(rootWorkId);
      const orderedIds = [...ids].sort((left, right) => left.localeCompare(right));
      return {
        rootWork: workById.get(rootWorkId),
        workItems: orderedIds.map((id) => workById.get(id)).filter(isWorkItem),
        ids: orderedIds
      };
    });
  }

  async function candidateRows(run: OrchestrationRun): Promise<readonly OrchestrationCandidate[]> {
    const scope = await scopeFor(run.rootWorkId);
    const scopeIds = new Set(scope.ids);
    const assignedIds = new Set(
      run.assignments
        .filter((assignment) => assignment.state !== "released" && assignment.state !== "completed")
        .map((assignment) => assignment.workId)
    );
    const agentLoads = new Map<string, number>(run.agentPool.map((agentId) => [String(agentId), 0]));
    for (const assignment of run.assignments.filter(isCapacityAssignment)) {
      const key = String(assignment.agentId);
      agentLoads.set(key, (agentLoads.get(key) ?? 0) + 1);
    }
    const ready = (await options.bridge.listReadyWork())
      .filter((work) => scopeIds.has(work.id as WorkId))
      .filter((work) => !assignedIds.has(work.id as WorkId))
      .sort(compareReadyCandidates);
    return ready.map((work) => {
      const agentId = run.agentPool.length > 0
        ? run.agentPool
          .map((candidate) => ({ candidate, load: agentLoads.get(String(candidate)) ?? 0 }))
          .sort((left, right) => left.load - right.load || String(left.candidate).localeCompare(String(right.candidate)))[0]?.candidate ?? options.actor.id
        : options.actor.id;
      const loadKey = String(agentId);
      agentLoads.set(loadKey, (agentLoads.get(loadKey) ?? 0) + 1);
      const sessionFlag = run.sessionId ? ` --session ${run.sessionId}` : "";
      const gitFlag = run.worktree === true ? " --worktree" : run.worktree === false ? " --no-branch" : "";
      const command = `bwrk agent start ${work.id} --agent ${agentId} --purpose orchestration:${run.meta.id}${sessionFlag}${gitFlag} --json`;
      return {
        workId: work.id as WorkId,
        title: work.title,
        ...(work.description ? { description: work.description } : {}),
        acceptanceCriteria: work.acceptanceCriteria ?? [],
        labels: work.labels,
        dependencyIds: work.dependencyIds,
        ...(work.contextSummary ? { contextSummary: work.contextSummary } : {}),
        priority: work.priority,
        status: work.status,
        agentId,
        command,
        contextCommand: `bwrk context show ${work.id} --json`
      } satisfies OrchestrationCandidate;
    });
  }

  async function show(orchestrationId: OrchestrationId): Promise<OrchestrationShowResult> {
    const run = await getRun(orchestrationId);
    const scope = await scopeFor(run.rootWorkId);
    return {
      run,
      rootWork: scope.rootWork,
      scopeWorkIds: scope.ids,
      readyCandidates: await candidateRows(run)
    };
  }

  async function start(input: StartOrchestrationInput): Promise<OrchestrationRun> {
    const scope = await scopeFor(input.rootWorkId);
    if (!scope.rootWork) {
      throw new BorealError("BOREAL_NOT_FOUND", "Root work item not found", { workId: input.rootWorkId });
    }
    const policy = normalizePolicy(input.policy);
    const agentPool = uniqueStrings((input.agentPool ?? []).map((agentId) => normalizeActorId(String(agentId))));
    return options.store.write(async (writer) => {
      const timestamp = now();
      const run = withContentHash({
        meta: createRecordMeta({
          id: randomId<OrchestrationId>("orchestration"),
          now: timestamp,
          actor: options.actor
        }),
        rootWorkId: input.rootWorkId,
        status: "active" as const,
        ...(input.purpose?.trim() ? { purpose: input.purpose.trim() } : {}),
        ...(input.sessionId?.trim() ? { sessionId: input.sessionId.trim() } : {}),
        ...(input.worktree !== undefined ? { worktree: input.worktree } : {}),
        policy,
        agentPool,
        contextLedgerSeq: await writer.headSeq(),
        wave: 0,
        assignments: [],
        nudges: []
      });
      await appendSnapshot(writer, "orchestration.created", run, {
        rootWorkId: input.rootWorkId,
        scopeSize: scope.ids.length
      });
      return run;
    });
  }

  async function list(optionsInput: ListOrchestrationsOptions = {}): Promise<readonly OrchestrationRun[]> {
    return options.store.read(async (reader) => {
      const runs = latestRuns(await reader.listEvents())
        .filter((run) => !optionsInput.status || run.status === optionsInput.status)
        .sort((left, right) => right.meta.updatedAt.localeCompare(left.meta.updatedAt));
      return runs.slice(0, optionsInput.limit ?? 100);
    });
  }

  async function tick(input: TickOrchestrationInput): Promise<OrchestrationTickResult> {
    const expired = await options.bridge.expireStaleReservations();
    let run = await getRun(input.orchestrationId);
    if (TERMINAL_ORCHESTRATION_STATUSES.has(run.status) || run.status === "paused") {
      const result = await show(input.orchestrationId);
      return {
        ...result,
        assigned: [],
        issuedNudges: [],
        expiredReservationCount: expired.expired.length,
        dispatchErrors: []
      };
    }

    const timestamp = now();
    const synced = await synchronizeAssignments(run, timestamp);
    run = synced.run;
    const issuedNudges = [...synced.issuedNudges];
    const dispatchErrors: Array<OrchestrationTickResult["dispatchErrors"][number]> = [];
    const candidates = await candidateRows(run);
    const activeAssignments = run.assignments.filter(isCapacityAssignment);
    const availableSlots = Math.max(0, run.policy.maxConcurrent - activeAssignments.length);
    const assigned: OrchestrationAssignment[] = [];
    const dispatchWave = run.wave + 1;
    let nextWave = run.wave;

    if (input.dispatch && run.agentPool.length > 0 && availableSlots > 0) {
      for (const candidate of candidates.slice(0, availableSlots)) {
        const agentId = candidate.agentId;
        try {
          const claim = await options.bridge.claimWork({
            workId: candidate.workId,
            agentId,
            purpose: run.purpose ?? `orchestration:${run.meta.id}`,
            ...(run.sessionId ? { sessionId: run.sessionId } : {}),
            ...(run.worktree !== undefined ? { worktree: run.worktree } : {})
          });
          const assignment: OrchestrationAssignment = {
            workId: candidate.workId,
            agentId,
            reservationId: claim.reservation.meta.id,
            ...(run.sessionId ? { sessionId: run.sessionId } : {}),
            ...(claim.reservation.git ? { git: claim.reservation.git } : {}),
            wave: dispatchWave,
            state: "assigned",
            assignedAt: timestamp,
            nudgeCount: 0
          };
          assigned.push(assignment);
        } catch (error) {
          const details = error instanceof BorealError
            ? { code: error.code, message: error.message }
            : { code: "BOREAL_ORCHESTRATION_DISPATCH_FAILED", message: error instanceof Error ? error.message : String(error) };
          dispatchErrors.push({ workId: candidate.workId, agentId, ...details });
        }
      }
      if (assigned.length > 0) nextWave = dispatchWave;
    }

    const allAssignments = mergeAssignments(run.assignments, assigned);
    const scope = await scopeFor(run.rootWorkId);
    const terminalScope = scope.workItems.every((work) => isTerminalWork(work.status));
    const unresolved = allAssignments.some((assignment) => assignment.state !== "completed" && assignment.state !== "released");
    const attention = allAssignments.some((assignment) => assignment.state === "stale" || assignment.state === "blocked" || assignment.state === "drifting") &&
      allAssignments.some((assignment) => assignment.nudgeCount >= run.policy.maxNudgesPerWork);
    const status: OrchestrationStatus = terminalScope && !unresolved
      ? "succeeded"
      : attention
        ? "needs_attention"
        : "active";
    run = withContentHash(touchRecord({
      ...run,
      status,
      wave: nextWave,
      assignments: allAssignments,
      nudges: run.nudges,
      lastTickAt: timestamp
    }, timestamp, options.actor));

    await options.store.write(async (writer) => {
      await appendSnapshot(writer, "orchestration.ticked", run, {
        dispatch: input.dispatch === true,
        assignedWorkIds: assigned.map((assignment) => assignment.workId),
        expiredReservationCount: expired.expired.length,
        dispatchErrors
      });
    });
    const result = await show(input.orchestrationId);
    return {
      ...result,
      run,
      assigned,
      issuedNudges,
      expiredReservationCount: expired.expired.length,
      dispatchErrors
    };
  }

  async function progress(input: OrchestrationProgressInput): Promise<OrchestrationRun> {
    const run = await getRun(input.orchestrationId);
    const assignment = run.assignments.find((candidate) => candidate.workId === input.workId);
    if (!assignment) {
      throw new BorealError("BOREAL_NOT_FOUND", "Work is not assigned to this orchestration", {
        orchestrationId: input.orchestrationId,
        workId: input.workId
      });
    }
    if (normalizeActorId(String(assignment.agentId)) !== normalizeActorId(String(input.agentId))) {
      throw new BorealError("BOREAL_CONFLICT", "Progress agent does not own the orchestration assignment", {
        workId: input.workId,
        expectedAgentId: assignment.agentId,
        agentId: input.agentId
      });
    }
    const timestamp = now();
    const progressRecord: OrchestrationProgress = {
      state: input.state,
      ...(input.phase?.trim() ? { phase: input.phase.trim() } : {}),
      ...(input.nextCheckpoint?.trim() ? { nextCheckpoint: input.nextCheckpoint.trim() } : {}),
      ...(input.blockerCode?.trim() ? { blockerCode: input.blockerCode.trim() } : {}),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      ...(input.evidenceIds?.length ? { evidenceIds: input.evidenceIds as OrchestrationProgress["evidenceIds"] } : {}),
      ...(input.artifactUris?.length ? { artifactUris: input.artifactUris } : {}),
      ...(input.touchedPaths?.length ? { touchedPaths: input.touchedPaths } : {}),
      observedAt: timestamp
    };
    const updatedAssignment: OrchestrationAssignment = {
      ...assignment,
      state: assignmentStateForProgress(input.state),
      lastProgressAt: timestamp,
      lastProgress: progressRecord,
      ...(input.state === "completed" ? { completedAt: timestamp } : {})
    };
    const updatedNudges = run.nudges.map((nudge) =>
      nudge.workId === input.workId && !nudge.acknowledgedAt
        ? touchRecord({ ...nudge, acknowledgedAt: timestamp }, timestamp, options.actor)
        : nudge
    );
    const updated = withContentHash(touchRecord({
      ...run,
      status: run.status === "needs_attention" ? "active" : run.status,
      assignments: run.assignments.map((candidate) => candidate.workId === input.workId ? updatedAssignment : candidate),
      nudges: updatedNudges,
      lastTickAt: timestamp
    }, timestamp, options.actor));
    await options.store.write(async (writer) => {
      await appendSnapshot(writer, "orchestration.progressed", updated, {
        workId: input.workId,
        agentId: input.agentId,
        progress: progressRecord
      });
    });
    return updated;
  }

  async function nudge(input: NudgeOrchestrationInput): Promise<OrchestrationNudgeResult> {
    const run = await getRun(input.orchestrationId);
    if (TERMINAL_ORCHESTRATION_STATUSES.has(run.status)) {
      throw new BorealError("BOREAL_CONFLICT", "Cannot nudge a terminal orchestration", { orchestrationId: run.meta.id, status: run.status });
    }
    const assignment = run.assignments.find((candidate) => candidate.workId === input.workId);
    if (!assignment) {
      throw new BorealError("BOREAL_NOT_FOUND", "Work is not assigned to this orchestration", { workId: input.workId });
    }
    if (input.agentId && normalizeActorId(String(assignment.agentId)) !== normalizeActorId(String(input.agentId))) {
      throw new BorealError("BOREAL_CONFLICT", "Nudge agent does not own the orchestration assignment", {
        workId: input.workId,
        expectedAgentId: assignment.agentId,
        agentId: input.agentId
      });
    }
    if (assignment.nudgeCount >= run.policy.maxNudgesPerWork) {
      throw new BorealError("BOREAL_POLICY_VIOLATION", "Maximum nudges reached for this assignment", {
        workId: input.workId,
        maxNudgesPerWork: run.policy.maxNudgesPerWork
      });
    }
    const timestamp = now();
    const nudgeRecord = buildNudge(run, assignment, input.kind, timestamp, options.actor);
    const updatedAssignment: OrchestrationAssignment = {
      ...assignment,
      state: assignmentStateForNudge(input.kind, assignment.state),
      nudgeCount: assignment.nudgeCount + 1,
      lastNudgeAt: timestamp
    };
    const updated = withContentHash(touchRecord({
      ...run,
      status: updatedAssignment.nudgeCount >= run.policy.maxNudgesPerWork ? "needs_attention" : run.status,
      assignments: run.assignments.map((candidate) => candidate.workId === input.workId ? updatedAssignment : candidate),
      nudges: [...run.nudges, nudgeRecord]
    }, timestamp, options.actor));
    await options.store.write(async (writer) => {
      await appendSnapshot(writer, "orchestration.nudge_issued", updated, {
        workId: input.workId,
        kind: input.kind,
        reasonCode: nudgeRecord.reasonCode
      });
    });
    return { run: updated, nudge: nudgeRecord };
  }

  async function transition(
    orchestrationId: OrchestrationId,
    requestedStatus: "paused" | "resumed" | "cancelled" | "failed"
  ): Promise<OrchestrationRun> {
    const run = await getRun(orchestrationId);
    if (TERMINAL_ORCHESTRATION_STATUSES.has(run.status)) {
      throw new BorealError("BOREAL_CONFLICT", "Cannot transition a terminal orchestration", { orchestrationId, status: run.status });
    }
    const status: OrchestrationStatus = requestedStatus === "resumed" ? "active" : requestedStatus;
    if (requestedStatus === "paused" && run.status !== "active" && run.status !== "needs_attention") {
      throw new BorealError("BOREAL_CONFLICT", "Only active orchestrations can be paused", { orchestrationId, status: run.status });
    }
    if (requestedStatus === "resumed" && run.status !== "paused" && run.status !== "needs_attention") {
      throw new BorealError("BOREAL_CONFLICT", "Only paused or attention-required orchestrations can be resumed", { orchestrationId, status: run.status });
    }
    const timestamp = now();
    const updated = withContentHash(touchRecord({ ...run, status }, timestamp, options.actor));
    await options.store.write(async (writer) => {
      await appendSnapshot(writer, `orchestration.${requestedStatus}`, updated, { previousStatus: run.status });
    });
    return updated;
  }

  async function synchronizeAssignments(
    run: OrchestrationRun,
    timestamp: IsoTimestamp
  ): Promise<{ readonly run: OrchestrationRun; readonly issuedNudges: readonly OrchestrationNudge[] }> {
    const current = await options.store.read(async (reader) => {
      const workItems = new Map((await reader.listWorkItems()).map((work) => [work.meta.id, work]));
      const reservations = new Map((await reader.listReservations()).map((reservation) => [reservation.meta.id, reservation]));
      const summaries = await reader.listAgentSummaries();
      return { workItems, reservations, summaries };
    });
    const issuedNudges: OrchestrationNudge[] = [];
    const assignments = run.assignments.map((assignment) => {
      const work = current.workItems.get(assignment.workId);
      const reservation = assignment.reservationId ? current.reservations.get(assignment.reservationId) : undefined;
      if (!work) return assignment;
      const workSummaries = current.summaries.filter((summary) =>
        summary.subjectType === "work" && summary.subjectId === work.meta.id && (summary.status === "final" || summary.status === "forced")
      );
      const gateMetadata = closeoutGateMetadata(work);
      const observedMetadata = {
        ...(work.evidenceIds.length > 0 ? { evidenceIds: work.evidenceIds } : {}),
        ...(work.verificationIds.length > 0 ? { verificationIds: work.verificationIds } : {}),
        ...(workSummaries.length > 0 ? {
          agentSummaryIds: workSummaries.map((summary) => summary.meta.id),
          commitShas: uniqueStrings(workSummaries.flatMap((summary) => summary.commitShas))
        } : {}),
        ...gateMetadata
      } satisfies Partial<OrchestrationAssignment>;
      if (isTerminalWork(work.status)) {
        return {
          ...assignment,
          ...observedMetadata,
          state: "completed" as const,
          completedAt: assignment.completedAt ?? timestamp
        };
      }
      let state = assignment.state;
      if (work.status === "blocked") {
        state = "blocked";
      } else if (reservation?.status !== "active") {
        state = assignment.state === "completed" ? "completed" : reservation?.status === "released" ? "released" : "stale";
      } else if (assignment.lastProgress) {
        state = assignmentStateForProgress(assignment.lastProgress.state);
      } else if (state === "released" || state === "stale") {
        state = "assigned";
      }
      const ageMs = Date.parse(timestamp) - Date.parse(assignment.lastProgressAt ?? assignment.assignedAt);
      const sinceNudgeMs = assignment.lastNudgeAt ? Date.parse(timestamp) - Date.parse(assignment.lastNudgeAt) : Number.POSITIVE_INFINITY;
      let nudgeCount = assignment.nudgeCount;
      let lastNudgeAt = assignment.lastNudgeAt;
      if (ageMs >= run.policy.staleAfterMs) state = "stale";
      if (
        ageMs >= run.policy.nudgeAfterMs &&
        sinceNudgeMs >= run.policy.nudgeAfterMs &&
        nudgeCount < run.policy.maxNudgesPerWork
      ) {
        const kind: OrchestrationNudgeKind = state === "blocked" ? "blocked" : "heartbeat";
        const nudgeRecord = buildNudge(run, { ...assignment, state, nudgeCount }, kind, timestamp, options.actor);
        issuedNudges.push(nudgeRecord);
        nudgeCount += 1;
        lastNudgeAt = timestamp;
      }
      return {
        ...assignment,
        ...observedMetadata,
        state,
        ...(reservation?.git ? { git: reservation.git } : {}),
        nudgeCount,
        ...(lastNudgeAt ? { lastNudgeAt } : {})
      } satisfies OrchestrationAssignment;
    });
    return {
      run: withContentHash(touchRecord({
        ...run,
        assignments,
        nudges: issuedNudges.length > 0 ? [...run.nudges, ...issuedNudges] : run.nudges
      }, timestamp, options.actor)),
      issuedNudges
    };
  }

  return { start, list, show, tick, progress, nudge, transition };
}

function normalizePolicy(input: Partial<OrchestrationPolicy> | undefined): OrchestrationPolicy {
  const policy = { ...DEFAULT_ORCHESTRATION_POLICY, ...input };
  for (const [key, value] of Object.entries(policy)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new BorealError("BOREAL_INVALID_INPUT", `Orchestration policy ${key} must be a positive integer`, { key, value });
    }
  }
  if (policy.staleAfterMs < policy.nudgeAfterMs) {
    throw new BorealError("BOREAL_INVALID_INPUT", "staleAfterMs must be greater than or equal to nudgeAfterMs", { policy });
  }
  return policy;
}

function closeoutGateMetadata(work: WorkItem): Partial<OrchestrationAssignment> {
  const gates = work.requiredCloseoutGates ?? [];
  const openCloseoutGateIds = gates.filter((gate) => gate.status === "open").map((gate) => gate.id);
  const satisfiedCloseoutGateIds = gates
    .filter((gate) => gate.status === "satisfied" || gate.status === "forced")
    .map((gate) => gate.id);
  return {
    ...(openCloseoutGateIds.length > 0 ? { openCloseoutGateIds } : {}),
    ...(satisfiedCloseoutGateIds.length > 0 ? { satisfiedCloseoutGateIds } : {})
  };
}

function latestRuns(events: readonly RuntimeEvent[]): OrchestrationRun[] {
  const runs = new Map<OrchestrationId, OrchestrationRun>();
  for (const event of events) {
    const run = orchestrationRunFromEvent(event);
    if (!run) continue;
    const current = runs.get(run.meta.id);
    if (!current || run.meta.updatedAt.localeCompare(current.meta.updatedAt) >= 0) runs.set(run.meta.id, run);
  }
  return [...runs.values()];
}

function latestRun(events: readonly RuntimeEvent[], orchestrationId: OrchestrationId): OrchestrationRun | undefined {
  return latestRuns(events).find((run) => run.meta.id === orchestrationId);
}

function orchestrationRunFromEvent(event: RuntimeEvent): OrchestrationRun | undefined {
  if (event.subjectType !== "orchestration" || !event.type.startsWith("orchestration.")) return undefined;
  const payload = event.payload as { readonly orchestration?: unknown };
  const run = payload.orchestration;
  if (!isRecord(run) || typeof run.meta !== "object" || run.meta === null || typeof run.rootWorkId !== "string") return undefined;
  return run as unknown as OrchestrationRun;
}

function compareReadyCandidates(
  left: { readonly title: string; readonly priority: WorkItem["priority"] },
  right: { readonly title: string; readonly priority: WorkItem["priority"] }
): number {
  return priorityRank(right.priority) - priorityRank(left.priority) || left.title.localeCompare(right.title);
}

function priorityRank(priority: WorkItem["priority"]): number {
  return priority === "critical" ? 4 : priority === "high" ? 3 : priority === "normal" ? 2 : 1;
}

function isWorkItem(value: WorkItem | undefined): value is WorkItem {
  return value !== undefined;
}

function isTerminalWork(status: WorkItem["status"]): boolean {
  return TERMINAL_WORK_STATUSES.has(status);
}

function isCapacityAssignment(assignment: OrchestrationAssignment): boolean {
  return assignment.state !== "completed" && assignment.state !== "released";
}

function mergeAssignments(
  existing: readonly OrchestrationAssignment[],
  additions: readonly OrchestrationAssignment[]
): readonly OrchestrationAssignment[] {
  const byWorkId = new Map(existing.map((assignment) => [assignment.workId, assignment]));
  for (const assignment of additions) byWorkId.set(assignment.workId, assignment);
  return [...byWorkId.values()].sort((left, right) => left.workId.localeCompare(right.workId));
}

function assignmentStateForProgress(state: OrchestrationProgressState): OrchestrationAssignmentState {
  return state === "completed" ? "completed" : state;
}

function assignmentStateForNudge(kind: OrchestrationNudgeKind, current: OrchestrationAssignmentState): OrchestrationAssignmentState {
  if (kind === "scope") return "drifting";
  if (kind === "blocked") return "blocked";
  return current;
}

function buildNudge(
  run: OrchestrationRun,
  assignment: OrchestrationAssignment,
  kind: OrchestrationNudgeKind,
  timestamp: IsoTimestamp,
  actor: ActorRef
): OrchestrationNudge {
  const spec = nudgeSpec(run, assignment, kind);
  return withContentHash({
    meta: createRecordMeta({ id: randomId<OrchestrationNudgeId>("nudge"), now: timestamp, actor }),
    orchestrationId: run.meta.id,
    workId: assignment.workId,
    agentId: assignment.agentId,
    kind,
    severity: spec.severity,
    reasonCode: spec.reasonCode,
    instruction: spec.instruction,
    commandPath: spec.commandPath,
    issuedAt: timestamp
  });
}

function nudgeSpec(
  run: OrchestrationRun,
  assignment: OrchestrationAssignment,
  kind: OrchestrationNudgeKind
): {
  readonly severity: OrchestrationNudgeSeverity;
  readonly reasonCode: string;
  readonly instruction: string;
  readonly commandPath: string;
} {
  const progressCommand = `bwrk orchestrate progress ${run.meta.id} ${assignment.workId} --agent ${assignment.agentId} --state working --json`;
  switch (kind) {
    case "checkpoint":
      return {
        severity: "warning",
        reasonCode: "checkpoint_missing",
        instruction: "Provide the next observable checkpoint and any evidence or artifact reference before continuing.",
        commandPath: progressCommand
      };
    case "scope":
      return {
        severity: "warning",
        reasonCode: "scope_confirmation_required",
        instruction: "Confirm the assigned work acceptance criteria and report any scope drift before changing direction.",
        commandPath: `bwrk work show ${assignment.workId} --json`
      };
    case "blocked":
      return {
        severity: "blocking",
        reasonCode: "blocked_progress_required",
        instruction: "Report the blocker code, dependency, or external wait condition; do not silently retry or broaden scope.",
        commandPath: `bwrk dep tree ${assignment.workId} --json`
      };
    case "replan":
      return {
        severity: "warning",
        reasonCode: "supervisor_replan",
        instruction: "Pause new work until the supervisor reviews current assignments, blockers, and the next bounded wave.",
        commandPath: `bwrk orchestrate tick ${run.meta.id} --json`
      };
    case "heartbeat":
      return {
        severity: "info",
        reasonCode: "heartbeat_overdue",
        instruction: "Send a short progress heartbeat with current phase, next checkpoint, and any blocker; continue at the current pace.",
        commandPath: progressCommand
      };
  }
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
