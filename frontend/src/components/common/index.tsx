import * as React from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, Search, ShieldAlert, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge, Skeleton } from '@/components/ui/display';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/overlays';
import { Field, Textarea, inputClass } from '@/components/ui/form-controls';
import { cn, formatDateTime, humanize } from '@/lib/utils';
import type { Tone } from '@/constants/status';
import { errorMessage } from '@/api/client';

/** Page title row with optional breadcrumbs override and action buttons. */
export function PageHeader({ title, description, actions, back }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
            <ChevronLeft className="size-3.5" /> {back.label}
          </Link>
        )}
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatusBadge({ map, value, dot = true }: { map: Record<string, { label: string; tone: Tone }>; value: string; dot?: boolean }) {
  const s = map[value] ?? { label: humanize(value), tone: 'neutral' as Tone };
  return (
    <Badge tone={s.tone} dot={dot}>
      {s.label}
    </Badge>
  );
}

export function EmptyState({ title, description, action, icon: Icon = Inbox, className }: { title: string; description?: string; action?: React.ReactNode; icon?: React.ComponentType<{ className?: string }>; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Icon className="size-5" />
      </div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)} role="alert">
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-bad-soft text-bad">
        <AlertTriangle className="size-5" />
      </div>
      <p className="text-sm font-semibold">Could not load this data</p>
      <p className="mt-1 max-w-md text-[13px] text-muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function LoadingRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3 p-5', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export function FullPageLoader() {
  return (
    <div className="flex h-full items-center justify-center text-muted">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}

/** Wraps a query result into loading / error / empty / content states. */
export function QueryState<T>({ query, empty, children, skeleton }: { query: { isLoading: boolean; isError: boolean; error: unknown; data: T | undefined; refetch: () => unknown }; empty?: (d: T) => boolean; children: (d: T) => React.ReactNode; skeleton?: React.ReactNode }) {
  if (query.isLoading) return <>{skeleton ?? <LoadingRows />}</>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (query.data === undefined) return null;
  if (empty?.(query.data)) return null;
  return <>{children(query.data)}</>;
}

