import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Dates are stored in UTC and shown in the organisation's time zone (Settings → Regional settings; SRS 2.3, NFR-10).
// Until the profile has loaded, the browser's own time zone is used.
let displayTimeZone: string | undefined;
let dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
let dateTimeFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const utcDateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function setDisplayTimeZone(timeZone?: string | null) {
  if (!timeZone || timeZone === displayTimeZone) return;
  try {
    dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone });
    dateTimeFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone });
    displayTimeZone = timeZone;
  } catch {
    /* unknown zone: keep the current formatters */
  }
}
export const getDisplayTimeZone = () => displayTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Calendar dates (due dates, period bounds) are stored as midnight UTC and are shown as that same day everywhere. */
const isCalendarDate = (d: Date) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
export const formatDate = (v?: string | Date | null) => {
  if (!v) return '—';
  const d = new Date(v);
  return (isCalendarDate(d) ? utcDateFmt : dateFmt).format(d);
};
export const formatDateTime = (v?: string | Date | null) => (v ? dateTimeFmt.format(new Date(v)) : '—');
export const toInputDate = (v?: string | Date | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');

export function formatBytes(n?: number | null) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export const formatPercent = (v: number | null | undefined) => (v == null ? '—' : `${v % 1 === 0 ? v : v.toFixed(1)}%`);

export function relativeTime(v: string | Date) {
  const diff = (Date.now() - new Date(v).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(v);
}

export const initials = (name?: string | null) =>
  (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

export const humanize = (s?: string | null) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '—');
