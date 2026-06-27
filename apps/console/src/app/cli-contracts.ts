export const CONSOLE_CLI_CONTRACT_VERSION = "boreal.console-cli-contract.v1";

export type ConsoleCliContractSchema =
  | "doctor-result.v1"
  | "operation-list.v1"
  | "claim-list.v1"
  | "decision-list.v1"
  | "raw-list.v1"
  | "raw-show.v1"
  | "registry-doctor.v1"
  | "registry-list.v1"
  | "reservation-list.v1"
  | "search-query.v1"
  | "source-list.v1"
  | "sync-status.v1"
  | "wiki-list.v1"
  | "wiki-show.v1"
  | "work-list.v1"
  | "work-show.v1";

export interface ConsoleCliContract {
  readonly command: string;
  readonly schema: ConsoleCliContractSchema;
}

export interface ConsoleCliContractFixture {
  readonly contractVersion: typeof CONSOLE_CLI_CONTRACT_VERSION;
  readonly outputs: Readonly<Record<string, unknown>>;
}

export class ConsoleCliContractError extends Error {
  readonly code = "CONSOLE_CLI_CONTRACT_FAILED";

  constructor(
    readonly command: string,
    readonly schema: ConsoleCliContractSchema,
    readonly path: string,
    readonly expected: string,
    readonly actual: unknown
  ) {
    super(`Console CLI contract failed for ${command} (${schema}) at ${path}: expected ${expected}`);
    this.name = "ConsoleCliContractError";
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      contractVersion: CONSOLE_CLI_CONTRACT_VERSION,
      command: this.command,
      schema: this.schema,
      path: this.path,
      expected: this.expected,
      actual: describeActual(this.actual)
    };
  }
}

export const CONSOLE_CLI_CONTRACTS: readonly ConsoleCliContract[] = [
  { command: "work list --label <label> --limit <n> --json", schema: "work-list.v1" },
  { command: "work list --limit <n> --json", schema: "work-list.v1" },
  { command: "work list --ready --label <label> --limit <n> --json", schema: "work-list.v1" },
  { command: "work show <work-id> --json", schema: "work-show.v1" },
  { command: "raw list --limit <n> --json", schema: "raw-list.v1" },
  { command: "raw show <raw-id> --preview-bytes <n> --json", schema: "raw-show.v1" },
  { command: "wiki list --limit <n> --json", schema: "wiki-list.v1" },
  { command: "wiki show <wiki-id> --json", schema: "wiki-show.v1" },
  { command: "source list --limit <n> --json", schema: "source-list.v1" },
  { command: "claim list --limit <n> --json", schema: "claim-list.v1" },
  { command: "decision list --limit <n> --json", schema: "decision-list.v1" },
  { command: "search query <query> --limit <n> --json", schema: "search-query.v1" },
  { command: "operation list --limit <n> --json", schema: "operation-list.v1" },
  { command: "registry list --json", schema: "registry-list.v1" },
  { command: "registry doctor --json", schema: "registry-doctor.v1" },
  { command: "sync status --json", schema: "sync-status.v1" },
  { command: "doctor --json", schema: "doctor-result.v1" },
  { command: "reservation list --status active --json", schema: "reservation-list.v1" }
] as const;

