export interface CliOutput {
  write(text: string): void;
  error(text: string): void;
}

export function formatRecord(value: unknown, json: boolean): string {
  if (json) {
    return `${JSON.stringify(value, null, 2)}\n`;
  }
  if (typeof value === "string") {
    return `${value}\n`;
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function table(rows: readonly Record<string, string | number | undefined>[]): string {
  if (rows.length === 0) {
    return "";
  }

  const columns = Object.keys(rows[0] ?? {});
  const widths = new Map(
    columns.map((column) => [
      column,
      Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length))
    ])
  );

  const header = columns.map((column) => column.padEnd(widths.get(column) ?? column.length)).join("  ");
  const divider = columns.map((column) => "-".repeat(widths.get(column) ?? column.length)).join("  ");
  const body = rows
    .map((row) => columns.map((column) => String(row[column] ?? "").padEnd(widths.get(column) ?? 0)).join("  "))
    .join("\n");
  return `${header}\n${divider}\n${body}\n`;
}
