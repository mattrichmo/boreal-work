export const borealDesignTokenSource = {
  path: "dump/Brand design system setup/globals.css",
  declarationCount: 89
} as const;

export type DesignTokenGroup =
  | "rawPalette"
  | "typography"
  | "spacing"
  | "radii"
  | "effectsLayout"
  | "semantic";

export type DesignTheme = "dark" | "light";

export interface DesignTokenDeclaration {
  readonly name: string;
  readonly value: string;
  readonly group: DesignTokenGroup;
  readonly theme?: DesignTheme;
  readonly role: string;
}

export interface InteractionRule {
  readonly id: string;
  readonly category: "focus" | "keyboard" | "density" | "responsive" | "text";
  readonly rule: string;
  readonly appliesTo: readonly string[];
}

export interface IconStrategy {
  readonly packageName: "lucide-react";
  readonly scope: "apps/console";
  readonly status: "deferred-until-console-scaffold";
  readonly importPolicy: string;
  readonly machineOutputPolicy: string;
}

export interface IconMapping {
  readonly intent: string;
  readonly icon: string;
  readonly surface: "global" | "sprint" | "repoMemory" | "operations" | "entity" | "foundation";
}

export interface DesignSystemSummary {
  readonly sourcePath: typeof borealDesignTokenSource.path;
  readonly totalTokenDeclarations: number;
  readonly tokenGroups: readonly {
    readonly group: DesignTokenGroup;
    readonly count: number;
  }[];
  readonly themedSemanticTokens: readonly {
    readonly theme: DesignTheme;
    readonly count: number;
  }[];
  readonly interactionRuleCount: number;
  readonly iconCount: number;
}