export const CONSOLE_CLI_CONTRACT_FIXTURE_OUTPUTS: ConsoleCliContractFixture = {
  contractVersion: CONSOLE_CLI_CONTRACT_VERSION,
  outputs: {
    "work list --label sprint-04 --limit 100 --json": [
      workRow("bw_work_5d61b84c8d43c6a9", "Sprint 04 - Client console app foundation", "blocked", ["sprint-04"]),
      workRow("bw_work_534295e2daf65102", "S04T01 - Scaffold apps/console package and workspace scripts", "ready", ["sprint-04", "task"])
    ],
    "work list --limit 250 --json": [
      workRow("bw_work_5d61b84c8d43c6a9", "Sprint 04 - Client console app foundation", "blocked", ["sprint-04"]),
      workRow("bw_work_534295e2daf65102", "S04T01 - Scaffold apps/console package and workspace scripts", "ready", ["sprint-04", "task"])
    ],
    "work list --ready --label v1-remainder --limit 20 --json": [
      workRow("bw_work_534295e2daf65102", "S04T01 - Scaffold apps/console package and workspace scripts", "ready", ["sprint-04", "task"])
    ],
    "work show bw_work_5d61b84c8d43c6a9 --json": {
      ...workRow("bw_work_5d61b84c8d43c6a9", "Sprint 04 - Client console app foundation", "blocked", ["sprint-04"]),
      kind: "sprint",
      dependencyIds: [],
      activeBlockerIds: [],
      blockedBy: [],
      evidenceCount: 0,
      verificationCount: 0
    },
    "raw list --limit 50 --json": [
      rawRow("bw_source_fixture", "thread-export.txt", "chat", "memory/raw/thread-export.txt", "linked")
    ],
    "raw show bw_source_fixture --preview-bytes 4096 --json": {
      ...rawRow("bw_source_fixture", "thread-export.txt", "chat", "memory/raw/thread-export.txt", "linked"),
      linkedPages: [{ id: "bw_page_fixture", title: "Runtime Hardening Notes", path: "memory/wiki/runtime-hardening-notes.md" }],
      preview: {
        status: "available",
        mediaType: "text",
        message: "Text preview available.",
        uri: "memory/raw/thread-export.txt",
        path: "/workspace/boreal-work/memory/raw/thread-export.txt",
        body: "Decision: keep rows immutable.",
        bytes: 30,
        totalBytes: 30,
        maxBytes: 4096,
        truncated: false
      }
    },
    "wiki list --limit 100 --json": [
      wikiRow("bw_page_runtime", "runtime-hardening-notes", "Runtime Hardening Notes", "accepted", ["bw_source_fixture"])
    ],
    "wiki show bw_page_runtime --json": {
      ...wikiRow("bw_page_runtime", "runtime-hardening-notes", "Runtime Hardening Notes", "accepted", ["bw_source_fixture"]),
      backlinks: [wikiLinkedPage("bw_page_index", "project-index", "Project Index", "accepted")],
      outboundPages: [wikiLinkedPage("bw_page_cli", "cli-hardening", "CLI Hardening", "draft")],
      missingOutboundLinks: ["Missing Page"]
    },
    "source list --limit 100 --json": [
      sourceRow("bw_source_runtime", "raw", "thread-export.txt", "memory/raw/thread-export.txt")
    ],
    "claim list --limit 100 --json": [
      claimRow("bw_claim_runtime", "accepted", "Runtime source rows stay immutable.", ["bw_source_runtime"])
    ],
    "decision list --limit 100 --json": [
      decisionRow("bw_decision_runtime", "accepted", "Keep raw previews read-only", "Raw preview commands do not mutate state.", ["bw_source_runtime"])
    ],
    "search query global --limit 10 --json": [
      {
        id: "work:bw_work_534295e2daf65102",
        type: "work",
        recordId: "bw_work_534295e2daf65102",
        title: "S04T01 - Scaffold apps/console package and workspace scripts",
        summary: "Console package fixture result.",
        score: 12.5,
        matches: ["global"]
      }
    ],
    "operation list --limit 20 --json": [
      {
        id: "bw_operation_1",
        sessionId: "local",
        commandPath: "work list",
        status: "succeeded",
        exitCode: 0,
        stateChanged: false,
        generatedArtifactsChanged: false,
        actorId: "cybertron",
        actorKind: "human",
        startedAt: "2026-06-27T00:00:00.000Z",
        finishedAt: "2026-06-27T00:00:01.000Z",
        eventCount: 0
      }
    ],
    "registry list --json": {
      entries: [
        registryEntry("project_boreal_fixture", "boreal-work", "/workspace/boreal-work")
      ],
      entryCount: 1
    },
    "registry doctor --json": {
      ok: true,
      entryCount: 1,
      findings: [
        { code: "registry.project_root", severity: "ok", message: "Project root exists", projectId: "project_boreal_fixture" }
      ]
    },
    "sync status --json": {
      ok: true,
      workspaceRoot: "/workspace/boreal-work",
      vault: { ok: true, rootDir: "/workspace/boreal-work/memory" },
      ledgers: { ok: true },
      searchIndex: { ok: true },
      git: { ok: true },
      recommendedActions: []
    },
    "doctor --json": {
      ok: true,
      strict: false,
      fixed: false,
      diagnostics: [
        { code: "lock.absent", severity: "ok", message: "No runtime state lock present" }
      ]
    },
    "reservation list --status active --json": [
      {
        id: "bw_reservation_1",
        status: "active",
        expired: false,
        agentId: "codex",
        workId: "bw_work_534295e2daf65102"
      }
    ]
  }
} as const;

