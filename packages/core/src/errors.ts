import type { EnforcementGap } from "./enforcement-gaps.js";

export type BorealErrorCode =
  | "BOREAL_INVALID_INPUT"
  | "BOREAL_NOT_FOUND"
  | "BOREAL_CONFLICT"
  | "BOREAL_POLICY_VIOLATION"
  | "BOREAL_STORAGE_ERROR"
  | "BOREAL_COMMAND_TIMEOUT"
  | "BOREAL_COMMAND_OUTPUT_LIMIT"
  | "BOREAL_JSON_PARSE"
  | "BOREAL_UNSAFE_UNICODE"
  | "BOREAL_INVARIANT";

export class BorealError extends Error {
  readonly code: BorealErrorCode;
  readonly details: unknown;
  readonly gaps?: readonly EnforcementGap[];

  constructor(code: BorealErrorCode, message: string, details?: unknown, gaps?: readonly EnforcementGap[]) {
    super(message);
    this.name = "BorealError";
    this.code = code;
    this.details = details;
    this.gaps = gaps;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function invariant(
  condition: unknown,
  code: BorealErrorCode,
  message: string,
  details?: unknown
): asserts condition {
  if (!condition) {
    throw new BorealError(code, message, details);
  }
}

export function isBorealError(error: unknown): error is BorealError {
  return error instanceof BorealError;
}
