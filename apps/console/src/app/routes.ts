import { createElement, type ReactNode } from "react";
import {
  Activity,
  Database,
  FileBarChart,
  Gauge,
  Globe,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShieldCheck
} from "lucide-react";

import type { ConsoleScope } from "./types.js";

export type ConsoleRouteId =
  | "overview"
  | "global"
  | "health"
  | "knowledge"
  | "repo"
  | "reports"
  | "settings"
  | "sprint"
  | "work";

export interface ConsoleRoute {
  readonly id: ConsoleRouteId;
  readonly path: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly scopes: readonly ConsoleScope[];
}

export const CONSOLE_ROUTES: readonly ConsoleRoute[] = [
  { id: "overview", path: "/", label: "Overview", icon: createElement(LayoutDashboard, { size: 18, strokeWidth: 1.8 }), scopes: ["repo"] },
  { id: "sprint", path: "/sprint", label: "Sprint", icon: createElement(KanbanSquare, { size: 18, strokeWidth: 1.8 }), scopes: ["repo"] },
  { id: "knowledge", path: "/knowledge", label: "Knowledge", icon: createElement(Database, { size: 18, strokeWidth: 1.8 }), scopes: ["repo"] },
  { id: "work", path: "/work", label: "Work", icon: createElement(ListChecks, { size: 18, strokeWidth: 1.8 }), scopes: ["repo"] },
  { id: "reports", path: "/reports", label: "Reports", icon: createElement(FileBarChart, { size: 18, strokeWidth: 1.8 }), scopes: ["repo"] },
  { id: "repo", path: "/repo", label: "Repo", icon: createElement(Activity, { size: 18, strokeWidth: 1.8 }), scopes: ["repo"] },
  { id: "health", path: "/health", label: "Health", icon: createElement(ShieldCheck, { size: 18, strokeWidth: 1.8 }), scopes: ["repo"] },
  { id: "global", path: "/", label: "Global", icon: createElement(Globe, { size: 18, strokeWidth: 1.8 }), scopes: ["global"] },
  { id: "settings", path: "/settings", label: "Projects", icon: createElement(Settings, { size: 18, strokeWidth: 1.8 }), scopes: ["global"] }
];

export function routesForScope(scope: ConsoleScope): readonly ConsoleRoute[] {
  return CONSOLE_ROUTES.filter((route) => route.scopes.includes(scope));
}

export function isKnownConsoleRoute(pathname: string, scope: ConsoleScope): boolean {
  const pathOnly = pathname.split(/[?#]/, 1)[0] || "/";
  const withoutSlash = pathOnly.endsWith("/") && pathOnly !== "/" ? pathOnly.slice(0, -1) : pathOnly;
  return routesForScope(scope).some((route) => route.path === withoutSlash);
}

export function routeFromPath(pathname: string, scope: ConsoleScope = "repo"): ConsoleRoute {
  const routes = routesForScope(scope);
  const pathOnly = pathname.split(/[?#]/, 1)[0] || "/";
  const withoutSlash = pathOnly.endsWith("/") && pathOnly !== "/" ? pathOnly.slice(0, -1) : pathOnly;
  return routes.find((route) => route.path === withoutSlash) ?? routes[0] ?? CONSOLE_ROUTES[0] ?? {
    id: "overview",
    path: "/",
    label: "Overview",
    icon: createElement(Gauge, { size: 18, strokeWidth: 1.8 }),
    scopes: ["repo"]
  };
}
