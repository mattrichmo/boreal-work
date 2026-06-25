import {
  createRecordMeta,
  deterministicId,
  type ActorRef,
  type EdgeKind,
  type GraphEdge,
  type GraphEdgeId,
  type IsoTimestamp,
  withContentHash
} from "@boreal/core";

export interface CreateGraphEdgeInput {
  readonly kind: EdgeKind;
  readonly fromId: string;
  readonly fromType: string;
  readonly toId: string;
  readonly toType: string;
  readonly directed?: boolean;
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
  readonly tags?: readonly string[];
}

export function makeGraphEdgeId(input: Pick<CreateGraphEdgeInput, "kind" | "fromId" | "toId">): GraphEdgeId {
  return deterministicId<GraphEdgeId>("edge", input);
}

export function createGraphEdge(input: CreateGraphEdgeInput): GraphEdge {
  const id = makeGraphEdgeId(input);
  return withContentHash({
    meta: createRecordMeta({
      id,
      now: input.now,
      actor: input.actor,
      tags: input.tags
    }),
    kind: input.kind,
    fromId: input.fromId,
    fromType: input.fromType,
    toId: input.toId,
    toType: input.toType,
    directed: input.directed ?? true
  });
}

export function hasPath(edges: readonly GraphEdge[], startId: string, targetId: string): boolean {
  const adjacency = buildAdjacency(edges);
  const seen = new Set<string>();
  const queue = [startId];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || seen.has(next)) {
      continue;
    }
    if (next === targetId) {
      return true;
    }
    seen.add(next);
    queue.push(...(adjacency.get(next) ?? []));
  }

  return false;
}

export function wouldCreateCycle(
  existingEdges: readonly GraphEdge[],
  proposedFromId: string,
  proposedToId: string
): boolean {
  return hasPath(existingEdges, proposedToId, proposedFromId);
}

export function buildAdjacency(edges: readonly GraphEdge[]): Map<string, readonly string[]> {
  const nextById = new Map<string, string[]>();
  for (const edge of edges) {
    if (!edge.directed) {
      addEdge(nextById, edge.toId, edge.fromId);
    }
    addEdge(nextById, edge.fromId, edge.toId);
  }
  return nextById;
}

function addEdge(adjacency: Map<string, string[]>, fromId: string, toId: string): void {
  const current = adjacency.get(fromId) ?? [];
  current.push(toId);
  adjacency.set(fromId, current);
}

