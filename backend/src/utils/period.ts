/**
 * Assessment periods follow the Indian financial year (1 April – 31 March).
 * Labels are fixed formats so filters, reports and trends group correctly:
 *   Q3 FY2026-27  (quarter: Q1 = Apr–Jun … Q4 = Jan–Mar)
 *   H1 FY2026-27  (half year: H1 = Apr–Sep, H2 = Oct–Mar)
 *   FY2026-27     (full year)
 *   Nov 2026      (month)
 */
export const FY_START_MONTH = 3; // April (0-based)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface PeriodRange {
  label: string;
  start: Date; // first day, 00:00 UTC
  end: Date; // last day, 00:00 UTC
}

const utc = (y: number, m: number, d = 1) => new Date(Date.UTC(y, m, d));
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0));
const fyLabel = (startYear: number) => `FY${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;

function parseFy(text: string): number | null {
  const m = /^FY(\d{4})-(\d{2})$/.exec(text);
  if (!m) return null;
  const y = Number(m[1]);
  return (y + 1) % 100 === Number(m[2]) ? y : null;
}

/** Parses a period label into its date range, or returns null when the label is not a valid period. */
export function parsePeriod(raw: string): PeriodRange | null {
  const label = raw.trim().replace(/\s+/g, ' ');
  let m = /^Q([1-4]) (FY\d{4}-\d{2})$/.exec(label);
  if (m) {
    const y = parseFy(m[2]);
    if (y === null) return null;
    const startMonth = FY_START_MONTH + (Number(m[1]) - 1) * 3;
    const sy = y + Math.floor(startMonth / 12);
    const sm = startMonth % 12;
    return { label, start: utc(sy, sm), end: lastDay(sy, sm + 2) };
  }
  m = /^H([12]) (FY\d{4}-\d{2})$/.exec(label);
  if (m) {
    const y = parseFy(m[2]);
    if (y === null) return null;
    const startMonth = FY_START_MONTH + (Number(m[1]) - 1) * 6;
    const sy = y + Math.floor(startMonth / 12);
    const sm = startMonth % 12;
    const end = lastDay(sy, sm + 5);
    return { label, start: utc(sy, sm), end };
  }
  const fy = parseFy(label);
  if (fy !== null) return { label, start: utc(fy, FY_START_MONTH), end: lastDay(fy + 1, FY_START_MONTH - 1) };
  m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(label);
  if (m && MONTHS.includes(m[1])) {
    const mi = MONTHS.indexOf(m[1]);
    const y = Number(m[2]);
    return { label, start: utc(y, mi), end: lastDay(y, mi) };
  }
  return null;
}

/** Financial year that contains a date (returns its starting calendar year). */
export function fyStartYear(d: Date): number {
  return d.getUTCMonth() >= FY_START_MONTH ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

/** The period label of the given frequency that contains a date. */
export function periodLabelFor(d: Date, frequency: 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY'): string {
  const y = fyStartYear(d);
  const offset = (d.getUTCMonth() - FY_START_MONTH + 12) % 12; // months since FY start
  if (frequency === 'QUARTERLY') return `Q${Math.floor(offset / 3) + 1} ${fyLabel(y)}`;
  if (frequency === 'HALF_YEARLY') return `H${Math.floor(offset / 6) + 1} ${fyLabel(y)}`;
  if (frequency === 'YEARLY') return fyLabel(y);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export const PERIOD_FORMAT_HINT = 'Use a period such as "Q3 FY2026-27", "H1 FY2026-27", "FY2026-27" or "Nov 2026"';