export function validateConsoleCliContract(args: readonly string[], data: unknown): void {
  const contract = consoleCliContractForArgs(args);
  if (!contract) {
    throw new ConsoleCliContractError(commandFromArgs(args), "work-list.v1", "$", "known console CLI command", data);
  }
  switch (contract.schema) {
    case "work-list.v1":
      validateWorkList(contract, data);
      return;
    case "work-show.v1":
      validateWorkShow(contract, data);
      return;
    case "raw-list.v1":
      validateRawList(contract, data);
      return;
    case "raw-show.v1":
      validateRawShow(contract, data);
      return;
    case "wiki-list.v1":
      validateWikiList(contract, data);
      return;
    case "wiki-show.v1":
      validateWikiShow(contract, data);
      return;
    case "source-list.v1":
      validateSourceList(contract, data);
      return;
    case "claim-list.v1":
      validateClaimList(contract, data);
      return;
    case "decision-list.v1":
      validateDecisionList(contract, data);
      return;
    case "search-query.v1":
      validateSearchQuery(contract, data);
      return;
    case "operation-list.v1":
      validateOperationList(contract, data);
      return;
    case "registry-list.v1":
      validateRegistryList(contract, data);
      return;
    case "registry-doctor.v1":
      validateRegistryDoctor(contract, data);
      return;
    case "sync-status.v1":
      validateSyncStatus(contract, data);
      return;
    case "doctor-result.v1":
      validateDoctorResult(contract, data);
      return;
    case "reservation-list.v1":
      validateReservationList(contract, data);
      return;
  }
}

export function consoleCliContractForArgs(args: readonly string[]): ConsoleCliContract | undefined {
  const commandArgs = normalizeConsoleCommandArgs(args);
  if (commandArgs[0] === "work" && commandArgs[1] === "list" && commandArgs.includes("--json")) {
    return commandArgs.includes("--ready")
      ? findContract("work list --ready --label <label> --limit <n> --json")
      : commandArgs.includes("--label")
        ? findContract("work list --label <label> --limit <n> --json")
        : findContract("work list --limit <n> --json");
  }
  if (commandArgs[0] === "work" && commandArgs[1] === "show" && typeof commandArgs[2] === "string" && commandArgs[3] === "--json") {
    return findContract("work show <work-id> --json");
  }
  if (commandArgs[0] === "raw" && commandArgs[1] === "list" && commandArgs.includes("--limit") && commandArgs.includes("--json")) {
    return findContract("raw list --limit <n> --json");
  }
  if (
    commandArgs[0] === "raw" &&
    commandArgs[1] === "show" &&
    typeof commandArgs[2] === "string" &&
    commandArgs.includes("--preview-bytes") &&
    commandArgs.includes("--json")
  ) {
    return findContract("raw show <raw-id> --preview-bytes <n> --json");
  }
  if (commandArgs[0] === "wiki" && commandArgs[1] === "list" && commandArgs.includes("--limit") && commandArgs.includes("--json")) {
    return findContract("wiki list --limit <n> --json");
  }
  if (commandArgs[0] === "wiki" && commandArgs[1] === "show" && typeof commandArgs[2] === "string" && commandArgs[3] === "--json") {
    return findContract("wiki show <wiki-id> --json");
  }
  if (commandArgs[0] === "source" && commandArgs[1] === "list" && commandArgs.includes("--limit") && commandArgs.includes("--json")) {
    return findContract("source list --limit <n> --json");
  }
  if (commandArgs[0] === "claim" && commandArgs[1] === "list" && commandArgs.includes("--limit") && commandArgs.includes("--json")) {
    return findContract("claim list --limit <n> --json");
  }
  if (commandArgs[0] === "decision" && commandArgs[1] === "list" && commandArgs.includes("--limit") && commandArgs.includes("--json")) {
    return findContract("decision list --limit <n> --json");
  }
  if (commandArgs[0] === "search" && commandArgs[1] === "query" && commandArgs.includes("--limit") && commandArgs.includes("--json")) {
    return findContract("search query <query> --limit <n> --json");
  }
  if (commandArgs[0] === "operation" && commandArgs[1] === "list" && commandArgs.includes("--limit") && commandArgs.includes("--json")) {
    return findContract("operation list --limit <n> --json");
  }
  if (commandFromArgs(commandArgs) === "registry list --json") {
    return findContract("registry list --json");
  }
  if (commandFromArgs(commandArgs) === "registry doctor --json") {
    return findContract("registry doctor --json");
  }
  if (commandFromArgs(commandArgs) === "sync status --json") {
    return findContract("sync status --json");
  }
  if (commandFromArgs(commandArgs) === "doctor --json") {
    return findContract("doctor --json");
  }
  if (commandFromArgs(commandArgs) === "reservation list --status active --json") {
    return findContract("reservation list --status active --json");
  }
  return undefined;
}

function normalizeConsoleCommandArgs(args: readonly string[]): readonly string[] {
  const normalized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if ((value === "--workspace" || value === "--project-root" || value === "--session") && typeof args[index + 1] === "string") {
      index += 1;
      continue;
    }
    if (typeof value === "string") {
      normalized.push(value);
    }
  }
  return normalized;
}

function findContract(command: string): ConsoleCliContract {
  const contract = CONSOLE_CLI_CONTRACTS.find((candidate) => candidate.command === command);
  if (!contract) {
    throw new Error(`Missing console CLI contract: ${command}`);
  }
  return contract;
}