export const borealDesignTokens: readonly DesignTokenDeclaration[] = [
  { name: "--bw-ink-900", value: "#080A09", group: "rawPalette", role: "dark graphite background" },
  { name: "--bw-ink-800", value: "#0D100E", group: "rawPalette", role: "dark surface" },
  { name: "--bw-ink-700", value: "#121613", group: "rawPalette", role: "dark elevated surface" },
  { name: "--bw-ink-600", value: "#1A1F1B", group: "rawPalette", role: "dark inset" },
  { name: "--bw-ink-500", value: "#232A25", group: "rawPalette", role: "dark body text on light" },
  { name: "--bw-hair", value: "#2C342E", group: "rawPalette", role: "dark hairline border" },
  { name: "--bw-ever-900", value: "#0B2A22", group: "rawPalette", role: "evergreen deepest" },
  { name: "--bw-ever-700", value: "#103C30", group: "rawPalette", role: "evergreen dark" },
  { name: "--bw-ever-500", value: "#1A5343", group: "rawPalette", role: "evergreen core" },
  { name: "--bw-ever-300", value: "#2C7A62", group: "rawPalette", role: "evergreen text on dark" },
  { name: "--bw-frost-100", value: "#EAF1EE", group: "rawPalette", role: "primary text on dark" },
  { name: "--bw-frost-300", value: "#BFCCC6", group: "rawPalette", role: "body text on dark" },
  { name: "--bw-frost-500", value: "#7E8C86", group: "rawPalette", role: "muted text" },
  { name: "--bw-frost-700", value: "#515C57", group: "rawPalette", role: "faint text" },
  { name: "--bw-lichen", value: "#A6C686", group: "rawPalette", role: "success fill and dark-theme success text" },
  { name: "--bw-lichen-dim", value: "#7E9C63", group: "rawPalette", role: "dim success" },
  { name: "--bw-amber", value: "#E6A23C", group: "rawPalette", role: "primary action fill and dark-theme accent text" },
  { name: "--bw-amber-dim", value: "#B07D2C", group: "rawPalette", role: "dim action" },
  { name: "--bw-rust", value: "#C2524A", group: "rawPalette", role: "danger fill and dark-theme danger text" },
  { name: "--bw-paper-100", value: "#FFFFFF", group: "rawPalette", role: "light surface" },
  { name: "--bw-paper-200", value: "#F5F8F6", group: "rawPalette", role: "light background" },
  { name: "--bw-paper-300", value: "#EEF3F0", group: "rawPalette", role: "light secondary surface" },
  { name: "--bw-paper-400", value: "#E7EDEA", group: "rawPalette", role: "light inset" },
  { name: "--bw-paper-500", value: "#D3DDD8", group: "rawPalette", role: "light border" },
  { name: "--bw-amber-700", value: "#8A5A12", group: "rawPalette", role: "accessible amber text on light" },
  { name: "--bw-ever-600", value: "#155241", group: "rawPalette", role: "accessible evergreen text on light" },
  { name: "--bw-rust-700", value: "#A23A33", group: "rawPalette", role: "accessible danger text on light" },
  { name: "--bw-font-display", value: "'Fraunces', Georgia, serif", group: "typography", role: "display font" },
  { name: "--bw-font-sans", value: "'IBM Plex Sans', system-ui, sans-serif", group: "typography", role: "body and UI font" },
  { name: "--bw-font-mono", value: "'IBM Plex Mono', ui-monospace, monospace", group: "typography", role: "data and IDs font" },
  { name: "--bw-fs-display", value: "clamp(3rem, 6vw, 4.6rem)", group: "typography", role: "display size" },
  { name: "--bw-fs-title", value: "2.4rem", group: "typography", role: "page title size" },
  { name: "--bw-fs-h2", value: "1.6rem", group: "typography", role: "section title size" },
  { name: "--bw-fs-subhead", value: "1.25rem", group: "typography", role: "subhead size" },
  { name: "--bw-fs-body", value: "1rem", group: "typography", role: "body size" },
  { name: "--bw-fs-sm", value: "0.875rem", group: "typography", role: "small body size" },
  { name: "--bw-fs-label", value: "0.75rem", group: "typography", role: "label size" },
  { name: "--bw-sp-1", value: "4px", group: "spacing", role: "4-point unit 1" },
  { name: "--bw-sp-2", value: "8px", group: "spacing", role: "4-point unit 2" },
  { name: "--bw-sp-3", value: "12px", group: "spacing", role: "4-point unit 3" },
  { name: "--bw-sp-4", value: "16px", group: "spacing", role: "4-point unit 4" },
  { name: "--bw-sp-5", value: "24px", group: "spacing", role: "4-point unit 5" },
  { name: "--bw-sp-6", value: "32px", group: "spacing", role: "4-point unit 6" },
  { name: "--bw-sp-7", value: "48px", group: "spacing", role: "4-point unit 7" },
  { name: "--bw-sp-8", value: "64px", group: "spacing", role: "4-point unit 8" },
  { name: "--bw-sp-9", value: "92px", group: "spacing", role: "4-point unit 9" },
  { name: "--bw-r-chip", value: "5px", group: "radii", role: "chip radius" },
  { name: "--bw-r-card", value: "12px", group: "radii", role: "card radius" },
  { name: "--bw-r-pill", value: "999px", group: "radii", role: "pill radius" },
  { name: "--bw-shadow-1", value: "0 1px 2px rgba(0,0,0,0.4)", group: "effectsLayout", role: "small shadow" },
  { name: "--bw-shadow-2", value: "0 8px 28px rgba(0,0,0,0.45)", group: "effectsLayout", role: "large shadow" },
  { name: "--bw-track-label", value: "0.22em", group: "effectsLayout", role: "mono label tracking" },
  { name: "--bw-sidebar-w", value: "248px", group: "effectsLayout", role: "sidebar width" },
  { name: "--bw-bg", value: "var(--bw-ink-900)", group: "semantic", theme: "dark", role: "background" },
  { name: "--bw-surface", value: "var(--bw-ink-800)", group: "semantic", theme: "dark", role: "surface" },
  { name: "--bw-surface-2", value: "var(--bw-ink-700)", group: "semantic", theme: "dark", role: "secondary surface" },
  { name: "--bw-inset", value: "var(--bw-ink-600)", group: "semantic", theme: "dark", role: "inset" },
  { name: "--bw-border", value: "var(--bw-hair)", group: "semantic", theme: "dark", role: "border" },
  { name: "--bw-topbar", value: "rgba(8, 10, 9, 0.82)", group: "semantic", theme: "dark", role: "topbar overlay" },
  { name: "--bw-text", value: "var(--bw-frost-100)", group: "semantic", theme: "dark", role: "primary text" },
  { name: "--bw-text-body", value: "var(--bw-frost-300)", group: "semantic", theme: "dark", role: "body text" },
  { name: "--bw-text-muted", value: "var(--bw-frost-500)", group: "semantic", theme: "dark", role: "muted text" },
  { name: "--bw-text-faint", value: "var(--bw-frost-700)", group: "semantic", theme: "dark", role: "faint text" },
  { name: "--bw-accent", value: "var(--bw-amber)", group: "semantic", theme: "dark", role: "action fill" },
  { name: "--bw-accent-text", value: "var(--bw-amber)", group: "semantic", theme: "dark", role: "accent text" },
  { name: "--bw-on-accent", value: "var(--bw-ink-900)", group: "semantic", theme: "dark", role: "text on accent fill" },
  { name: "--bw-brand-text", value: "var(--bw-ever-300)", group: "semantic", theme: "dark", role: "brand text" },
  { name: "--bw-success", value: "var(--bw-lichen)", group: "semantic", theme: "dark", role: "success fill" },
  { name: "--bw-success-text", value: "var(--bw-lichen)", group: "semantic", theme: "dark", role: "success text" },
  { name: "--bw-danger", value: "var(--bw-rust)", group: "semantic", theme: "dark", role: "danger fill" },
  { name: "--bw-danger-text", value: "var(--bw-rust)", group: "semantic", theme: "dark", role: "danger text" },
  { name: "--bw-bg", value: "var(--bw-paper-200)", group: "semantic", theme: "light", role: "background" },
  { name: "--bw-surface", value: "var(--bw-paper-100)", group: "semantic", theme: "light", role: "surface" },
  { name: "--bw-surface-2", value: "var(--bw-paper-300)", group: "semantic", theme: "light", role: "secondary surface" },
  { name: "--bw-inset", value: "var(--bw-paper-400)", group: "semantic", theme: "light", role: "inset" },
  { name: "--bw-border", value: "var(--bw-paper-500)", group: "semantic", theme: "light", role: "border" },
  { name: "--bw-topbar", value: "rgba(245, 248, 246, 0.82)", group: "semantic", theme: "light", role: "topbar overlay" },
  { name: "--bw-text", value: "var(--bw-ink-800)", group: "semantic", theme: "light", role: "primary text" },
  { name: "--bw-text-body", value: "var(--bw-ink-500)", group: "semantic", theme: "light", role: "body text" },
  { name: "--bw-text-muted", value: "var(--bw-frost-700)", group: "semantic", theme: "light", role: "muted text" },
  { name: "--bw-text-faint", value: "var(--bw-frost-500)", group: "semantic", theme: "light", role: "faint text" },
  { name: "--bw-accent", value: "var(--bw-amber)", group: "semantic", theme: "light", role: "action fill" },
  { name: "--bw-accent-text", value: "var(--bw-amber-700)", group: "semantic", theme: "light", role: "accent text" },
  { name: "--bw-on-accent", value: "var(--bw-ink-900)", group: "semantic", theme: "light", role: "text on accent fill" },
  { name: "--bw-brand-text", value: "var(--bw-ever-600)", group: "semantic", theme: "light", role: "brand text" },
  { name: "--bw-success", value: "var(--bw-lichen)", group: "semantic", theme: "light", role: "success fill" },
  { name: "--bw-success-text", value: "var(--bw-ever-500)", group: "semantic", theme: "light", role: "success text" },
  { name: "--bw-danger", value: "var(--bw-rust)", group: "semantic", theme: "light", role: "danger fill" },
  { name: "--bw-danger-text", value: "var(--bw-rust-700)", group: "semantic", theme: "light", role: "danger text" }
];

