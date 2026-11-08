function cell(value: unknown) {
  let text = String(value ?? "");
  // Stops a spreadsheet from running a value as a formula.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv<T>(rows: T[], columns: { header: string; value: (row: T) => unknown }[]) {
  const lines = [
    columns.map((column) => cell(column.header)).join(","),
    ...rows.map((row) => columns.map((column) => cell(column.value(row))).join(",")),
  ];
  return `${lines.join("\r\n")}\r\n`;
}