function validateWorkList(contract: ConsoleCliContract, data: unknown): void {
  const rows = requireArray(contract, data, "$", "work list array");
  rows.forEach((row, index) => validateWorkRow(contract, row, `$[${index}]`));
}

function validateWorkShow(contract: ConsoleCliContract, data: unknown): void {
  const row = requireRecord(contract, data, "$", "work show object");
  requireString(contract, row.id, "$.id", "work id string");
  requireString(contract, row.title, "$.title", "work title string");
  requireString(contract, row.kind, "$.kind", "work kind string");
  requireString(contract, row.status, "$.status", "work status string");
  requireString(contract, row.priority, "$.priority", "work priority string");
  requireStringArray(contract, row.labels, "$.labels", true);
  requireStringArray(contract, row.dependencyIds, "$.dependencyIds", true);
  requireStringArray(contract, row.activeBlockerIds, "$.activeBlockerIds", true);
  requireStringArray(contract, row.blockedBy, "$.blockedBy", true);
  requireNumber(contract, row.evidenceCount, "$.evidenceCount", true);
  requireNumber(contract, row.verificationCount, "$.verificationCount", true);
}

function validateRawList(contract: ConsoleCliContract, data: unknown): void {
  const rows = requireArray(contract, data, "$", "raw source list array");
  rows.forEach((row, index) => validateRawRow(contract, row, `$[${index}]`));
}

function validateRawShow(contract: ConsoleCliContract, data: unknown): void {
  const row = requireRecord(contract, data, "$", "raw source detail object");
  validateRawRow(contract, row, "$");
  const linkedPages = requireArray(contract, row.linkedPages, "$.linkedPages", "linked pages array");
  linkedPages.forEach((page, index) => {
    const pageRecord = requireRecord(contract, page, `$.linkedPages[${index}]`, "linked page object");
    requireString(contract, pageRecord.id, `$.linkedPages[${index}].id`, "linked page id string", true);
    requireString(contract, pageRecord.title, `$.linkedPages[${index}].title`, "linked page title string");
    requireString(contract, pageRecord.path, `$.linkedPages[${index}].path`, "linked page path string");
  });
  const preview = requireRecord(contract, row.preview, "$.preview", "raw preview object");
  requireString(contract, preview.status, "$.preview.status", "preview status string");
  requireString(contract, preview.mediaType, "$.preview.mediaType", "preview media type string");
  requireString(contract, preview.message, "$.preview.message", "preview message string");
  requireString(contract, preview.uri, "$.preview.uri", "preview uri string", true);
  requireString(contract, preview.path, "$.preview.path", "preview path string", true);
  requireString(contract, preview.body, "$.preview.body", "preview body string", true);
  requireNumber(contract, preview.bytes, "$.preview.bytes", true);
  requireNumber(contract, preview.totalBytes, "$.preview.totalBytes", true);
  requireNumber(contract, preview.maxBytes, "$.preview.maxBytes");
  requireBoolean(contract, preview.truncated, "$.preview.truncated", "preview truncated boolean");
}

function validateWikiList(contract: ConsoleCliContract, data: unknown): void {
  const rows = requireArray(contract, data, "$", "wiki page list array");
  rows.forEach((row, index) => validateWikiRow(contract, row, `$[${index}]`));
}

function validateWikiShow(contract: ConsoleCliContract, data: unknown): void {
  const row = requireRecord(contract, data, "$", "wiki page detail object");
  validateWikiRow(contract, row, "$");
  const backlinks = requireArray(contract, row.backlinks, "$.backlinks", "wiki backlinks array");
  backlinks.forEach((page, index) => validateWikiLinkedPage(contract, page, `$.backlinks[${index}]`));
  const outboundPages = requireArray(contract, row.outboundPages, "$.outboundPages", "wiki outbound pages array");
  outboundPages.forEach((page, index) => validateWikiLinkedPage(contract, page, `$.outboundPages[${index}]`));
  requireStringArray(contract, row.missingOutboundLinks, "$.missingOutboundLinks", true);
}

function validateSourceList(contract: ConsoleCliContract, data: unknown): void {
  const rows = requireArray(contract, data, "$", "source list array");
  rows.forEach((source, index) => {
    const row = requireRecord(contract, source, `$[${index}]`, "source row object");
    requireString(contract, row.id, `$[${index}].id`, "source id string");
    requireString(contract, row.kind, `$[${index}].kind`, "source kind string");
    requireString(contract, row.title, `$[${index}].title`, "source title string");
    requireString(contract, row.uri, `$[${index}].uri`, "source uri string", true);
  });
}

