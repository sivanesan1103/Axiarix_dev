import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronDown, ClipboardCheck, FileCheck2, ShieldCheck, Wrench } from 'lucide-react';
import { useFilters } from '@/contexts/FilterContext';
import { useAuth } from '@/contexts/AuthContext';
import { dashboardService } from '@/services/reports.service';
import { assessmentsService } from '@/services/assessments.service';
import { organisationService } from '@/services/organisation.service';
import { Card, CardBody, CardHeader, Progress, Table, TD, TH, THead, TR, Avatar } from '@/components/ui/display';
import { CountBars, PercentBars, StatusPie, TrendLine } from '@/components/dashboard/charts';
import { EmptyState, ErrorState, LoadingRows, SearchInput, StatusBadge } from '@/components/common';
import { ACTION_STATUS, ASSESSMENT_STATUS, SEVERITY } from '@/constants/status';
import { cn, formatDate, formatPercent, humanize, relativeTime } from '@/lib/utils';
import type { DashboardSummary } from '@/types/api';

function KpiStrip({ d }: { d: DashboardSummary }) {
  const k = d.kpis;
  const tiles = [
    { value: formatPercent(k.compliancePercent), label: 'Overall compliance' },
    { value: String(k.totalQuestions), label: 'Checklist questions' },
    { value: formatPercent(k.evidenceCoveragePercent), label: 'Evidence coverage' },
    { value: formatPercent(k.completionPercent), label: 'Assessment completion' },
    { value: String(k.openFindings), label: 'Open findings' },
    { value: String(k.overdueActions), label: 'Overdue actions', alert: k.overdueActions > 0 },
    { value: String(k.pendingApprovals), label: 'Pending approvals' },
  ];
  return (
    <Card className="bg-subtle/60">
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7">
        {tiles.map((t, i) => (
          <div key={t.label} className={cn('px-6 py-6', i > 0 && 'xl:border-l', 'border-line')}>
            <p className={cn('tabular text-[32px] font-semibold leading-none tracking-[-0.03em]', t.alert ? 'text-bad' : 'text-ink')}>{t.value}</p>
            <p className="mt-2 text-[15px] text-ink-2">{t.label}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function StatusCountsRow({ d }: { d: DashboardSummary }) {
  const c = d.kpis.counts;
  const items = [
    { k: 'Compliant', v: c.COMPLIANT, cls: 'bg-ok-chart' },
    { k: 'Partially compliant', v: c.PARTIALLY_COMPLIANT, cls: 'bg-warn-chart' },
    { k: 'Non-compliant', v: c.NON_COMPLIANT, cls: 'bg-bad' },
    { k: 'Not applicable', v: c.NOT_APPLICABLE, cls: 'bg-[#B9B9C3]' },
    { k: 'Not assessed', v: c.NOT_ASSESSED, cls: 'bg-brand-tint' },
  ];
  return (
    <div className="space-y-3">
      {items.map((i) => (
        <div key={i.k} className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 text-ink-2">
            <span className={cn('size-2.5 rounded-[3px]', i.cls)} />
            {i.k}
          </span>
          <span className="tabular font-semibold">{i.v}</span>
        </div>
      ))}
    </div>
  );
}

function AssessmentsTable({ departmentId }: { departmentId: string }) {
  const navigate = useNavigate();
  const { siteId, periodLabel } = useFilters();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const q = useQuery({
    queryKey: ['assessments', 'dash', siteId, periodLabel, departmentId, search, status],
    queryFn: () => assessmentsService.list({ siteId, periodLabel, departmentId: departmentId || undefined, search, status, pageSize: 6 }),
  });
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 px-5 py-5">
        <div className="relative">
          <select aria-label="Status filter" value={status} onChange={(e) => setStatus(e.target.value)} className="h-11 appearance-none rounded-lg border border-line bg-surface pl-4 pr-10 text-[15px] font-medium">
            <option value="">All assessments</option>
            {Object.entries(ASSESSMENT_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2" />
        </div>
        <SearchInput value={search} onChange={setSearch} className="ml-auto w-full max-w-sm" />
      </div>
      {q.isLoading ? (
        <LoadingRows rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.data.length ? (
        <EmptyState title="No assessments in this view" description="Change the site or period filter, or create an assessment period." />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Assessment</TH>
              <TH>Site</TH>
              <TH>Period</TH>
              <TH>Progress</TH>
              <TH>Status</TH>
              <TH>Due</TH>
            </tr>
          </THead>
          <tbody>
            {q.data.data.map((a) => {
              const pct = a.totalItems ? Math.round(((a.answered ?? 0) / a.totalItems) * 100) : 0;
              return (
                <TR key={a.id} className="cursor-pointer hover:bg-subtle" onClick={() => navigate(`/assessments/${a.id}`)}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand">
                        <ClipboardCheck className="size-[18px]" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-medium">{a.title}</p>
                        <p className="text-xs text-muted">{a.code}</p>
                      </div>
                    </div>
                  </TD>
                  <TD className="text-[15px]">{a.site.name}</TD>
                  <TD className="whitespace-nowrap text-[15px]">{a.periodLabel}</TD>
                  <TD className="min-w-[140px]">
                    <div className="flex items-center gap-2">
                      <Progress value={pct} className="w-20" />
                      <span className="tabular text-[13px] text-muted">{pct}%</span>
                    </div>
                  </TD>
                  <TD>
                    <StatusBadge map={ASSESSMENT_STATUS} value={a.status} />
                  </TD>
                  <TD className={cn('tabular text-[15px]', a.overdue && 'text-bad')}>{formatDate(a.dueDate)}</TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function PendingTasks() {
  const q = useQuery({ queryKey: ['dashboard', 'tasks'], queryFn: dashboardService.tasks });
  const rows: { key: string; icon: typeof ClipboardCheck; title: string; meta: string; date?: string; to: string; overdue?: boolean }[] = [];
  if (q.data) {
    q.data.myQuestions.forEach((a) => rows.push({ key: `q${a.id}`, icon: ClipboardCheck, title: `Answer ${a.assignedToMe} question(s): ${a.title}`, meta: `${a.code} · assigned to you`, date: a.dueDate, to: `/my-assessments/${a.id}?assignee=me`, overdue: a.overdue }));
    q.data.toRelease.forEach((a) => rows.push({ key: `d${a.id}`, icon: ClipboardCheck, title: `Release ${a.code} to the department`, meta: `Draft · ${a.title}`, date: a.dueDate, to: `/assessments/${a.id}` }));
    q.data.checklistReviews.forEach((v) => rows.push({ key: `c${v.id}`, icon: ShieldCheck, title: `Review checklist: ${v.template.title} v${v.versionNumber}`, meta: 'You are the named reviewer', to: `/checklists/${v.template.id}/versions/${v.id}` }));
    q.data.myFindings.forEach((f) => rows.push({ key: `f${f.id}`, icon: Wrench, title: `Plan action for ${f.code}`, meta: `${humanize(f.severity)} finding · ${humanize(f.status)}`, date: f.dueDate, to: `/findings/${f.id}`, overdue: f.overdue }));
    q.data.toSubmit.forEach((a) => rows.push({ key: `s${a.id}`, icon: ClipboardCheck, title: a.title, meta: `${a.code} · ${humanize(a.status)}`, date: a.dueDate, to: `/my-assessments/${a.id}` }));
    q.data.toReview.forEach((a) => rows.push({ key: `r${a.id}`, icon: ShieldCheck, title: `Review ${a.code}`, meta: humanize(a.status), date: a.dueDate, to: `/auditor/${a.id}` }));
    q.data.toApprove.forEach((a) => rows.push({ key: `p${a.id}`, icon: FileCheck2, title: `Approve ${a.code}`, meta: 'Pending approval', date: a.dueDate, to: `/assessments/${a.id}` }));
    q.data.myActions.forEach((a) => rows.push({ key: `m${a.id}`, icon: Wrench, title: `${a.code} corrective action`, meta: ACTION_STATUS[a.status]?.label ?? a.status, date: a.targetDate, to: `/corrective-actions/${a.id}`, overdue: a.overdue }));
    q.data.toVerify.forEach((a) => rows.push({ key: `v${a.id}`, icon: Wrench, title: `Verify ${a.code}`, meta: 'Awaiting verification', date: a.targetDate, to: `/corrective-actions/${a.id}` }));
  }
  return (
    <Card className="flex flex-col">
      <div className="border-b border-line px-6 py-5">
        <h3 className="text-[20px] font-semibold tracking-[-0.01em]">Pending tasks</h3>
      </div>
      {q.isLoading ? (
        <LoadingRows rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !rows.length ? (
        <EmptyState title="Nothing waiting on you" description="Questions to answer, assessments to submit, reviews, approvals, findings and actions given to you appear here." />
      ) : (
        <ul className="divide-y divide-line">
          {rows.slice(0, 10).map((r) => {
            const d = r.date ? new Date(r.date) : null;
            return (
              <li key={r.key}>
                <Link to={r.to} className="flex items-center gap-4 px-6 py-4 hover:bg-subtle">
                  <span className={cn('flex size-12 shrink-0 flex-col items-center justify-center rounded-full border text-center leading-none', r.overdue ? 'border-bad/40 text-bad' : 'border-line')}>
                    {d ? (
                      <>
                        <span className="text-[15px] font-semibold">{d.getDate()}</span>
                        <span className="mt-0.5 text-[11px] text-muted">{d.toLocaleDateString('en-IN', { month: 'short' })}</span>
                      </>
                    ) : (
                      <r.icon className="size-5 text-brand" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold">{r.title}</span>
                    <span className="flex items-center gap-1.5 text-[13px] text-muted">
                      <r.icon className="size-3.5" /> {r.meta}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const { siteId, periodLabel } = useFilters();
  const { user, can } = useAuth();
  const [chartMode, setChartMode] = useState<'clause' | 'annex'>('clause');
  const [compare, setCompare] = useState<'branch' | 'department'>('branch');
  // Department filter (FR-021): departments of the branch picked in the top bar, or of every branch in scope.
  const [departmentId, setDepartmentId] = useState('');
  const org = useQuery({ queryKey: ['org'], queryFn: organisationService.current });
  const departments = (org.data?.sites ?? []).filter((s) => !siteId || s.id === siteId).flatMap((s) => s.departments.map((dep) => ({ id: dep.id, label: siteId ? dep.name : `${s.name} / ${dep.name}` })));
  useEffect(() => setDepartmentId(''), [siteId]);
  const q = useQuery({ queryKey: ['dashboard', siteId, periodLabel, departmentId], queryFn: () => dashboardService.summary({ siteId, periodLabel, departmentId: departmentId || undefined }) });

  if (q.isLoading)
    return (
      <Card>
        <LoadingRows rows={8} />
      </Card>
    );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const chartData = (chartMode === 'clause' ? d.byClause : d.byAnnexTheme).map((g) => ({ label: chartMode === 'clause' ? `Cl. ${g.key}` : `A.${g.key}`, percent: g.percent }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Welcome back, <span className="font-medium text-ink">{user?.name.split(' ')[0]}</span>. {d.assessmentsCount} assessment(s) in this view{periodLabel ? ` for ${periodLabel}` : ''}.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {departments.length > 1 && (
            <select aria-label="Department filter" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="h-9 max-w-[280px] rounded-lg border border-line bg-surface px-3 text-sm">
              <option value="">All departments</option>
              {departments.map((dep) => (
                <option key={dep.id} value={dep.id}>
                  {dep.label}
                </option>
              ))}
            </select>
          )}
          {d.scoringNote && <p className="text-xs text-faint">{d.scoringNote}</p>}
        </div>
      </div>

      <KpiStrip d={d} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px] [&>*]:min-w-0">
        <Card className="grid gap-6 p-6 lg:grid-cols-[230px_minmax(0,1fr)] [&>*]:min-w-0">
          <div className="flex flex-col justify-between border-line lg:border-r lg:pr-6">
            <div>
              <h3 className="text-[20px] font-semibold tracking-[-0.01em]">Compliance score</h3>
              <p className="mt-1 text-[15px] text-muted">Scored responses, all assessments in view</p>
              <div className="mt-5 border-t border-line pt-5">
                <StatusCountsRow d={d} />
              </div>
            </div>
            <div className="mt-6">
              <p className="tabular text-[40px] font-semibold leading-none tracking-[-0.03em]">{formatPercent(d.kpis.compliancePercent)}</p>
              <p className="mt-2 text-[15px] text-muted">
                <span className="font-semibold text-ok">{d.kpis.evidence.verified}</span> verified evidence · <span className="font-semibold text-ink">{d.kpis.evidence.attached}</span>/{d.kpis.evidence.required} attached
              </p>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-[20px] font-semibold tracking-[-0.01em]">
                {chartMode === 'clause' ? 'By ISO clause' : 'By Annex A theme'}
                <span className="ml-2 text-[15px] font-medium text-ok">{formatPercent(d.kpis.compliancePercent)}</span>
              </h3>
              <div className="relative">
                <select aria-label="Chart grouping" value={chartMode} onChange={(e) => setChartMode(e.target.value as 'clause' | 'annex')} className="h-11 appearance-none rounded-lg border border-line bg-surface pl-4 pr-10 text-[15px] font-medium">
                  <option value="clause">Clauses 4–10</option>
                  <option value="annex">Annex A</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2" />
              </div>
            </div>
            {chartData.length ? <PercentBars data={chartData} height={320} /> : <EmptyState title="No mapped questions yet" />}
          </div>
        </Card>

        <Card>
          <CardHeader title={<span className="text-[20px]">Status distribution</span>} />
          <CardBody>
            <StatusPie counts={d.kpis.counts} size={240} />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px] [&>*]:min-w-0">
        <AssessmentsTable departmentId={departmentId} />
        <PendingTasks />
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Findings by severity" description={`${d.kpis.openFindings} open · ${d.kpis.overdueFindings} overdue`} actions={can('finding:read') && <Link to="/findings" className="text-sm text-brand hover:underline">View all</Link>} />
          <CardBody>
            <CountBars data={d.findingsBySeverity.map((s) => ({ label: SEVERITY[s.severity]?.label ?? s.severity, value: s.count }))} colorFor={(l) => Object.values(SEVERITY).find((s) => s.label === l)?.color ?? '#4B10F0'} height={200} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Corrective action progress" description={`${d.kpis.overdueActions} overdue`} />
          <CardBody>
            <CountBars data={d.actionProgress.map((s) => ({ label: ACTION_STATUS[s.status]?.label ?? s.status, value: s.count }))} colorFor={(l) => Object.values(ACTION_STATUS).find((s) => s.label === l)?.color ?? '#4B10F0'} height={200} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Evidence coverage" description="Questions requiring evidence (excl. N/A)" />
          <CardBody className="space-y-5">
            {[
              { label: 'Usable evidence attached', v: d.kpis.evidenceCoveragePercent, n: d.kpis.evidence.attached, tone: 'brand' as const },
              { label: 'Verified by auditor', v: d.kpis.verifiedEvidencePercent, n: d.kpis.evidence.verified, tone: 'ok' as const },
            ].map((r) => (
              <div key={r.label}>
                <div className="mb-2 flex items-baseline justify-between text-sm">
                  <span className="text-ink-2">{r.label}</span>
                  <span className="tabular font-semibold">
                    {formatPercent(r.v)} <span className="font-normal text-muted">({r.n}/{d.kpis.evidence.required})</span>
                  </span>
                </div>
                <Progress value={r.v} tone={r.tone} className="h-2.5" />
              </div>
            ))}
            <p className="text-xs text-muted">Rejected evidence and files that have not passed malware scanning are not counted.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Quarterly trend" description="Compliance by assessment period" />
          <CardBody>{d.trend.length ? <TrendLine data={d.trend} /> : <EmptyState title="No periods yet" />}</CardBody>
        </Card>
        <Card>
          <CardHeader
            title={compare === 'branch' ? 'Branch comparison' : 'Department comparison'}
            description={compare === 'branch' ? 'Consolidated vs site-wise (BR-09)' : 'Compliance by department'}
            actions={
              <select aria-label="Compare by" value={compare} onChange={(e) => setCompare(e.target.value as 'branch' | 'department')} className="h-8 rounded-md border border-line bg-surface px-2 text-[13px]">
                <option value="branch">Branches</option>
                <option value="department">Departments</option>
              </select>
            }
          />
          <CardBody>
            {compare === 'department' ? (
              d.departmentComparison.length ? (
                <ul className="space-y-4">
                  {d.departmentComparison.map((b) => (
                    <li key={b.departmentId}>
                      <div className="mb-1.5 flex justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate font-medium" title={`${b.site} / ${b.department}`}>
                          {b.department} <span className="font-normal text-muted">· {b.site}</span>
                        </span>
                        <span className="shrink-0 tabular text-muted">
                          {formatPercent(b.compliancePercent)} · {b.assessments}
                        </span>
                      </div>
                      <Progress value={b.compliancePercent} className="h-2.5" />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No department data yet" />
              )
            ) : d.branchComparison.length ? (
              <ul className="space-y-4">
                {d.branchComparison.map((b) => (
                  <li key={b.siteId}>
                    <div className="mb-1.5 flex justify-between text-sm">
                      <span className="font-medium">{b.site}</span>
                      <span className="tabular text-muted">
                        {formatPercent(b.compliancePercent)} · {b.assessments} assessment(s)
                      </span>
                    </div>
                    <Progress value={b.compliancePercent} className="h-2.5" />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No site data yet" />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent activity" />
          <CardBody>
            {d.recentActivity.length ? (
              <ul className="space-y-3.5">
                {d.recentActivity.slice(0, 6).map((e) => (
                  <li key={e.id} className="flex items-start gap-3">
                    <Avatar name={e.actor?.name ?? e.actorEmail} size={30} />
                    <div className="min-w-0 text-[13px]">
                      <p className="text-ink">
                        <span className="font-medium">{e.actor?.name ?? e.actorEmail ?? 'System'}</span> {humanize(e.action).toLowerCase()}
                      </p>
                      <p className="text-xs text-muted">{relativeTime(e.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No activity yet" />
            )}
          </CardBody>
        </Card>
      </div>

      {d.byControl.length > 0 && (
        <Card>
          <CardHeader title="Compliance by Annex A control" description="Controls referenced by checklist questions. Applicability is governed by the hospital SoA." actions={can('report:read') && <Link to="/reports" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">Reports <ArrowRight className="size-3.5" /></Link>} />
          <CardBody>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
              {d.byControl.map((c) => {
                const answered = c.counts.COMPLIANT + c.counts.PARTIALLY_COMPLIANT + c.counts.NON_COMPLIANT;
                const tone = c.percent == null || !answered ? 'bg-subtle text-muted' : c.percent >= 80 ? 'bg-ok-soft text-ok' : c.percent >= 50 ? 'bg-warn-soft text-warn' : 'bg-bad-soft text-bad';
                return (
                  <div key={c.key} className={cn('rounded-md px-3 py-2', tone)} title={`${c.label}: ${answered ? formatPercent(c.percent) : 'not assessed'}`}>
                    <p className="text-[13px] font-semibold">{c.label}</p>
                    <p className="tabular text-xs">{answered ? formatPercent(c.percent) : '—'}</p>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
