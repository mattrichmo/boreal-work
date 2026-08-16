import { Box, Text } from "ink";

import type { ProjectRegistryView } from "@boreal/ui-model";
import { globalRouteState, globalStatusLabels, type GlobalRouteState } from "./global-overview.js";
import { COLOR, healthColor } from "../theme.js";
import { fit } from "../theme.js";
import { Table, type TableColumn, type TableRow } from "../ui.js";

function projectState(entry: ProjectRegistryView["entries"][number]): string {
  if (entry.health === "missing" || entry.lifecycle === "missing") return "missing";
  if (entry.stale || entry.syncFreshness === "stale") return "stale";
  return entry.syncFreshness;
}

function projectStateColor(entry: ProjectRegistryView["entries"][number]): string {
  const state = projectState(entry);
  return state === "missing" || state === "stale" ? COLOR.warn : state === "fresh" ? COLOR.accent : COLOR.faint;
}

function projectColumnWidths(width: number): { readonly compact: boolean; readonly widths: readonly number[] } {
  const total = Math.max(1, width - 2);
  const compact = width < 76;
  if (compact) {
    const fixed = 8 + 5 + 12 + 10;
    return { compact, widths: [8, 5, Math.max(1, total - fixed), 12, 10] };
  }
  const fixed = 9 + 6 + 7 + 7 + 9 + 12;
  return { compact, widths: [9, 6, Math.max(1, total - fixed), 7, 7, 9, 12] };
}

export function GlobalProjectsRoute({
  body,
  cursor,
  height,
  width,
  state
}: {
  readonly body: ProjectRegistryView;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
  readonly state?: GlobalRouteState;
}) {
  const embedded = globalRouteState(body, state);
  const derivedState: GlobalRouteState = {
    ...embedded,
    stale: embedded.stale ?? body.entries.some((entry) => entry.stale || entry.syncFreshness === "stale"),
    missing: embedded.missing ?? body.entries.some((entry) => entry.health === "missing" || entry.lifecycle === "missing"),
    sampled: embedded.sampled ?? body.entries.length < body.summary.totalProjects
  };
  const layout = projectColumnWidths(width);
  const [healthWidth, actionWidth, projectWidth, openWidth, readyWidth, blockedWidth, stateWidth] = layout.widths;
  const columns: readonly TableColumn[] = layout.compact
    ? [
        { header: "health", width: healthWidth ?? 1 },
        { header: "action", width: actionWidth ?? 1 },
        { header: "project", width: projectWidth ?? 1 },
        { header: "open/ready/blocked", width: openWidth ?? 1, align: "right" },
        { header: "state", width: readyWidth ?? 1 }
      ]
    : [
        { header: "health", width: healthWidth ?? 1 },
        { header: "action", width: actionWidth ?? 1 },
        { header: "project", width: projectWidth ?? 1 },
        { header: "open", width: openWidth ?? 1, align: "right" },
        { header: "ready", width: readyWidth ?? 1, align: "right" },
        { header: "blocked", width: blockedWidth ?? 1, align: "right" },
        { header: "state", width: stateWidth ?? 1 }
      ];
  const rows: readonly TableRow[] = body.entries.map((entry) => {
    const missing = entry.health === "missing" || entry.lifecycle === "missing";
    const health = entry.health;
    const common = [
      { text: health, color: missing ? COLOR.warn : healthColor(health) },
      { text: missing ? "link" : "open", color: missing ? COLOR.warn : COLOR.accent },
      { text: fit(entry.name, projectWidth ?? 1), color: COLOR.text }
    ];
    if (layout.compact) {
      return {
        key: entry.id,
        cells: [
          ...common,
          { text: `${entry.openWorkCount}/${entry.readyWorkCount}/${entry.blockedWorkCount}`, color: entry.blockedWorkCount > 0 ? COLOR.warn : COLOR.muted },
          { text: projectState(entry), color: projectStateColor(entry) }
        ]
      };
    }
    return {
      key: entry.id,
      cells: [
        ...common,
        { text: String(entry.openWorkCount), color: COLOR.muted },
        { text: String(entry.readyWorkCount), color: COLOR.accent },
        { text: String(entry.blockedWorkCount), color: entry.blockedWorkCount > 0 ? COLOR.warn : COLOR.faint },
        { text: projectState(entry), color: projectStateColor(entry) }
      ]
    };
  });
  const statusLabels = globalStatusLabels(derivedState);
  const selectedProject = body.entries[cursor];
  return (
    <Box flexDirection="column">
      <Text color={COLOR.faint} wrap="truncate">
      {`PROJECTS · showing ${body.entries.length}/${body.summary.totalProjects} · ENTER opens repo; missing rows show a link command`}
      </Text>
      {statusLabels.length > 0 ? <Text color={derivedState.missing || derivedState.stale ? COLOR.warn : COLOR.faint}>{`DATA STATE · ${statusLabels.join(" · ")}`}</Text> : null}
      {derivedState.warnings?.map((warning) => <Text key={warning} color={COLOR.warn} wrap="truncate">{`⚠ ${warning}`}</Text>)}
      <Table
        columns={columns}
        rows={rows}
        cursor={cursor}
        height={Math.max(1, height - (statusLabels.length > 0 ? 6 : 5))}
        width={width}
        emptyLabel="No linked projects — run `bwrk global link <path>`."
      />
      {selectedProject ? <Text color={COLOR.muted} wrap="truncate">{fit(`TARGET · ${selectedProject.projectRoot} · ${selectedProject.lifecycle} · memory ${selectedProject.memoryLayout}`, Math.max(1, width - 2))}</Text> : null}
    </Box>
  );
}