function validateClaimList(contract: ConsoleCliContract, data: unknown): void {
  const rows = requireArray(contract, data, "$", "claim list array");
  rows.forEach((claim, index) => {
    const row = requireRecord(contract, claim, `$[${index}]`, "claim row object");
    requireString(contract, row.id, `$[${index}].id`, "claim id string");
    requireString(contract, row.status, `$[${index}].status`, "claim status string");
    requireString(contract, row.statement, `$[${index}].statement`, "claim statement string");
    requireStringOrStringArray(contract, row.sources, `$[${index}].sources`, true);
    requireStringArray(contract, row.sourceIds, `$[${index}].sourceIds`);
    requireNumber(contract, row.sourceCount, `$[${index}].sourceCount`);
    requireStringOrStringArray(contract, row.evidence, `$[${index}].evidence`, true);
    requireStringArray(contract, row.evidenceIds, `$[${index}].evidenceIds`);
    requireNumber(contract, row.evidenceCount, `$[${index}].evidenceCount`);
    requireString(contract, row.reviewState, `$[${index}].reviewState`, "claim review state string");
    requireString(contract, row.updatedAt, `$[${index}].updatedAt`, "claim updated timestamp string");
  });
}

function validateDecisionList(contract: ConsoleCliContract, data: unknown): void {
  const rows = requireArray(contract, data, "$", "decision list array");
  rows.forEach((decision, index) => {
    const row = requireRecord(contract, decision, `$[${index}]`, "decision row object");
    requireString(contract, row.id, `$[${index}].id`, "decision id string");
    requireString(contract, row.status, `$[${index}].status`, "decision status string");
    requireString(contract, row.title, `$[${index}].title`, "decision title string");
    requireString(contract, row.context, `$[${index}].context`, "decision context string");
    requireString(contract, row.decision, `$[${index}].decision`, "decision body string");
    requireStringArray(contract, row.consequences, `$[${index}].consequences`);
    requireNumber(contract, row.consequenceCount, `$[${index}].consequenceCount`);
    requireStringOrStringArray(contract, row.sources, `$[${index}].sources`, true);
    requireStringArray(contract, row.sourceIds, `$[${index}].sourceIds`);
    requireNumber(contract, row.sourceCount, `$[${index}].sourceCount`);
    requireString(contract, row.reviewState, `$[${index}].reviewState`, "decision review state string");
    requireString(contract, row.supersessionStatus, `$[${index}].supersessionStatus`, "decision supersession status string");
    requireString(contract, row.updatedAt, `$[${index}].updatedAt`, "decision updated timestamp string");
  });
}

function validateRegistryList(contract: ConsoleCliContract, data: unknown): void {
  const record = requireRecord(contract, data, "$", "registry list object");
  const entries = requireArray(contract, record.entries, "$.entries", "registry entries array");
  entries.forEach((entry, index) => validateRegistryEntry(contract, entry, `$.entries[${index}]`));
  requireNumber(contract, record.entryCount, "$.entryCount", true);
}

function validateRegistryDoctor(contract: ConsoleCliContract, data: unknown): void {
  const record = requireRecord(contract, data, "$", "registry doctor object");
  requireBoolean(contract, record.ok, "$.ok", "registry doctor ok boolean");
  requireNumber(contract, record.entryCount, "$.entryCount", true);
  const findings = requireArray(contract, record.findings, "$.findings", "registry findings array");
  findings.forEach((finding, index) => {
    const row = requireRecord(contract, finding, `$.findings[${index}]`, "registry finding object");
    requireString(contract, row.code, `$.findings[${index}].code`, "finding code string");
    requireString(contract, row.severity, `$.findings[${index}].severity`, "finding severity string");
    requireString(contract, row.message, `$.findings[${index}].message`, "finding message string");
    requireString(contract, row.projectId, `$.findings[${index}].projectId`, "finding project id string", true);
  });
}

function validateRegistryEntry(contract: ConsoleCliContract, data: unknown, path: string): void {
  const entry = requireRecord(contract, data, path, "registry entry object");
  const display = requireRecord(contract, entry.display, `${path}.display`, "registry display object");
  requireString(contract, entry.id, `${path}.id`, "registry project id string");
  requireString(contract, display.name, `${path}.display.name`, "registry project name string");
  requireString(contract, entry.projectRoot, `${path}.projectRoot`, "registry project root string");
  requireString(contract, entry.memoryRoot, `${path}.memoryRoot`, "registry memory root string");
  requireString(contract, entry.memoryLayout, `${path}.memoryLayout`, "registry memory layout string");
  requireString(contract, entry.memoryGitMode, `${path}.memoryGitMode`, "registry memory git mode string");
}

