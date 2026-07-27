// src/lib/export/csv.ts
// ============================================================
// CSV serialisation for the admin data export.
// Output targets Excel first (that is what the office opens these in),
// so: UTF-8 BOM, CRLF line endings, and IST-rendered timestamps.
// ============================================================

export type CsvValue = string | number | boolean | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value:  (row: T) => CsvValue;
}

// A cell must be quoted if it contains the delimiter, a quote, or a newline.
const NEEDS_QUOTING  = /[",\r\n]/;
// Spreadsheets evaluate a cell starting with any of these as a formula.
const FORMULA_START  = /^[=+\-@\t\r]/;

function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number')  return Number.isFinite(value) ? String(value) : '';

  // Party names, notes and remarks are free text typed on the floor. A value
  // that happens to start with '=' or '-' would be evaluated as a formula on
  // open; the leading apostrophe makes Excel show the literal text instead.
  const safe = FORMULA_START.test(value) ? `'${value}` : value;

  return NEEDS_QUOTING.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Serialise rows to a full CSV document, header row included. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(',')];

  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(c.value(row))).join(','));
  }

  // Leading BOM so Excel reads UTF-8 rather than the system codepage —
  // without it party names with non-ASCII characters arrive mangled.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ── Value formatters ──────────────────────────────────────────
// The plant works in IST; the server does not. Render both dates and
// timestamps in IST so an exported row matches what the floor saw on screen.

/** Timestamp → 'DD-MM-YYYY HH:MM' in IST. Empty for null. */
export function csvTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);

  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? '';

  return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')}`;
}

/**
 * Date column → 'DD-MM-YYYY'. po_date / delivery_date / planned_date are
 * plain DATE columns, so they carry no zone and must not be shifted —
 * split the ISO string rather than passing it through Date.
 */
export function csvDate(value: string | null | undefined): string {
  if (!value) return '';
  const [y, m, d] = value.slice(0, 10).split('-');
  return y && m && d ? `${d}-${m}-${y}` : '';
}
