import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn, initials } from '@/lib/utils';
import type { Tone } from '@/constants/status';

// ───────────── Card ─────────────
export const Card = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('rounded-lg border border-line bg-surface', className)} {...props} />;

export function CardHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4', className)}>
      <div className="min-w-0">
        <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
export const CardBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('px-5 pb-5', className)} {...props} />;

// ───────────── Badge ─────────────
const toneClass: Record<Tone, string> = {
  neutral: 'bg-muted-bg text-ink-2',
  brand: 'bg-brand-soft text-brand-ink',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-info-soft text-info',
};
const dotClass: Record<Tone, string> = { neutral: 'bg-faint', brand: 'bg-brand', ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', info: 'bg-info' };

export function Badge({ tone = 'neutral', dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', toneClass[tone], className)}>
      {dot && <span className={cn('size-1.5 rounded-full', dotClass[tone])} />}
      {children}
    </span>
  );
}

// ───────────── Table ─────────────
export const Table = ({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) => (
  <div className="w-full overflow-x-auto scrollbar-thin">
    <table className={cn('w-full border-collapse text-sm', className)} {...props} />
  </div>
);
export const THead = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => <thead className={cn('bg-subtle', className)} {...props} />;
export const TH = ({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn('h-11 whitespace-nowrap border-y border-line px-5 text-left text-[13px] font-normal text-muted first:pl-5', className)} {...props} />
);
export const TR = ({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => <tr className={cn('border-b border-line last:border-b-0 transition-colors', className)} {...props} />;
export const TD = ({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn('px-5 py-3.5 align-middle text-ink [&.tabular]:whitespace-nowrap', className)} {...props} />;

// ───────────── Tabs ─────────────
export const Tabs = TabsPrimitive.Root;
export const TabsList = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List className={cn('flex gap-6 border-b border-line', className)} {...props} />
);
export const TabsTrigger = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    className={cn('-mb-px cursor-pointer border-b-2 border-transparent pb-2.5 text-sm font-medium text-muted transition-colors hover:text-ink data-[state=active]:border-brand data-[state=active]:text-ink', className)}
    {...props}
  />
);
export const TabsContent = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) => <TabsPrimitive.Content className={cn('pt-5 outline-none', className)} {...props} />;

// ───────────── Progress ─────────────
export function Progress({ value, className, tone = 'brand' }: { value: number | null | undefined; className?: string; tone?: 'brand' | 'ok' | 'warn' | 'bad' }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const bar = { brand: 'bg-brand', ok: 'bg-ok-chart', warn: 'bg-warn-chart', bad: 'bg-bad' }[tone];
  return (
    <ProgressPrimitive.Root value={v} className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-brand-soft', className)}>
      <ProgressPrimitive.Indicator className={cn('h-full rounded-full transition-all', bar)} style={{ width: `${v}%` }} />
    </ProgressPrimitive.Root>
  );
}

// ───────────── Skeleton / Avatar ─────────────
export const Skeleton = ({ className }: { className?: string }) => <div className={cn('animate-pulse rounded-md bg-muted-bg', className)} />;

const avatarPalette = ['bg-brand-soft text-brand-ink', 'bg-ok-soft text-ok', 'bg-warn-soft text-warn', 'bg-info-soft text-info', 'bg-bad-soft text-bad'];
export function Avatar({ name, size = 32, className }: { name?: string | null; size?: number; className?: string }) {
  const idx = (name ?? '').split('').reduce((n, c) => n + c.charCodeAt(0), 0) % avatarPalette.length;
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', avatarPalette[idx], className)} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      {initials(name)}
    </span>
  );
}

export const Separator = ({ className }: { className?: string }) => <div className={cn('h-px w-full bg-line', className)} />;
