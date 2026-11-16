import { Check } from 'lucide-react';
import { ASSESSMENT_FLOW, ASSESSMENT_STATUS, RESPONSE_STATUS } from '@/constants/status';
import { cn, formatPercent } from '@/lib/utils';
import { Card, Progress } from '@/components/ui/display';
import type { Metrics } from '@/types/api';

/** Assessment lifecycle stepper. Conditional stages are shown only when they apply. */
export function LifecycleStepper({ status, approvalRequired }: { status: string; approvalRequired: boolean }) {
  const flow = ASSESSMENT_FLOW.filter((s) => (s !== 'CLARIFICATION_REQUIRED' || status === 'CLARIFICATION_REQUIRED') && (s !== 'PENDING_APPROVAL' || approvalRequired));
  const idx = flow.indexOf(status);
  return (
    <ol className="flex w-full items-center overflow-x-auto pb-1 scrollbar-thin" aria-label="Assessment lifecycle">
      {flow.map((s, i) => {
        const done = i < idx || status === 'APPROVED';
        const current = i === idx && status !== 'APPROVED';
        return (
          <li key={s} className="flex min-w-0 flex-1 items-center">
            <div className="flex min-w-[92px] flex-col items-center gap-1.5 text-center">
              <span
                className={cn(
                  'flex size-7 items-center justify-center rounded-full border-2 text-[11px] font-semibold',
                  done ? 'border-brand bg-brand text-white' : current ? (s === 'CLARIFICATION_REQUIRED' ? 'border-warn bg-warn-soft text-warn' : 'border-brand bg-brand-soft text-brand') : 'border-line bg-surface text-faint',
                )}
                aria-current={current ? 'step' : undefined}
              >
                {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn('text-[11px] leading-tight', current ? 'font-semibold text-ink' : done ? 'text-ink-2' : 'text-faint')}>{ASSESSMENT_STATUS[s].label}</span>
            </div>
            {i < flow.length - 1 && <span className={cn('mx-1 mb-5 h-0.5 flex-1 rounded', i < idx || status === 'APPROVED' ? 'bg-brand' : 'bg-line')} />}
          </li>
        );
      })}
    </ol>
  );
}

/** Compact KPI strip for one assessment, consistent with the dashboard strip. */
export function MetricsStrip({ m }: { m: Metrics }) {
  const tiles = [
    { label: 'Compliance score', value: formatPercent(m.compliancePercent), sub: `policy v${m.scoring.policyVersion}` },
    { label: 'Answered', value: `${m.totalItems - m.counts.NOT_ASSESSED}/${m.totalItems}`, sub: `${formatPercent(m.completionPercent)} complete` },
    { label: 'Evidence coverage', value: formatPercent(m.evidenceCoverage.percent), sub: `${m.evidenceCoverage.attached}/${m.evidenceCoverage.required} items` },
    { label: 'Verified evidence', value: formatPercent(m.evidenceCoverage.verifiedPercent), sub: `${m.evidenceCoverage.verified} accepted` },
  ];
  return (
    <Card className="bg-subtle/60">
      <div className="grid grid-cols-2 lg:grid-cols-[repeat(4,1fr)_1.6fr]">
        {tiles.map((t, i) => (
          <div key={t.label} className={cn('px-5 py-5', i > 0 && 'lg:border-l', 'border-line')}>
            <p className="tabular text-[26px] font-semibold leading-none tracking-[-0.02em]">{t.value}</p>
            <p className="mt-2 text-sm text-ink-2">{t.label}</p>
            <p className="text-xs text-muted">{t.sub}</p>
          </div>
        ))}
        <div className="col-span-2 border-line px-5 py-5 lg:col-span-1 lg:border-l">
          <div className="flex h-3 overflow-hidden rounded-full bg-brand-soft">
            {(Object.keys(RESPONSE_STATUS) as (keyof Metrics['counts'])[]).map((k) =>
              m.counts[k] ? <span key={k} style={{ width: `${(m.counts[k] / Math.max(1, m.totalItems)) * 100}%`, background: RESPONSE_STATUS[k].color }} title={`${RESPONSE_STATUS[k].label}: ${m.counts[k]}`} /> : null,
            )}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-2">
            {(Object.keys(RESPONSE_STATUS) as (keyof Metrics['counts'])[]).map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm" style={{ background: RESPONSE_STATUS[k].color }} />
                {RESPONSE_STATUS[k].label} <span className="tabular ml-auto font-medium">{m.counts[k]}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

export function ClauseBreakdown({ m }: { m: Metrics }) {
  return (
    <div className="space-y-3">
      {m.byClause.map((c) => (
        <div key={c.key}>
          <div className="mb-1 flex justify-between text-[13px]">
            <span className="truncate text-ink-2">{c.label}</span>
            <span className="tabular font-medium">{formatPercent(c.percent)}</span>
          </div>
          <Progress value={c.percent} />
        </div>
      ))}
    </div>
  );
}