function validateSyncStatus(contract: ConsoleCliContract, data: unknown): void {
  const record = requireRecord(contract, data, "$", "sync status object");
  requireBoolean(contract, record.ok, "$.ok", "sync ok boolean");
  requireString(contract, record.workspaceRoot, "$.workspaceRoot", "workspace root string");
  for (const key of ["vault", "ledgers", "searchIndex", "git"] as const) {
    const section = requireRecord(contract, record[key], `$.${key}`, `${key} object`);
    requireBoolean(contract, section.ok, `$.${key}.ok`, `${key} ok boolean`);
  }
  requireStringArray(contract, record.recommendedActions, "$.recommendedActions", true);
}

function validateDoctorResult(contract: ConsoleCliContract, data: unknown): void {
  const record = requireRecord(contract, data, "$", "doctor result object");
  requireBoolean(contract, record.ok, "$.ok", "doctor ok boolean");
  const diagnostics = requireArray(contract, record.diagnostics, "$.diagnostics", "diagnostics array");
  diagnostics.forEach((diagnostic, index) => {
    const row = requireRecord(contract, diagnostic, `$.diagnostics[${index}]`, "diagnostic object");
    requireString(contract, row.code, `$.diagnostics[${index}].code`, "diagnostic code string");
    requireString(contract, row.severity, `$.diagnostics[${index}].severity`, "diagnostic severity string");
    requireString(contract, row.message, `$.diagnostics[${index}].message`, "diagnostic message string");
  });
}

function validateReservationList(contract: ConsoleCliContract, data: unknown): void {
  const rows = requireArray(contract, data, "$", "reservation list array");
  rows.forEach((reservation, index) => {
    const row = requireRecord(contract, reservation, `$[${index}]`, "reservation object");
    requireString(contract, row.id, `$[${index}].id`, "reservation id string");
    requireString(contract, row.status, `$[${index}].status`, "reservation status string");
    requireBoolean(contract, row.expired, `$[${index}].expired`, "reservation expired boolean", true);
    requireString(contract, row.agentId, `$[${index}].agentId`, "reservation agent id string", true);
    requireString(contract, row.workId, `$[${index}].workId`, "reservation work id string");
    requireString(contract, row.workStatus, `$[${index}].workStatus`, "reservation work status string", true);
    requireString(contract, row.workTitle, `$[${index}].workTitle`, "reservation work title string", true);
    requireString(contract, row.reservedAt, `$[${index}].reservedAt`, "reservation reserved timestamp string", true);
    requireString(contract, row.expiresAt, `$[${index}].expiresAt`, "reservation expiry timestamp string", true);
    requireString(contract, row.purpose, `$[${index}].purpose`, "reservation purpose string", true);
  });
}

function validateSearchQuery(contract: ConsoleCliContract, data: unknown): void {
  const rows = requireArray(contract, data, "$", "search query array");
  rows.forEach((result, index) => {
    const row = requireRecord(contract, result, `$[${index}]`, "search result object");
    requireString(contract, row.id, `$[${index}].id`, "search result id string");
    requireString(contract, row.type, `$[${index}].type`, "search result source kind string");
    requireString(contract, row.recordId, `$[${index}].recordId`, "search result record id string");
    requireString(contract, row.title, `$[${index}].title`, "search result title string");
    requireString(contract, row.summary, `$[${index}].summary`, "search result summary string", true);
    requireNumber(contract, row.score, `$[${index}].score`);
    requireStringArray(contract, row.matches, `$[${index}].matches`, true);
  });
}

function validateOperationList(contract: ConsoleCliContract, data: unknown): void {
  const rows = requireArray(contract, data, "$", "operation list array");
  rows.forEach((operation, index) => {
    const row = requireRecord(contract, operation, `$[${index}]`, "operation row object");
    requireString(contract, row.id, `$[${index}].id`, "operation id string");
    requireString(contract, row.sessionId, `$[${index}].sessionId`, "operation session id string");
    requireString(contract, row.commandPath, `$[${index}].commandPath`, "operation command path string");
    requireString(contract, row.status, `$[${index}].status`, "operation status string");
    requireNumber(contract, row.exitCode, `$[${index}].exitCode`);
    requireBoolean(contract, row.stateChanged, `$[${index}].stateChanged`, "operation state changed boolean");
    requireBoolean(
      contract,
      row.generatedArtifactsChanged,
      `$[${index}].generatedArtifactsChanged`,
      "operation generated artifacts changed boolean"
    );
    requireString(contract, row.actorId, `$[${index}].actorId`, "operation actor id string");
    requireString(contract, row.actorKind, `$[${index}].actorKind`, "operation actor kind string");
    requireString(contract, row.startedAt, `$[${index}].startedAt`, "operation started timestamp string");
    requireString(contract, row.finishedAt, `$[${index}].finishedAt`, "operation finished timestamp string");
    requireNumber(contract, row.eventCount, `$[${index}].eventCount`);
  });
}

