/**
 * CSV for files that will be opened in a spreadsheet, which is a harsher
 * environment than it looks.
 *
 * Two things this handles that naive joining does not:
 *
 * 1. Formula injection. Excel and Sheets treat a cell beginning with =, +, -,
 *    @ or a control character as a formula. A learner can choose their own
 *    display name, so an export is a path from user input into someone's
 *    spreadsheet. Those cells are prefixed with a single quote, which the
 *    spreadsheet strips on display and never executes.
 * 2. Non-ASCII names. A UTF-8 byte order mark makes Excel read the file as
 *    UTF-8 instead of the local codepage, so Yorùbá and Igbo names survive
 *    the round trip instead of arriving as mojibake.
 */

const NEEDS_QUOTING = /[",\r\n]/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (NEEDS_QUOTING.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  // \r\n because that is what spreadsheets on every platform expect.
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** A filename that sorts by date and never needs quoting in a shell. */
export function csvFilename(dataset: string, now: Date): string {
  return `dingba-${dataset}-${now.toISOString().slice(0, 10)}.csv`;
}