export const borealInteractionRules = [
  {
    id: "focus-visible-ring",
    category: "focus",
    rule: "Interactive elements use :focus-visible with a 2px var(--bw-accent) outline and 2px offset.",
    appliesTo: ["button", "a[href]", "input", "select", "textarea", "[role='button']", "[tabindex]"]
  },
  {
    id: "keyboard-parity",
    category: "keyboard",
    rule: "Every pointer action has an Enter or Space path; escape closes transient panels without changing state.",
    appliesTo: ["CommandPalette", "ConfirmDialog", "DetailDrawer", "QuickActionMenu", "BoardViewSwitcher"]
  },
  {
    id: "compact-dashboard-density",
    category: "density",
    rule: "Dashboard rows keep stable 36px minimum height, 8px horizontal rhythm, and predictable column tracks.",
    appliesTo: ["Task Rows", "ReadyQueuePanel", "SprintWorkTable", "EventStreamTable", "ClaimsTable"]
  },
  {
    id: "stable-responsive-frames",
    category: "responsive",
    rule: "Boards, tables, drawers, and split panes define min/max dimensions so hover and dynamic content cannot resize the layout.",
    appliesTo: ["SprintKanbanBoard", "BoardTableView", "SplitPane", "DetailDrawer", "GraphCanvas"]
  },
  {
    id: "text-overflow-contract",
    category: "text",
    rule: "Buttons, chips, cards, and table cells use wrapping or ellipsis boundaries so labels cannot overlap adjacent content.",
    appliesTo: ["Buttons", "LabelChip", "EntityChip", "MetricCard", "SprintKanbanCard", "InlineNotice"]
  }
] as const satisfies readonly InteractionRule[];

