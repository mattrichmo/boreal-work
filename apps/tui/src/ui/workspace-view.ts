import type { AttemptReceiptRecord, WorkspaceViewKind } from "../client.js";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as JsonObject
        : undefined;
}

function text(value: unknown, fallback = "Not supplied"): string {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return fallback;
}

function rows(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function time(value: unknown, fallback = "Not supplied"): string {
    if (typeof value !== "number" || !Number.isFinite(value)) return text(value, fallback);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function pageLine(data: JsonObject, count: number): string {
    const total = typeof data.total === "number" ? data.total : undefined;
    const next = data.next_offset ?? data.next_after_id;
    return total === undefined
        ? `${count} returned by service${next !== undefined && next !== null ? " · more available" : ""}`
        : `${count} shown of ${total}${next !== undefined && next !== null ? " · more available" : ""}`;
}

function cycleLines(data: JsonObject): string[] {
    const board = object(data.cycle);
    if (board) {
        const assignments = rows(data.assignments);
        const lines = [
            `${text(board.name, text(board.cycle_id, "Cycle"))} · ${text(board.lifecycle, "State unavailable")}`,
            `ID ${text(board.cycle_id)} · ${text(board.timezone, "Timezone unavailable")}`,
            `Starts ${text(board.scheduled_start_local, time(board.scheduled_start_utc_ms, "Not scheduled"))}`,
            `Assignments ${assignments.length} · accepted and closed ${text(data.accepted_closed, "Not supplied")}`,
            "",
        ];
        if (!assignments.length) lines.push("No assignments were returned.");
        for (const [index, raw] of assignments.entries()) {
            const assignment = object(raw);
            if (!assignment) {
                lines.push(`${index + 1}. A damaged assignment row was omitted by the service.`);
                continue;
            }
            lines.push(`${text(assignment.work_title, text(assignment.work_id, "Work unavailable"))} · ${text(assignment.state)}`);
            lines.push(`  Assignment ${text(assignment.assignment_id)} · work ${text(assignment.work_id)} · ${text(assignment.work_lifecycle)}`);
            lines.push(`  ${assignment.accepted_closed === true ? "Accepted and closed" : "Not accepted and closed"}`);
            lines.push("");
        }
        const rollup = object(data.rollup);
        const totals = object(rollup?.totals);
        if (totals) lines.push(`Rollup ${text(rollup?.state)} · ${text(totals.accepted_closed)}/${text(totals.total)} accepted closed · ${text(totals.blocked_work)} blocked`);
        return lines;
    }
    const items = rows(data.items);
    const lines = [pageLine(data, items.length), ""];
    if (!items.length) return [...lines, "No cycles were returned."];
    for (const [index, raw] of items.entries()) {
        const cycle = object(raw);
        if (!cycle) {
            lines.push(`${index + 1}. A damaged cycle row was omitted by the service.`);
            continue;
        }
        lines.push(`${text(cycle.name, text(cycle.cycle_id, "Unnamed cycle"))} · ${text(cycle.lifecycle, "State unavailable")}`);
        lines.push(`  ID ${text(cycle.cycle_id)} · ${text(cycle.timezone, "Timezone unavailable")}`);
        lines.push(`  Starts ${text(cycle.scheduled_start_local, time(cycle.scheduled_start_utc_ms, "Not scheduled"))}`);
        if (cycle.scheduled_end_local !== undefined || cycle.scheduled_end_utc_ms !== undefined)
            lines.push(`  Ends ${text(cycle.scheduled_end_local, time(cycle.scheduled_end_utc_ms))}`);
        if (typeof cycle.goal === "string" && cycle.goal.trim()) lines.push(`  Goal ${cycle.goal}`);
        lines.push("");
    }
    return lines;
}

function reviewLines(data: JsonObject): string[] {
    const detail = object(data.review);
    if (detail) return [
        `Review ${text(detail.review_id)}`,
        `Decision ${text(detail.decision, "Decision unavailable")}`,
        `Work ${text(detail.work_id)} · gate ${text(detail.gate_id)}`,
        `Reviewer ${text(detail.reviewer_actor_id)} · attempt ${text(detail.attempt_id)} · fence ${text(detail.fence)}`,
        `Source ${text(detail.source_version_id)} · policy ${text(detail.policy_digest)}`,
        `Recorded ${text(detail.created_at)}`,
        `Reason ${text(detail.reason)}`,
    ];
    const items = rows(data.items);
    const lines = [pageLine(data, items.length), ""];
    if (!items.length) return [...lines, "No review records were returned."];
    for (const [index, raw] of items.entries()) {
        const review = object(raw);
        if (!review) {
            lines.push(`${index + 1}. A damaged review row was omitted by the service.`);
            continue;
        }
        lines.push(`${text(review.decision, "Decision unavailable")} · ${text(review.work_id, "Work unavailable")}`);
        lines.push(`  Review ${text(review.review_id)} · gate ${text(review.gate_id)}`);
        lines.push(`  Reviewer ${text(review.reviewer_actor_id)} · attempt ${text(review.attempt_id)} · fence ${text(review.fence)}`);
        if (typeof review.reason === "string" && review.reason.trim()) lines.push(`  Reason ${review.reason}`);
        if (typeof review.submission_id === "string") lines.push(`  Submission ${review.submission_id}`);
        if (typeof review.created_at === "string") lines.push(`  Recorded ${review.created_at}`);
        lines.push("");
    }
    return lines;
}

function memoryLines(data: JsonObject): string[] {
    if (typeof data.draft_id === "string") {
        const citations = rows(data.citations).map(object).filter((citation): citation is JsonObject => !!citation);
        const review = object(data.review);
        return [
            `Draft ${text(data.draft_id)} · entry ${text(data.entry_id)}`,
            `Title ${text(data.title)}`,
            `Draft revision ${text(data.draft_revision)} · content digest ${text(data.content_digest)}`,
            "", text(data.body, "Draft body unavailable"), "",
            ...citations.map(citation => `Citation ${text(citation.source_version_id)} · ${text(citation.location)}`),
            ...(review ? [`Review ${text(review.decision)} · ${text(review.review_id)} · ${text(review.reason)}`] : ["No review record was returned."]),
        ];
    }
    const hits = rows(data.hits);
    const lines = [
        `Git revision ${text(data.git_revision)} · index ${text(data.index_revision)} · lag ${text(data.lag)}`,
        `${hits.length} search result${hits.length === 1 ? "" : "s"}`,
        "",
    ];
    if (!hits.length) return [...lines, "No published memory matched this search."];
    for (const [index, raw] of hits.entries()) {
        const hit = object(raw);
        if (!hit) {
            lines.push(`${index + 1}. A damaged memory result was omitted by the service.`);
            continue;
        }
        lines.push(`${text(hit.title, text(hit.entry_id, "Untitled memory"))} · ${text(hit.entry_id)}`);
        if (typeof hit.excerpt === "string" && hit.excerpt.trim()) lines.push(`  ${hit.excerpt}`);
        if (typeof hit.git_revision === "string") lines.push(`  Published at ${hit.git_revision}`);
        const citations = rows(hit.citations).map(object).filter((citation): citation is JsonObject => !!citation);
        for (const citation of citations)
            lines.push(`  Source ${text(citation.source_version_id)} · ${text(citation.location)}`);
        lines.push("");
    }
    return lines;
}

function recoveryLines(data: JsonObject): string[] {
    const items = rows(data.items);
    const lines = [pageLine(data, items.length), ""];
    if (!items.length) return [...lines, "No unresolved recovery obligations were returned."];
    for (const [index, raw] of items.entries()) {
        const obligation = object(raw);
        if (!obligation) {
            lines.push(`${index + 1}. A damaged recovery row was omitted by the service.`);
            continue;
        }
        lines.push(`${text(obligation.reason, "Recovery reason unavailable")} · ${text(obligation.state)}`);
        lines.push(`  Obligation ${text(obligation.obligation_id)} · ${text(obligation.work_id, "Work unavailable")}`);
        lines.push(`  Attempt ${text(obligation.attempt_id)} · fence ${text(obligation.fence)} · resources ${text(obligation.resource_state)}`);
        lines.push(`  Owner ${text(obligation.owner_actor_id)} · next action ${text(obligation.next_action)}`);
        if (typeof obligation.created_at === "string") lines.push(`  Recorded ${obligation.created_at}`);
        lines.push("");
    }
    return lines;
}

function dependencyLines(data: JsonObject): string[] {
    const edges = rows(data.edges);
    const cycles = rows(data.cycles);
    const lines = [`${edges.length} dependency edge${edges.length === 1 ? "" : "s"} · ${typeof data.cycle_count === "number" ? data.cycle_count : cycles.length} cycle group${(typeof data.cycle_count === "number" ? data.cycle_count : cycles.length) === 1 ? "" : "s"}`, ""];
    if (!edges.length) lines.push("No dependency edges were returned.");
    for (const [index, raw] of edges.entries()) {
        const edge = object(raw);
        if (!edge) {
            lines.push(`${index + 1}. A damaged dependency row was omitted by the service.`);
            continue;
        }
        lines.push(`${text(edge.prerequisite_id, "Prerequisite unavailable")} must close before ${text(edge.dependent_id, "Dependent unavailable")}`);
    }
    if (cycles.length) {
        lines.push("", "DEPENDENCY CYCLES");
        for (const [index, cycle] of cycles.entries())
            lines.push(`${index + 1}. ${Array.isArray(cycle) ? cycle.map(value => text(value)).join(" → ") : text(cycle, "Damaged cycle group")}`);
    }
    return lines;
}

function sourceLines(data: JsonObject): string[] {
    const items = rows(data.items);
    const lines = [pageLine(data, items.length), ""];
    if (typeof data.query === "string") {
        lines[0] = `Search ${text(data.query)} · source revision ${text(data.source_revision)} · index ${text(data.index_revision)} · lag ${text(data.index_lag)}`;
        if (!items.length) return [...lines, "No source matched this search."];
        for (const [index, raw] of items.entries()) {
            const hit = object(raw);
            if (!hit) {
                lines.push(`${index + 1}. A damaged source result was omitted by the service.`);
                continue;
            }
            lines.push(`${text(hit.origin, "Origin unavailable")} · ${text(hit.source_version_id)}`);
            lines.push(`  ${text(hit.location)} · ${text(hit.score, "Score unavailable")}`);
            if (typeof hit.excerpt === "string") lines.push(`  ${hit.excerpt}`);
            lines.push("");
        }
        return lines;
    }
    if (!items.length) return [...lines, "No registered source versions were returned."];
    for (const [index, raw] of items.entries()) {
        const source = object(raw);
        if (!source) {
            lines.push(`${index + 1}. A damaged source row was omitted by the service.`);
            continue;
        }
        lines.push(`${text(source.origin, "Origin unavailable")} · ${text(source.availability, "Availability unknown")}`);
        lines.push(`  Version ${text(source.source_version_id)} · ${text(source.media_type)}`);
        lines.push(`  ${text(source.byte_count)} bytes · ${text(source.content_digest)}`);
        if (typeof source.parser_identity === "string") lines.push(`  Parser ${source.parser_identity}`);
        lines.push("");
    }
    return lines;
}

function sessionLines(data: JsonObject): string[] {
    return [
        `Session ${text(data.session_id)}`,
        `State ${text(data.state, "State unavailable")}`,
        `Actor ${text(data.actor_id)} · harness ${text(data.harness_id)}`,
        `Started ${text(data.started_at)}`,
        `Ended ${text(data.ended_at, "Still active or not supplied")}`,
        `Registration operation ${text(data.registration_operation_id)}`,
    ];
}

function parsedObject(value: string): JsonObject | undefined {
    try { return object(JSON.parse(value)); }
    catch { return undefined; }
}

/** Full human-readable metadata for one durable receipt row; the payload itself stays opaque. */
export function receiptDetailLines(record: AttemptReceiptRecord): string[] {
    const argv = (() => {
        try {
            const value: unknown = JSON.parse(record.argv_json);
            return Array.isArray(value) && value.every(part => typeof part === "string")
                ? value.map(part => JSON.stringify(part)).join(" ") || "(no arguments)"
                : "Malformed stored argv; receipt row remains visible.";
        } catch { return "Malformed stored argv; receipt row remains visible."; }
    })();
    const subject = parsedObject(record.subject_json);
    const coverage = parsedObject(record.coverage_json);
    const lines = [
        `Receipt ${record.receipt_id} · ${record.result} · ${record.attestation}`,
        `Project ${record.project_id} · work ${record.work_id}`,
        `Attempt ${record.attempt_id} · fence ${record.fence} · gate ${record.gate_id ?? "not indexed"}`,
        `Operation ${record.operation_id} · created ${record.created_at}`,
        `Executable ${record.executable}`,
        `Arguments ${argv}`,
        `Working directory ${record.cwd}`,
        `Exit code ${record.exit_code} · started ${record.started_at} · ended ${record.ended_at}`,
        `Source ${record.source_version_id ?? "not recorded"}`,
        `Configuration ${record.config_identity}`,
        `Environment fingerprint ${record.environment_fingerprint}`,
        `Output digest ${record.output_digest ?? "not recorded"} · reference ${record.output_ref ?? "not recorded"}`,
        `Rejection ${record.rejection_code ?? "none"}`,
        `Receipt payload ${record.receipt_payload === undefined || record.receipt_payload === null ? "unavailable" : "reconstructable; select explicitly to finish"}`,
    ];
    if (record.receipt_payload_diagnostic) lines.push(`Payload diagnostic ${record.receipt_payload_diagnostic}`);
    lines.push("", "SUBJECT");
    if (subject) {
        for (const key of ["work_id", "attempt_id", "fence", "gate_id"]) lines.push(`${key.replaceAll("_", " ")} ${text(subject[key])}`);
    } else lines.push("Malformed stored subject JSON; receipt row remains visible.");
    lines.push("", "COVERAGE");
    if (coverage) {
        for (const key of ["kind", "profile_id", "profile_version"]) lines.push(`${key.replaceAll("_", " ")} ${text(coverage[key])}`);
    } else lines.push("Malformed stored coverage JSON; receipt row remains visible.");
    return lines;
}

/** Human-readable projection of existing service reads; missing fields stay explicit. */
export function formatWorkspaceView(
    kind: WorkspaceViewKind,
    projectId: string,
    revision: number | null,
    asOf: string | undefined,
    value: unknown,
): string {
    const data = object(value);
    const header = [`Project ${projectId}`, `Service revision ${revision ?? "unavailable"}`, `Snapshot ${asOf ?? "time unavailable"}`, ""];
    if (!data) return [...header, "The service returned an unavailable or malformed view.", "No data was substituted."].join("\n");
    if (typeof data.project_id === "string" && data.project_id !== projectId)
        return [...header, "The response project does not match this mounted project.", "The response was not displayed."].join("\n");
    const content = kind === "cycles" ? cycleLines(data)
        : kind === "reviews" ? reviewLines(data)
            : kind === "memory" ? memoryLines(data)
                : kind === "recovery" ? recoveryLines(data)
                    : kind === "dependencies" ? dependencyLines(data)
                        : kind === "sources" ? sourceLines(data)
                            : sessionLines(data);
    return [...header, ...content].join("\n");
}
