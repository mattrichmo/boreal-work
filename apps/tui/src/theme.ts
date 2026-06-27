export const COLOR = {
  accent: "#71d48b",
  accentSoft: "#8be9a5",
  text: "#edf5f0",
  muted: "#94a39b",
  faint: "#5c6b63",
  warn: "#d7b969",
  danger: "#df7c7c",
  selectionBg: "#16271c",
  barBg: "#0c100d"
} as const;

export function statusColor(status: string): string {
  switch (status) {
    case "ready":
      return COLOR.accent;
    case "in_progress":
    case "reserved":
      return COLOR.accentSoft;
    case "verified":
    case "closed":
      return COLOR.accent;
    case "blocked":
    case "needs_verification":
      return COLOR.warn;
    case "cancelled":
      return COLOR.danger;
    default:
      return COLOR.muted;
  }
}

const STATUS_LABEL: Readonly<Record<string, string>> = {
  ready: "ready",
  in_progress: "active",
  reserved: "resv",
  needs_verification: "verify",
  blocked: "blocked",
  verified: "done",
  closed: "closed",
  cancelled: "cancel",
  draft: "draft"
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

export function healthColor(health: string): string {
  if (health === "ok") return COLOR.accent;
  if (health === "warning") return COLOR.warn;
  if (health === "error" || health === "critical") return COLOR.danger;
  return COLOR.muted;
}

export function fit(value: string, width: number): string {
  if (value.length <= width) return value.padEnd(width);
  if (width <= 1) return value.slice(0, width);
  return `${value.slice(0, width - 1)}…`;
}
