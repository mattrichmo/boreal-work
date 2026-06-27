export type SafeConsoleCommandId =
  | "doctor"
  | "doctor.fix"
  | "reservation.active"
  | "sprint.start"
  | "sync.refresh"
  | "sync.status"
  | "work.claim"
  | "work.close"
  | "work.create"
  | "work.renew"
  | "work.release"
  | "work.reserve"
  | "work.verify"
  | "work.ready";

export interface SafeConsoleCommand {
  readonly id: SafeConsoleCommandId;
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly mutatesState: boolean;
  readonly requiresConfirmation: boolean;
  readonly executable: boolean;
}

export const SAFE_CONSOLE_COMMANDS: readonly SafeConsoleCommand[] = [
  {
    id: "sync.status",
    label: "Sync status",
    command: "bwrk sync status --json",
    args: ["sync", "status", "--json"],
    mutatesState: false,
    requiresConfirmation: false,
    executable: true
  },
  {
    id: "doctor",
    label: "Doctor",
    command: "bwrk doctor --json",
    args: ["doctor", "--json"],
    mutatesState: false,
    requiresConfirmation: false,
    executable: true
  },
  {
    id: "doctor.fix",
    label: "Doctor fix",
    command: "bwrk doctor --fix --json",
    args: ["doctor", "--fix", "--json"],
    mutatesState: true,
    requiresConfirmation: true,
    executable: true
  },
  {
    id: "reservation.active",
    label: "Active reservations",
    command: "bwrk reservation list --status active --json",
    args: ["reservation", "list", "--status", "active", "--json"],
    mutatesState: false,
    requiresConfirmation: false,
    executable: true
  },
  {
    id: "work.ready",
    label: "Ready work",
    command: "bwrk work list --ready --label v1-remainder --limit 20 --json",
    args: ["work", "list", "--ready", "--label", "v1-remainder", "--limit", "20", "--json"],
    mutatesState: false,
    requiresConfirmation: false,
    executable: true
  },
  {
    id: "sync.refresh",
    label: "Refresh projections",
    command: "bwrk sync refresh --json",
    args: ["sync", "refresh", "--json"],
    mutatesState: true,
    requiresConfirmation: true,
    executable: true
  },
  {
    id: "work.claim",
    label: "Claim work",
    command: "bwrk work claim --agent <agent-id> --label <label> --json",
    args: ["work", "claim", "--agent", "<agent-id>", "--label", "<label>", "--json"],
    mutatesState: true,
    requiresConfirmation: true,
    executable: false
  },
  {
    id: "work.reserve",
    label: "Reserve card",
    command: "bwrk work reserve <work-id> --agent <agent-id> [--ttl <duration>] --json",
    args: ["work", "reserve", "<work-id>", "--agent", "<agent-id>", "--ttl", "<duration>", "--json"],
    mutatesState: true,
    requiresConfirmation: true,
    executable: false
  },
  {
    id: "work.release",
    label: "Release work",
    command: "bwrk work release <work-id> --json",
    args: ["work", "release", "<work-id>", "--json"],
    mutatesState: true,
    requiresConfirmation: true,
    executable: false
  },
  {
    id: "work.renew",
    label: "Renew reservation",
    command: "bwrk work renew <work-id> (--ttl <duration>|--expires-at <iso>) --json",
    args: ["work", "renew", "<work-id>", "--ttl", "<duration>", "--json"],
    mutatesState: true,
    requiresConfirmation: true,
    executable: false
  },
  {
    id: "work.verify",
    label: "Verify work",
    command: "bwrk work verify <work-id> --evidence <evidence-id> --verdict passed --json",
    args: ["work", "verify", "<work-id>", "--evidence", "<evidence-id>", "--verdict", "passed", "--json"],
    mutatesState: true,
    requiresConfirmation: true,
    executable: false
  },
  {
    id: "work.close",
    label: "Close work",
    command: "bwrk work close <work-id> --reason <text> --json",
    args: ["work", "close", "<work-id>", "--reason", "<text>", "--json"],
    mutatesState: true,
    requiresConfirmation: true,
    executable: false
  },
  {
    id: "work.create",
    label: "Promote discovery",
    command: "bwrk work create <title> --source <source-ref> --ready --json",
    args: ["work", "create", "<title>", "--source", "<source-ref>", "--ready", "--json"],
    mutatesState: true,
    requiresConfirmation: true,
    executable: false
  },
  {
    id: "sprint.start",
    label: "Start sprint work",
    command: "bwrk agent start --agent <agent-id> --label <sprint-label> --purpose <purpose> --json",
    args: ["agent", "start", "--agent", "<agent-id>", "--label", "<sprint-label>", "--purpose", "<purpose>", "--json"],
    mutatesState: true,
    requiresConfirmation: true,
    executable: false
  }
];

export function getSafeConsoleCommand(id: string): SafeConsoleCommand | undefined {
  return SAFE_CONSOLE_COMMANDS.find((command) => command.id === id);
}
