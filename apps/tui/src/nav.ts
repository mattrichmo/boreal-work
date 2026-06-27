// Pure navigation reducer for the terminal dashboard. Kept free of React and
// data so the full drill-in / back interaction can be unit-tested.

export type TuiSection = "overview" | "sprints" | "work" | "activity";

export type TuiScreen =
  | "overview"
  | "sprintList"
  | "sprintDetail"
  | "workList"
  | "taskDetail"
  | "activityList"
  | "activityDetail";

export interface NavFrame {
  readonly screen: TuiScreen;
  readonly cursor: number;
  readonly sprintId?: string;
  readonly taskId?: string;
  readonly eventId?: string;
}

export interface NavState {
  readonly section: TuiSection;
  /** Always at least one frame; the last entry is the active screen. */
  readonly stack: readonly NavFrame[];
}

export type NavAction =
  | { readonly type: "move"; readonly delta: number; readonly length: number }
  | { readonly type: "drill"; readonly id?: string }
  | { readonly type: "back" }
  | { readonly type: "section"; readonly section: TuiSection }
  | { readonly type: "jump"; readonly section: TuiSection; readonly stack: readonly NavFrame[] };

/** Build the section + frame stack to land directly on a search result's detail. */
export function jumpTo(kind: "sprint" | "task" | "event", id: string): { readonly section: TuiSection; readonly stack: readonly NavFrame[] } {
  if (kind === "sprint") {
    return { section: "sprints", stack: [rootFrame("sprints"), { screen: "sprintDetail", cursor: 0, sprintId: id }] };
  }
  if (kind === "event") {
    return { section: "activity", stack: [rootFrame("activity"), { screen: "activityDetail", cursor: 0, eventId: id }] };
  }
  return { section: "work", stack: [rootFrame("work"), { screen: "taskDetail", cursor: 0, taskId: id }] };
}

export const SECTIONS: readonly { readonly id: TuiSection; readonly label: string; readonly key: string }[] = [
  { id: "overview", label: "Overview", key: "o" },
  { id: "sprints", label: "Sprints", key: "s" },
  { id: "work", label: "Work", key: "w" },
  { id: "activity", label: "Activity", key: "a" }
];

export function rootFrame(section: TuiSection): NavFrame {
  if (section === "sprints") return { screen: "sprintList", cursor: 0 };
  if (section === "work") return { screen: "workList", cursor: 0 };
  if (section === "activity") return { screen: "activityList", cursor: 0 };
  return { screen: "overview", cursor: 0 };
}

export function initialNavState(section: TuiSection = "overview"): NavState {
  return { section, stack: [rootFrame(section)] };
}

export function topFrame(state: NavState): NavFrame {
  return state.stack[state.stack.length - 1] ?? rootFrame(state.section);
}

export function atRoot(state: NavState): boolean {
  return state.stack.length <= 1;
}

function clampCursor(cursor: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(cursor, length - 1));
}

function replaceTop(state: NavState, frame: NavFrame): NavState {
  return { ...state, stack: [...state.stack.slice(0, -1), frame] };
}

function drillFrame(top: NavFrame, id: string): NavFrame | undefined {
  if (top.screen === "sprintList") return { screen: "sprintDetail", cursor: 0, sprintId: id };
  if (top.screen === "sprintDetail") return { screen: "taskDetail", cursor: 0, sprintId: top.sprintId, taskId: id };
  if (top.screen === "workList") return { screen: "taskDetail", cursor: 0, taskId: id };
  if (top.screen === "activityList") return { screen: "activityDetail", cursor: 0, eventId: id };
  return undefined; // overview, taskDetail, activityDetail are leaves
}

export function reduceNav(state: NavState, action: NavAction): NavState {
  const top = topFrame(state);
  switch (action.type) {
    case "section":
      if (action.section === state.section && atRoot(state)) return state;
      return { section: action.section, stack: [rootFrame(action.section)] };
    case "move":
      return replaceTop(state, { ...top, cursor: clampCursor(top.cursor + action.delta, action.length) });
    case "back":
      return atRoot(state) ? state : { ...state, stack: state.stack.slice(0, -1) };
    case "jump":
      return { section: action.section, stack: action.stack.length > 0 ? action.stack : [rootFrame(action.section)] };
    case "drill": {
      if (!action.id) return state;
      const next = drillFrame(top, action.id);
      return next ? { ...state, stack: [...state.stack, next] } : state;
    }
    default:
      return state;
  }
}
