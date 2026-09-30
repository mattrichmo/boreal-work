import { editInput, inputDisplay } from "./terminal/input.js";
import { cellWidth, safeText, wrapWords, graphemes, clusterWidth } from "./terminal/cells.js";

export type FieldKind = "text" | "multiline" | "choice" | "picker" | "number" | "date";
export interface FormField {
  key: string;
  label: string;
  kind?: FieldKind;
  value: string;
  choices?: readonly string[];
  choiceLabels?: Readonly<Record<string, string>>;
  required?: boolean;
  hint?: string;
  excludeId?: string;
  touched?: boolean;
  requireChoiceOnOwnerChange?: boolean;
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
  if (!field || field.kind === "choice" || field.kind === "picker") return;
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
    if (field.required && !value.trim() && field.kind !== "picker") { state.active = state.fields.indexOf(field); state.error = `${field.label} is required`; return; }
    if (field.kind === "picker" && field.required && (!field.touched || !(field.choices ?? []).includes(value))) { state.active = state.fields.indexOf(field); state.error = `Choose a valid ${field.label.toLocaleLowerCase()} for this destination`; return; }
    if (field.kind === "number" && value.trim() && !Number.isFinite(Number(value))) { state.active = state.fields.indexOf(field); state.error = `${field.label} must be a number`; return; }
    if (field.kind === "number" && value.trim() && (Number(value) < 0 || Number(value) > 255 || !Number.isInteger(Number(value)))) { state.active = state.fields.indexOf(field); state.error = `${field.label} must be a whole number from 0 to 255`; return; }
    if (field.kind === "date" && value.trim() && !validDate(value.trim())) { state.active = state.fields.indexOf(field); state.error = `${field.label} must be YYYY-MM-DD or an ISO timestamp`; return; }
    result[field.key] = field.kind === "number" ? (value.trim() ? Number(value) : null) : value;
  }
  return result;
}
export function renderForm(state: FormState, width: number, height: number): string[] {
  const w = Math.max(1, width), total = Math.max(1, height);
  const header = [safeText(state.title), "Tab/↑↓ fields · ←→ edit or choose · Enter newline/next · Ctrl-S save · Esc cancel", "─".repeat(w)];
  const footer = [state.error ? `Error: ${safeText(state.error)}` : "", "Enter newline in multiline fields · Ctrl-S save · Esc cancel"];
  const content: string[] = [];
  let cursorLine = 0;
  state.fields.forEach((field, i) => {
    const active = i === state.active, marker = active ? "› " : "  ";
    content.push(`${marker}${field.label}${field.required ? " *" : ""}`);
    const value = field.kind === "choice" || field.kind === "picker"
      ? (field.choiceLabels?.[field.value] ?? (field.value || "(choose)"))
      : field.value;
    if (field.kind === "multiline") {
      const rendered = multilineLines(field.value, active ? state.cursors[i] : -1, Math.max(1, w - 4));
      if (active) cursorLine = content.length + rendered.cursorLine;
      content.push(...rendered.lines.map(line => `  ${line.text}`));
    } else if (active && field.kind !== "choice" && field.kind !== "picker") {
      if (field.kind === "date") content.push(`  ${inputDisplay(value, state.cursors[i], Math.max(1, w - 4))}`);
      else content.push(`  ${inputDisplay(value, state.cursors[i], Math.max(1, w - 4))}`);
      if (active) cursorLine = content.length - 1;
    } else content.push(...wrapWords(value || "(empty)", Math.max(1, w - 4)).map(x => `  ${safeText(x)}`));
    const hint = field.hint ?? (field.kind === "date" ? "Date: YYYY-MM-DD uses the UTC calendar date; timestamps need Z or an explicit offset" : field.kind === "number" ? "Priority: whole number from 0 to 255" : undefined);
    if (hint) content.push(...wrapWords(hint, Math.max(1, w - 4)).map(x => `  ${x}`));
    if (field.kind === "picker" && !field.choices?.length) content.push("  No choices available for this destination.");
  });
  const fixed = Math.min(total, header.length + footer.length);
  const room = Math.max(0, total - fixed), start = Math.max(0, Math.min(Math.max(0, content.length - room), cursorLine - Math.floor(room / 2)));
  const visible = content.slice(start, start + room);
  const output = [...header.slice(0, total), ...visible];
  if (output.length < total && total > header.length) output.push(...footer.slice(0, total - output.length));
  return output.slice(0, total);
}
function multilineLines(value: string, cursor: number, width: number): { lines: Array<{text:string}>; cursorLine:number } {
  const parts = graphemes(value).map(part => part === "\n" ? part : safeText(part));
  const result: Array<{text:string}> = [];
  let line = "", used = 0;
  let cursorLine = 0, lineNo = 0;
  const push = (): void => { result.push({text:line}); line = ""; used = 0; lineNo++; };
  for (let i = 0; i <= parts.length; i++) {
    if (i === cursor) { line += "▏"; used += 1; cursorLine = lineNo; }
    if (i === parts.length) break;
    const part = parts[i];
    if (part === "\n") { push(); continue; }
    const size = clusterWidth(part);
    if (used + size > width && line) push();
    line += part; used += size;
  }
  if (result.length === 0 || line || value.endsWith("\n")) push();
  return {lines:result.length ? result : [{text:"▏"}],cursorLine};
}
function validDate(value:string):boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) ? (()=>{const d=new Date(`${value}T00:00:00Z`);return Number.isFinite(d.getTime())&&d.getUTCFullYear()===Number(value.slice(0,4))&&d.getUTCMonth()+1===Number(value.slice(5,7))&&d.getUTCDate()===Number(value.slice(8,10));})() : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value)); }
export function parseLabels(value: string): string[] { return value.split(",").map(x => x.trim()).filter(Boolean); }
export function formWidth(state: FormState): number { return Math.max(0, ...state.fields.map(f => cellWidth(f.label))); }