export function SearchInput({ value, onChange, placeholder = 'Search', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const [local, setLocal] = React.useState(value);
  React.useEffect(() => setLocal(value), [value]);
  React.useEffect(() => {
    const t = setTimeout(() => local !== value && onChange(local), 300);
    return () => clearTimeout(t);
  }, [local, value, onChange]);
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
      <input aria-label={placeholder} className={cn(inputClass, 'pl-9 pr-8')} placeholder={placeholder} value={local} onChange={(e) => setLocal(e.target.value)} />
      {local && (
        <button type="button" aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-ink" onClick={() => (setLocal(''), onChange(''))}>
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function Pagination({ page, totalPages, total, pageSize, onPage }: { page: number; totalPages: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-muted">
      <span className="tabular">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1.5">
        <Button size="icon-sm" variant="outline" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft />
        </Button>
        <span className="tabular px-2">
          Page {page} / {totalPages}
        </span>
        <Button size="icon-sm" variant="outline" aria-label="Next page" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/**
 * Confirmation dialog. When `reasonLabel` is given, a reason is mandatory
 * (used for reopen, rejection, deactivation and other controlled actions).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'primary',
  reasonLabel,
  reasonMin = 3,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  reasonLabel?: string;
  reasonMin?: number;
  onConfirm: (reason: string) => Promise<unknown> | unknown;
  children?: React.ReactNode;
}) {
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);
  const invalid = !!reasonLabel && reason.trim().length < reasonMin;
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent size="sm">
        <DialogHeader title={title} description={description} />
        {(reasonLabel || children || error) && (
          <DialogBody className="space-y-4">
            {children}
            {reasonLabel && (
              <Field label={reasonLabel} required htmlFor="confirm-reason" hint={`At least ${reasonMin} characters. Recorded in the audit trail.`}>
                <Textarea id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
              </Field>
            )}
            {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
          </DialogBody>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            disabled={invalid}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(reason.trim());
                onOpenChange(false);
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Explains a separation-of-duties block (ISO/IEC 27001 A.5.3): why this person cannot do the next
 * step and that someone else must. Renders nothing when there is no block.
 */
export function SodNotice({ messages }: { messages: (string | undefined | null)[] }) {
  const list = [...new Set(messages.filter((m): m is string => !!m))];
  if (!list.length) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft px-4 py-3 text-sm text-info" role="note">
      <ShieldAlert className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-medium">Separation of duties</p>
        {list.map((m) => (
          <p key={m}>{m}</p>
        ))}
      </div>
    </div>
  );
}

/** Vertical lifecycle timeline (status history). */
export function Timeline({ items }: { items: { id: string; title: string; meta?: string; body?: string | null; at: string; tone?: Tone }[] }) {
  if (!items.length) return <p className="text-sm text-muted">No history yet.</p>;
  const dot: Record<Tone, string> = { neutral: 'bg-faint', brand: 'bg-brand', ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', info: 'bg-info' };
  return (
    <ol className="relative space-y-4 before:absolute before:left-[5px] before:top-1 before:h-[calc(100%-8px)] before:w-px before:bg-line">
      {items.map((i) => (
        <li key={i.id} className="relative pl-6">
          <span className={cn('absolute left-0 top-1.5 size-[11px] rounded-full border-2 border-surface', dot[i.tone ?? 'brand'])} />
          <p className="text-sm font-medium text-ink">{i.title}</p>
          <p className="text-xs text-muted">
            {i.meta ? `${i.meta} · ` : ''}
            {formatDateTime(i.at)}
          </p>
          {i.body && <p className="mt-1 rounded-md bg-subtle px-3 py-2 text-[13px] text-ink-2">{i.body}</p>}
        </li>
      ))}
    </ol>
  );
}

export function KeyValue({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{children ?? '—'}</dd>
    </div>
  );
}

/**
 * List filter + pagination state, kept in the page URL so refresh, Back and shared links keep
 * the same view. Values equal to their defaults are left out of the URL. `prefix` namespaces the
 * keys when two lists share a page (e.g. tabs).
 */
export function usePaged(initial: Record<string, unknown> = {}, opts: { prefix?: string } = {}) {
  const [sp, setSp] = useSearchParams();
  const prefix = opts.prefix ? `${opts.prefix}.` : '';
  const defaults = React.useMemo<Record<string, unknown>>(() => ({ page: 1, pageSize: 20, ...initial }), [JSON.stringify(initial)]); // eslint-disable-line react-hooks/exhaustive-deps
  const params = React.useMemo(() => {
    const out: Record<string, unknown> = { ...defaults };
    for (const k of Object.keys(defaults)) {
      const v = sp.get(prefix + k);
      if (v === null) continue;
      out[k] = typeof defaults[k] === 'number' ? Number(v) || defaults[k] : v;
    }
    return out;
  }, [sp, defaults, prefix]);
  const set = React.useCallback(
    (patch: Record<string, unknown>) =>
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          const merged = { ...patch, page: 'page' in patch ? patch.page : 1 };
          for (const [k, v] of Object.entries(merged)) {
            if (v === undefined || v === null || v === '' || String(v) === String(defaults[k] ?? '')) next.delete(prefix + k);
            else next.set(prefix + k, String(v));
          }
          return next;
        },
        { replace: true },
      ),
    [setSp, defaults, prefix],
  );
  const reset = React.useCallback(
    () =>
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const k of Object.keys(defaults)) next.delete(prefix + k);
          return next;
        },
        { replace: true },
      ),
    [setSp, defaults, prefix],
  );
  return [params, set, reset] as const;
}

export interface FilterChip {
  key: string;
  label: string;
  value: string;
  onClear: () => void;
}

/**
 * "Filtered by" row shown above a list: the branch/period chosen in the top bar plus the page's own
 * filters, each removable, with Clear all. Renders nothing when no filter is active.
 */
export function ActiveFilters({ chips, onClearAll, total, className }: { chips: FilterChip[]; onClearAll: () => void; total?: number; className?: string }) {
  if (!chips.length) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-2 border-y border-line bg-subtle px-5 py-2.5 text-xs', className)} aria-label="Active filters">
      <span className="text-muted">Filtered by</span>
      {chips.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-brand-soft py-0.5 pl-2.5 pr-1 font-medium text-brand-ink">
          <span className="font-normal opacity-80">{c.label}</span> {c.value}
          <button type="button" className="rounded-full p-0.5 hover:bg-brand/10" aria-label={`Remove ${c.label} filter`} onClick={c.onClear}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <button type="button" className="font-medium text-brand hover:underline" onClick={onClearAll}>
        Clear all
      </button>
      {total !== undefined && <span className="ml-auto text-muted tabular">{total} result(s)</span>}
    </div>
  );
}