function validateWorkRow(contract: ConsoleCliContract, data: unknown, path: string): void {
  const row = requireRecord(contract, data, path, "work row object");
  requireString(contract, row.id, `${path}.id`, "work id string");
  requireString(contract, row.title, `${path}.title`, "work title string");
  requireString(contract, row.status, `${path}.status`, "work status string");
  requireString(contract, row.priority, `${path}.priority`, "work priority string");
  requireStringArray(contract, row.labels, `${path}.labels`, true);
}

function validateRawRow(contract: ConsoleCliContract, data: unknown, path: string): void {
  const row = requireRecord(contract, data, path, "raw source row object");
  requireString(contract, row.id, `${path}.id`, "raw source id string");
  requireString(contract, row.title, `${path}.title`, "raw source title string");
  requireString(contract, row.kind, `${path}.kind`, "raw source kind string");
  requireString(contract, row.uri, `${path}.uri`, "raw source uri string", true);
  requireString(contract, row.summary, `${path}.summary`, "raw source summary string", true);
  requireStringArray(contract, row.tags, `${path}.tags`, true);
  requireString(contract, row.addedAt, `${path}.addedAt`, "raw source added timestamp string");
  requireString(contract, row.actorId, `${path}.actorId`, "raw source actor id string");
  requireString(contract, row.contentHash, `${path}.contentHash`, "raw source content hash string");
  requireBoolean(contract, row.sourceBacked, `${path}.sourceBacked`, "raw source backed boolean");
  requireBoolean(contract, row.immutable, `${path}.immutable`, "raw source immutable boolean");
  requireString(contract, row.processingStatus, `${path}.processingStatus`, "raw source processing status string");
  requireNumber(contract, row.linkedPageCount, `${path}.linkedPageCount`);
  requireString(contract, row.retrievalCommand, `${path}.retrievalCommand`, "raw source retrieval command string");
  requireString(contract, row.previewCommand, `${path}.previewCommand`, "raw source preview command string");
}

function validateWikiRow(contract: ConsoleCliContract, data: unknown, path: string): void {
  const row = requireRecord(contract, data, path, "wiki page row object");
  requireString(contract, row.id, `${path}.id`, "wiki page id string", true);
  requireString(contract, row.slug, `${path}.slug`, "wiki page slug string");
  requireString(contract, row.title, `${path}.title`, "wiki page title string");
  requireString(contract, row.path, `${path}.path`, "wiki page path string");
  requireStringArray(contract, row.sourceRefs, `${path}.sourceRefs`, true);
  requireStringArray(contract, row.links, `${path}.links`, true);
  requireString(contract, row.claimStatus, `${path}.claimStatus`, "wiki claim status string", true);
  requireString(contract, row.truthStatus, `${path}.truthStatus`, "wiki truth status string");
  requireNumber(contract, row.sourceRefCount, `${path}.sourceRefCount`);
  requireNumber(contract, row.outboundLinkCount, `${path}.outboundLinkCount`);
  requireNumber(contract, row.backlinkCount, `${path}.backlinkCount`);
  requireString(contract, row.showCommand, `${path}.showCommand`, "wiki show command string");
}

function validateWikiLinkedPage(contract: ConsoleCliContract, data: unknown, path: string): void {
  const row = requireRecord(contract, data, path, "wiki linked page object");
  requireString(contract, row.id, `${path}.id`, "wiki linked page id string", true);
  requireString(contract, row.slug, `${path}.slug`, "wiki linked page slug string");
  requireString(contract, row.title, `${path}.title`, "wiki linked page title string");
  requireString(contract, row.path, `${path}.path`, "wiki linked page path string");
  requireString(contract, row.truthStatus, `${path}.truthStatus`, "wiki linked page truth status string");
}

function requireRecord(contract: ConsoleCliContract, value: unknown, path: string, expected: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw failure(contract, path, expected, value);
}

function requireArray(contract: ConsoleCliContract, value: unknown, path: string, expected: string): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  throw failure(contract, path, expected, value);
}

function requireString(contract: ConsoleCliContract, value: unknown, path: string, expected: string, optional = false): void {
  if ((value === undefined || value === null) && optional) {
    return;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw failure(contract, path, expected, value);
  }
}

function requireNumber(contract: ConsoleCliContract, value: unknown, path: string, optional = false): void {
  if ((value === undefined || value === null) && optional) {
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw failure(contract, path, "finite number", value);
  }
}

function requireBoolean(contract: ConsoleCliContract, value: unknown, path: string, expected: string, optional = false): void {
  if ((value === undefined || value === null) && optional) {
    return;
  }
  if (typeof value !== "boolean") {
    throw failure(contract, path, expected, value);
  }
}

