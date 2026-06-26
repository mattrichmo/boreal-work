import { randomBytes } from "node:crypto";

import { hashContent } from "./hash.js";

export type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };

export type BorealId = Brand<string, "BorealId">;
export type AgentId = Brand<string, "AgentId">;
export type ClaimId = Brand<string, "ClaimId">;
export type ContentHash = Brand<string, "ContentHash">;
export type DecisionId = Brand<string, "DecisionId">;
export type EventId = Brand<string, "EventId">;
export type EvidenceId = Brand<string, "EvidenceId">;
export type GraphEdgeId = Brand<string, "GraphEdgeId">;
export type KnowledgeSourceId = Brand<string, "KnowledgeSourceId">;
export type OperationId = Brand<string, "OperationId">;
export type ProjectionId = Brand<string, "ProjectionId">;
export type ReservationId = Brand<string, "ReservationId">;
export type VerificationId = Brand<string, "VerificationId">;
export type WorkId = Brand<string, "WorkId">;

export type EntityPrefix =
  | "agent"
  | "claim"
  | "decision"
  | "edge"
  | "event"
  | "evidence"
  | "operation"
  | "projection"
  | "reservation"
  | "source"
  | "verification"
  | "work";

const BOREAL_ID_PATTERN = /^bw_[a-z][a-z0-9_]*_[a-f0-9]{12,64}$/;

export function deterministicId<TId extends string = BorealId>(
  prefix: EntityPrefix,
  seed: unknown,
  length = 16
): TId {
  const digest = hashContent({ prefix, seed }).replace("sha256:", "");
  return `bw_${prefix}_${digest.slice(0, length)}` as TId;
}

export function randomId<TId extends string = BorealId>(prefix: EntityPrefix, bytes = 16): TId {
  return `bw_${prefix}_${randomBytes(bytes).toString("hex")}` as TId;
}

export function isBorealId(value: unknown): value is BorealId {
  return typeof value === "string" && BOREAL_ID_PATTERN.test(value);
}

export function assertBorealId(value: unknown, label = "id"): asserts value is BorealId {
  if (!isBorealId(value)) {
    throw new TypeError(`${label} must be a Boreal id`);
  }
}
