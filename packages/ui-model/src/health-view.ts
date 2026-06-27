export type DashboardFindingSeverity = "info" | "warning" | "error";
export type DashboardFindingStatus = "ok" | "warning" | "failed" | "manual";

export interface DashboardAction {
  readonly label: string;
  readonly command?: string;
  readonly destructive?: boolean;
}

export interface DashboardFinding {
  readonly code: string;
  readonly title: string;
  readonly severity: DashboardFindingSeverity;
  readonly status: DashboardFindingStatus;
  readonly message: string;
  readonly source?: string;
  readonly actions: readonly DashboardAction[];
}

export interface DashboardHealthSummary {
  readonly ok: boolean;
  readonly total: number;
  readonly errors: number;
  readonly warnings: number;
  readonly manualActions: number;
  readonly fixableActions: number;
}

export interface DashboardHealthView {
  readonly generatedAt?: string;
  readonly title: string;
  readonly summary: DashboardHealthSummary;
  readonly findings: readonly DashboardFinding[];
}

export interface SyncDashboardView {
  readonly generatedAt?: string;
  readonly ok: boolean;
  readonly workspaceRoot: string;
  readonly vaultOk: boolean;
  readonly ledgersOk: boolean;
  readonly searchIndexOk: boolean;
  readonly gitOk: boolean;
  readonly recommendedActions: readonly DashboardAction[];
  readonly findings: readonly DashboardFinding[];
}

export interface LockDashboardView {
  readonly generatedAt?: string;
  readonly ok: boolean;
  readonly workspaceRoot: string;
  readonly locks: readonly LockStatusView[];
}

export interface LockStatusView {
  readonly domain: string;
  readonly path: string;
  readonly status: "clear" | "active" | "stale" | "orphaned";
  readonly owner?: string;
  readonly ageMs?: number;
  readonly repairCommand?: string;
}

export function buildDashboardHealthView(input: {
  readonly title: string;
  readonly findings: readonly DashboardFinding[];
  readonly generatedAt?: string;
}): DashboardHealthView {
  return {
    generatedAt: input.generatedAt,
    title: input.title,
    summary: summarizeDashboardFindings(input.findings),
    findings: [...input.findings].sort(compareFindings)
  };
}

export function summarizeDashboardFindings(findings: readonly DashboardFinding[]): DashboardHealthSummary {
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const manualActions = findings.filter((finding) => finding.status === "manual").length;
  const fixableActions = findings.reduce(
    (total, finding) => total + finding.actions.filter((action) => action.command && action.destructive !== true).length,
    0
  );
  return {
    ok: errors === 0,
    total: findings.length,
    errors,
    warnings,
    manualActions,
    fixableActions
  };
}

function compareFindings(left: DashboardFinding, right: DashboardFinding): number {
  const severity = severityRank(right.severity) - severityRank(left.severity);
  if (severity !== 0) {
    return severity;
  }
  return left.code.localeCompare(right.code);
}

function severityRank(severity: DashboardFindingSeverity): number {
  switch (severity) {
    case "error":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
  }
}