function requireStringArray(contract: ConsoleCliContract, value: unknown, path: string, optional = false): void {
  if ((value === undefined || value === null) && optional) {
    return;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw failure(contract, path, "string array", value);
  }
}

function requireStringOrStringArray(contract: ConsoleCliContract, value: unknown, path: string, optional = false): void {
  if ((value === undefined || value === null) && optional) {
    return;
  }
  if (typeof value === "string") {
    return;
  }
  requireStringArray(contract, value, path, false);
}

function failure(contract: ConsoleCliContract, path: string, expected: string, actual: unknown): ConsoleCliContractError {
  return new ConsoleCliContractError(contract.command, contract.schema, path, expected, actual);
}

function commandFromArgs(args: readonly string[]): string {
  return args.join(" ");
}

function describeActual(value: unknown): string {
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function workRow(id: string, title: string, status: string, labels: readonly string[]): Record<string, unknown> {
  return { id, title, status, priority: "high", labels };
}

function rawRow(id: string, title: string, kind: string, uri: string, processingStatus: string): Record<string, unknown> {
  return {
    id,
    title,
    kind,
    uri,
    summary: "Fixture raw source.",
    tags: ["raw-inbox"],
    addedAt: "2026-06-27T00:00:00.000Z",
    actorId: "cybertron",
    contentHash: "sha256:fixture",
    sourceBacked: true,
    immutable: true,
    processingStatus,
    linkedPageCount: processingStatus === "linked" ? 1 : 0,
    retrievalCommand: `bwrk raw show ${id} --json`,
    previewCommand: `bwrk raw show ${id} --preview-bytes 4096 --json`
  };
}

function wikiRow(
  id: string,
  slug: string,
  title: string,
  truthStatus: string,
  sourceRefs: readonly string[]
): Record<string, unknown> {
  return {
    id,
    slug,
    title,
    path: `memory/wiki/${slug}.md`,
    sourceRefs,
    links: ["CLI Hardening", "Missing Page"],
    claimStatus: truthStatus === "draft" ? undefined : truthStatus,
    truthStatus,
    sourceRefCount: sourceRefs.length,
    outboundLinkCount: 2,
    backlinkCount: truthStatus === "accepted" ? 1 : 0,
    showCommand: `bwrk wiki show ${id} --json`
  };
}

function wikiLinkedPage(id: string, slug: string, title: string, truthStatus: string): Record<string, unknown> {
  return {
    id,
    slug,
    title,
    path: `memory/wiki/${slug}.md`,
    truthStatus
  };
}

function sourceRow(id: string, kind: string, title: string, uri: string): Record<string, unknown> {
  return { id, kind, title, uri };
}

function claimRow(id: string, status: string, statement: string, sourceIds: readonly string[]): Record<string, unknown> {
  return {
    id,
    status,
    statement,
    sources: sourceIds.join(","),
    sourceIds,
    sourceCount: sourceIds.length,
    evidence: "bw_evidence_fixture",
    evidenceIds: ["bw_evidence_fixture"],
    evidenceCount: 1,
    reviewState: status === "proposed" ? "needs_review" : status,
    updatedAt: "2026-06-27T00:00:00.000Z"
  };
}

function decisionRow(
  id: string,
  status: string,
  title: string,
  decision: string,
  sourceIds: readonly string[]
): Record<string, unknown> {
  return {
    id,
    status,
    title,
    context: `${title} context`,
    decision,
    consequences: ["Fixture consequence."],
    consequenceCount: 1,
    sources: sourceIds.join(","),
    sourceIds,
    sourceCount: sourceIds.length,
    reviewState: status === "proposed" ? "needs_review" : status,
    supersessionStatus: status === "superseded" ? "superseded" : "none",
    updatedAt: "2026-06-27T00:00:00.000Z"
  };
}

function registryEntry(id: string, name: string, projectRoot: string): Record<string, unknown> {
  return {
    id,
    display: { name, labels: [] },
    projectRoot,
    borealDir: `${projectRoot}/.boreal`,
    runtimeDir: `${projectRoot}/.boreal/runtime`,
    runtimeStateFile: `${projectRoot}/.boreal/runtime/state.json`,
    projectConfigPath: `${projectRoot}/.boreal/project.json`,
    memoryRoot: `${projectRoot}/memory`,
    memoryBorealDir: `${projectRoot}/memory/.boreal`,
    memoryLayout: "in-repo",
    memoryGitMode: "separate",
    installRoot: projectRoot,
    skillTargets: {},
    folderScoped: false,
    source: "project-setup",
    addedAt: "2026-06-27T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:00.000Z",
    lastSeenAt: "2026-06-27T00:00:00.000Z"
  };
}
