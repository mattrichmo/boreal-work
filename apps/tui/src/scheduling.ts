import type { BusinessDateDto, ExternalWaitAccountableDto } from "./client.js";

const pad = (value: number): string => String(value).padStart(2, "0");

function isCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 0 || year > 9999 || !Number.isInteger(month) || !Number.isInteger(day))
    return false;
  const daysInMonth = [31, ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return daysInMonth !== undefined && day >= 1 && day <= daysInMonth;
}

/** Render a typed business date without converting its persisted semantics. */
export function businessDateLabel(value: BusinessDateDto | null | undefined, fallback = "Not scheduled"): string {
  if (!value) return fallback;
  if (value.kind === "local_date") return `${String(value.year).padStart(4, "0")}-${pad(value.month)}-${pad(value.day)} (civil date)`;
  if (value.kind === "instant") {
    const date = new Date(value.at_ms);
    return Number.isNaN(date.getTime()) ? "Invalid instant returned by service" : `${date.toISOString()} (instant)`;
  }
  const local = value.nominal_local;
  const date = `${String(local.year).padStart(4, "0")}-${pad(local.month)}-${pad(local.day)}`;
  const time = `${pad(local.hour)}:${pad(local.minute)}${local.second ? `:${pad(local.second)}` : ""}`;
  const offset = value.utc_offset_minutes;
  const sign = offset < 0 ? "−" : "+";
  const absoluteOffset = Math.abs(offset);
  return `${date}T${time} ${value.timezone} (UTC${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)})`;
}

/**
 * Use date-only fields for ordinary scheduling. A blank value explicitly
 * clears that optional date; unchanged existing instants/resolved dates retain
 * their original typed representation.
 */
export function businessDateFromInput(input: string, previous?: BusinessDateDto | null): BusinessDateDto | null {
  const value = input.trim();
  if (!value) return null;
  if (previous && value === businessDateInput(previous)) return previous;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw new Error("Enter a date as YYYY-MM-DD, or leave it blank to clear it.");
  const [, rawYear, rawMonth, rawDay] = match;
  const year = Number(rawYear), month = Number(rawMonth), day = Number(rawDay);
  if (!isCalendarDate(year, month, day))
    throw new Error("Enter a real calendar date as YYYY-MM-DD.");
  return { kind: "local_date", year, month, day };
}

export function businessDateInput(value: BusinessDateDto | null | undefined): string {
  if (!value) return "";
  if (value.kind === "local_date")
    return `${String(value.year).padStart(4, "0")}-${pad(value.month)}-${pad(value.day)}`;
  if (value.kind === "instant") {
    const date = new Date(value.at_ms);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }
  return `${String(value.nominal_local.year).padStart(4, "0")}-${pad(value.nominal_local.month)}-${pad(value.nominal_local.day)}`;
}

export function accountableLabel(value: ExternalWaitAccountableDto | null | undefined): string {
  if (!value) return "Accountable party unavailable";
  return value.kind === "role" ? `role ${value.role}` : `${value.kind} ${value.display_name} (${value.reference})`;
}

export function timestampLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Invalid time returned by service" : date.toISOString();
}
