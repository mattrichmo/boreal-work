import { AGENT_DIRECTIVE_REGISTRY } from "./agent-directive-registry.js";
import {
  agentDirectiveRegistryIssues,
  type AgentDirectiveBundleValidationIssue,
  type AgentDirectiveRegistry,
  type AgentDirectiveRegistryVersion
} from "./agent-directives.js";

export const AGENT_DIRECTIVE_HEALTH_ISSUE_KINDS = [
  "registry_invalid",
  "duplicate_id",
  "unsafe_dynamic_instruction"
] as const;

export type AgentDirectiveHealthIssueKind = (typeof AGENT_DIRECTIVE_HEALTH_ISSUE_KINDS)[number];
export type AgentDirectiveHealthIssueSeverity = "error" | "warning";
export type AgentDirectiveHealthIssueSource = "registry";

export interface AgentDirectiveHealthIssue {
  readonly kind: AgentDirectiveHealthIssueKind;
  readonly severity: AgentDirectiveHealthIssueSeverity;
  readonly source: AgentDirectiveHealthIssueSource;
  readonly path: string;
  readonly message: string;
  readonly registryId?: string;
}

export interface AgentDirectiveHealthReport {
  readonly ok: boolean;
  readonly registryVersion: AgentDirectiveRegistryVersion;
  readonly checkedBundles: 0;
  readonly issueCounts: Readonly<Record<AgentDirectiveHealthIssueKind, number>>;
  readonly issues: readonly AgentDirectiveHealthIssue[];
}

export interface AgentDirectiveHealthReportInput {
  readonly registry?: AgentDirectiveRegistry;
}

export function agentDirectiveHealthReport(input: AgentDirectiveHealthReportInput = {}): AgentDirectiveHealthReport {
  const registry = input.registry ?? AGENT_DIRECTIVE_REGISTRY;
  const issues = uniqueHealthIssues(
    agentDirectiveRegistryIssues(registry).map((issue) => healthIssueFromRegistryIssue(issue, registry))
  );
  return {
    ok: issues.length === 0,
    registryVersion: registry.version,
    checkedBundles: 0,
    issueCounts: healthIssueCounts(issues),
    issues
  };
}

function healthIssueFromRegistryIssue(
  issue: AgentDirectiveBundleValidationIssue,
  registry: AgentDirectiveRegistry
): AgentDirectiveHealthIssue {
  return {
    kind: classifyRegistryIssue(issue),
    severity: "error",
    source: "registry",
    path: issue.path,
    message: issue.message,
    registryId: registryIdFromRegistryIssuePath(issue.path, registry)
  };
}

function classifyRegistryIssue(issue: AgentDirectiveBundleValidationIssue): AgentDirectiveHealthIssueKind {
  const message = issue.message.toLowerCase();
  if (message.includes("unique")) {
    return "duplicate_id";
  }
  if (message.includes("interpolation markers")) {
    return "unsafe_dynamic_instruction";
  }
  return "registry_invalid";
}

function healthIssueCounts(
  issues: readonly AgentDirectiveHealthIssue[]
): Readonly<Record<AgentDirectiveHealthIssueKind, number>> {
  const counts = Object.fromEntries(AGENT_DIRECTIVE_HEALTH_ISSUE_KINDS.map((kind) => [kind, 0])) as Record<
    AgentDirectiveHealthIssueKind,
    number
  >;
  for (const issue of issues) {
    counts[issue.kind] += 1;
  }
  return counts;
}

function uniqueHealthIssues(issues: readonly AgentDirectiveHealthIssue[]): readonly AgentDirectiveHealthIssue[] {
  const seen = new Set<string>();
  const output: AgentDirectiveHealthIssue[] = [];
  for (const issue of issues) {
    const key = [issue.kind, issue.source, issue.path, issue.registryId ?? ""].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(issue);
  }
  return output;
}

function registryIdFromRegistryIssuePath(
  path: string,
  registry: AgentDirectiveRegistry
): string | undefined {
  const match = path.match(/\$\.entries\[(\d+)\]/u);
  if (!match) {
    return undefined;
  }
  const index = Number(match[1]);
  return Number.isInteger(index) ? registry.entries[index]?.id : undefined;
}
