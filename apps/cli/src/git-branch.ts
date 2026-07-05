import { basename, dirname, join } from "node:path";

import type { WorkItem } from "@boreal/core";

export type BranchableWork = Pick<WorkItem, "title"> & {
  readonly kind: WorkItem["kind"] | "epic";
  readonly meta: { readonly id: string };
};

export function workBranchName(work: BranchableWork): string {
  return `${branchPrefix(work.kind)}/${shortWorkId(work.meta.id)}-${slugify(work.title)}`;
}

export function workWorktreePath(repoRoot: string, branch: string): string {
  return join(dirname(repoRoot), `${basename(repoRoot)}--${branch.replaceAll("/", "-")}`);
}

export function shortWorkId(id: string): string {
  const match = /^bw_work_([a-f0-9]+)$/i.exec(id);
  const hex = (match?.[1] ?? id.replaceAll(/[^a-f0-9]/gi, "")).toLowerCase();
  return hex.slice(-8) || "unknown";
}

export function slugify(title: string, maxLen = 40): string {
  const limit = Math.max(1, Math.trunc(maxLen));
  const slug = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, limit)
    .replace(/-+$/g, "");
  return slug || "work";
}

function branchPrefix(kind: BranchableWork["kind"]): "epic" | "sprint" | "work" {
  if (kind === "epic") {
    return "epic";
  }
  if (kind === "sprint") {
    return "sprint";
  }
  return "work";
}
