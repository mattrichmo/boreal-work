// Pure fuzzy search over the dashboard's sprints, tasks, and events. Kept free
// of React/data so ranking can be unit-tested.

export type SearchKind = "sprint" | "task" | "event";

export interface SearchItem {
  readonly kind: SearchKind;
  readonly id: string;
  readonly label: string;
  readonly hint: string;
}

export interface SearchResult extends SearchItem {
  readonly score: number;
}

// Subsequence match: lower score is a better match. Rewards earlier and more
// contiguous matches. Returns null when the query is not a subsequence.
export function fuzzyScore(query: string, text: string): number | null {
  if (query.length === 0) return 0;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let score = 0;
  let from = 0;
  let previous = -1;
  for (const char of needle) {
    const index = haystack.indexOf(char, from);
    if (index === -1) return null;
    score += index; // earlier matches score lower
    if (previous >= 0 && index !== previous + 1) score += (index - previous) * 2; // penalise gaps
    previous = index;
    from = index + 1;
  }
  return score;
}

const KIND_ORDER: Readonly<Record<SearchKind, number>> = { sprint: 0, task: 1, event: 2 };

export function searchItems(items: readonly SearchItem[], query: string, limit = 50): readonly SearchResult[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return items.slice(0, limit).map((item) => ({ ...item, score: 0 }));
  }
  const scored: SearchResult[] = [];
  for (const item of items) {
    const score = fuzzyScore(trimmed, item.label);
    if (score !== null) scored.push({ ...item, score });
  }
  scored.sort((a, b) => a.score - b.score || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label));
  return scored.slice(0, limit);
}
