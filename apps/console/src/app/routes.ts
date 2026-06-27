import { createElement, type ReactNode } from "react";
import {
  Activity,
  Database,
  FileBarChart,
  Gauge,
  KanbanSquare,
  ListChecks,
  Settings,
  ShieldCheck
} from "lucide-react";

export type ConsoleRouteId = "global" | "health" | "knowledge" | "repo" | "reports" | "settings" | "sprint" | "work";

export interface ConsoleRoute {
  readonly id: ConsoleRouteId;
  readonly path: string;
  readonly label: string;
  readonly icon: ReactNode;
}

export const CONSOLE_ROUTES: readonly ConsoleRoute[] = [
  { id: "global", path: "/", label: "Global", icon: createElement(Gauge, { size: 18, strokeWidth: 1.8 }) },
  { id: "sprint", path: "/sprint", label: "Sprint", icon: createElement(KanbanSquare, { size: 18, strokeWidth: 1.8 }) },
  { id: "knowledge", path: "/knowledge", label: "Knowledge", icon: createElement(Database, { size: 18, strokeWidth: 1.8 }) },
  { id: "repo", path: "/repo", label: "Repo", icon: createElement(Activity, { size: 18, strokeWidth: 1.8 }) },
  { id: "reports", path: "/reports", label: "Reports", icon: createElement(FileBarChart, { size: 18, strokeWidth: 1.8 }) },
  { id: "settings", path: "/settings", label: "Settings", icon: createElement(Settings, { size: 18, strokeWidth: 1.8 }) },
  { id: "work", path: "/work", label: "Work", icon: createElement(ListChecks, { size: 18, strokeWidth: 1.8 }) },
  { id: "health", path: "/health", label: "Health", icon: createElement(ShieldCheck, { size: 18, strokeWidth: 1.8 }) }
];

export function routeFromPath(pathname: string): ConsoleRoute {
  const pathOnly = pathname.split(/[?#]/, 1)[0] || "/";
  const withoutSlash = pathOnly.endsWith("/") && pathOnly !== "/" ? pathOnly.slice(0, -1) : pathOnly;
  return CONSOLE_ROUTES.find((route) => route.path === withoutSlash) ?? CONSOLE_ROUTES[0] ?? {
    id: "global",
    path: "/",
    label: "Overview",
    icon: createElement(Activity, { size: 18, strokeWidth: 1.8 })
  };
}
