/**
 * Assessment periods on the Indian financial year (1 April – 31 March), matching the API's
 * fixed label formats: "Q3 FY2026-27", "H1 FY2026-27", "FY2026-27". The server derives the
 * same dates from the label, so these are for display only.
 */
export type PeriodKind = 'Q' | 'H' | 'FY';

export const fyLabel = (startYear: number) => `FY${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;

export function currentFyStart(d = new Date()) {
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

export function currentQuarterNumber(d = new Date()) {
  return Math.floor(((d.getMonth() + 9) % 12) / 3) + 1;
}

export function buildLabel(kind: PeriodKind, n: number, fyStart: number) {
  return kind === 'FY' ? fyLabel(fyStart) : `${kind}${n} ${fyLabel(fyStart)}`;
}

/** Start/end dates (YYYY-MM-DD) for a period. */
export function periodDates(kind: PeriodKind, n: number, fyStart: number) {
  const months = kind === 'Q' ? 3 : kind === 'H' ? 6 : 12;
  const offset = kind === 'FY' ? 0 : (n - 1) * months;
  const startMonth = 3 + offset;
  const start = new Date(Date.UTC(fyStart + Math.floor(startMonth / 12), startMonth % 12, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}