export const borealIconStrategy = {
  packageName: "lucide-react",
  scope: "apps/console",
  status: "deferred-until-console-scaffold",
  importPolicy: "Use named imports inside apps/console only; do not expose lucide-react through shared runtime packages.",
  machineOutputPolicy: "Icons are browser-only decoration or affordance labels. JSON output and CLI machine-readable output stay text-first."
} as const satisfies IconStrategy;

export const borealIconRegistry = [
  { intent: "dashboard", icon: "LayoutDashboard", surface: "global" },
  { intent: "sprint-board", icon: "Kanban", surface: "sprint" },
  { intent: "work-list", icon: "ListTodo", surface: "sprint" },
  { intent: "search", icon: "Search", surface: "global" },
  { intent: "filter", icon: "Filter", surface: "foundation" },
  { intent: "refresh", icon: "RefreshCw", surface: "operations" },
  { intent: "start", icon: "Play", surface: "sprint" },
  { intent: "close", icon: "Check", surface: "foundation" },
  { intent: "cancel", icon: "X", surface: "foundation" },
  { intent: "warning", icon: "AlertTriangle", surface: "foundation" },
  { intent: "lock", icon: "Lock", surface: "operations" },
  { intent: "unlock", icon: "Unlock", surface: "operations" },
  { intent: "branch", icon: "GitBranch", surface: "operations" },
  { intent: "merge", icon: "GitMerge", surface: "operations" },
  { intent: "database", icon: "Database", surface: "operations" },
  { intent: "document", icon: "FileText", surface: "entity" },
  { intent: "verify", icon: "ClipboardCheck", surface: "entity" },
  { intent: "settings", icon: "Settings", surface: "global" },
  { intent: "import", icon: "Upload", surface: "operations" },
  { intent: "export", icon: "Download", surface: "operations" },
  { intent: "open-external", icon: "ExternalLink", surface: "entity" },
  { intent: "command", icon: "Command", surface: "global" },
  { intent: "create", icon: "Plus", surface: "foundation" },
  { intent: "edit", icon: "Pencil", surface: "entity" },
  { intent: "delete", icon: "Trash2", surface: "foundation" }
] as const satisfies readonly IconMapping[];

export function listDesignTokens(input: {
  readonly group?: DesignTokenGroup;
  readonly theme?: DesignTheme;
} = {}): readonly DesignTokenDeclaration[] {
  return borealDesignTokens.filter((token) => {
    if (input.group && token.group !== input.group) return false;
    if (input.theme && token.theme !== input.theme) return false;
    return true;
  });
}

export function findDesignToken(name: string, theme?: DesignTheme): DesignTokenDeclaration | undefined {
  return borealDesignTokens.find((token) => token.name === name && (!theme || token.theme === theme));
}

export function summarizeDesignSystem(): DesignSystemSummary {
  const groups: readonly DesignTokenGroup[] = [
    "rawPalette",
    "typography",
    "spacing",
    "radii",
    "effectsLayout",
    "semantic"
  ];
  return {
    sourcePath: borealDesignTokenSource.path,
    totalTokenDeclarations: borealDesignTokens.length,
    tokenGroups: groups.map((group) => ({ group, count: listDesignTokens({ group }).length })),
    themedSemanticTokens: (["dark", "light"] as const).map((theme) => ({
      theme,
      count: listDesignTokens({ group: "semantic", theme }).length
    })),
    interactionRuleCount: borealInteractionRules.length,
    iconCount: borealIconRegistry.length
  };
}
