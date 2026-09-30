import { editInput, inputDisplay } from "./terminal/input.js";
import { cellWidth, safeText, wrapWords, graphemes, clusterWidth } from "./terminal/cells.js";

export type FieldKind = "text" | "multiline" | "choice" | "number" | "date";
export interface FormField {
  key: string;
  label: string;
  kind?: FieldKind;
  value: string;
  choices?: readonly string[];
  choiceLabels?: Readonly<Record<string, string>>;
  required?: boolean;
  hint?: string;
}
export interface FormState {
  title: string;
  fields: FormField[];
  active: number;
  cursors: number[];
  error?: string;
}
export function form(title: string, fields: FormField[]): FormState {
  return { title, fields: fields.map(f => ({ kind: "text", ...f })), active: 0, cursors: fields.map(f => graphemes(f.value).length) };
}
export function moveField(state: FormState, delta: number): void {
  state.active = Math.max(0, Math.min(state.fields.length - 1, state.active + delta));
  state.error = undefined;
}
export function editField(state: FormState, key: string): void {
  const field = state.fields[state.active];
  if (!field || field.kind === "choice") return;
  const result = editInput(field.value, state.cursors[state.active], key, 32768, field.kind === "multiline");
  field.value = result.value;
  state.cursors[state.active] = result.cursor;
  state.error = undefined;
}
export function cycleChoice(state: FormState, delta: number): void {
  const field = state.fields[state.active];
  if (field?.kind !== "choice" || !field.choices?.length) return;
  const at = field.choices.indexOf(field.value);
  field.value = field.choices[(Math.max(0, at) + delta + field.choices.length) % field.choices.length];
}
export function validateForm(state: FormState): Record<string, string | number | null> | undefined {
  const result: Record<string, string | number | null> = {};
  for (const field of state.fields) {
    const value = field.value;
    if (field.required && !value.trim()) { state.active = state.fields.indexOf(field); state.error = `${field.label} is required`; return; }
    if (field.kind === "number" && value.trim() && !Number.isFinite(Number(value))) { state.active = state.fields.indexOf(field); state.error = `${field.label} must be a number`; return; }
    result[field.key] = field.kind === "number" ? (value.trim() ? Number(value) : null) : value;
  }
  return result;
}
export function renderForm(state: FormState, width: number, height: number): string[] {
  const lines = [state.title, "Tab/↑↓ move · arrows change choices · Enter save/next · Esc cancel", "─".repeat(Math.max(1, width))];
  let activeLine = 3;
  state.fields.forEach((field, i) => {
    if (i === state.active) activeLine = lines.length;
    const marker = i === state.active ? "›" : " ";
    lines.push(`${marker} ${field.label}${field.required ? " *" : ""}`);
    const value = field.kind === "choice" ? `${field.choiceLabels?.[field.value] ?? field.value}  (${field.choices?.map(x => field.choiceLabels?.[x] ?? x).join(" / ") ?? ""})` : field.value;
    if (field.kind === "multiline") lines.push(...multilineLines(field.value, i === state.active ? state.cursors[i] : -1, Math.max(1, width - 4)).map(line => `  ${line}`));
    else if (i === state.active && field.kind !== "choice") lines.push(`  ${inputDisplay(value, state.cursors[i], Math.max(1, width - 4))}`);
    else lines.push(...wrapWords(value || "(empty)", Math.max(1, width - 4)).map(x => `  ${safeText(x)}`));
    if (field.hint) lines.push(`  ${field.hint}`);
  });
  if (state.error) lines.push(`Error: ${state.error}`);
  const available = Math.max(1, height);
  const start = Math.max(0, Math.min(lines.length - available, activeLine - Math.floor(available / 2)));
  return lines.slice(start, start + available);
}
function multilineLines(value: string, cursor: number, width: number): string[] {
  const parts = graphemes(value).map(part => part === "\n" ? part : safeText(part));
  const result: string[] = [];
  let line = "", used = 0;
  const push = (): void => { result.push(line); line = ""; used = 0; };
  for (let i = 0; i <= parts.length; i++) {
    if (i === cursor) { line += "▏"; used += 1; }
    if (i === parts.length) break;
    const part = parts[i];
    if (part === "\n") { push(); continue; }
    const size = clusterWidth(part);
    if (used + size > width && line) push();
    line += part; used += size;
  }
  if (result.length === 0 || line || value.endsWith("\n")) push();
  return result.length ? result : ["▏"];
}
export function parseLabels(value: string): string[] { return value.split(",").map(x => x.trim()).filter(Boolean); }
export function formWidth(state: FormState): number { return Math.max(0, ...state.fields.map(f => cellWidth(f.label))); }
