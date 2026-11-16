import { useQuery } from '@tanstack/react-query';
import { Download, Eye, FileBarChart2, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { reportsService } from '@/services/reports.service';
import { findingsService, actionsService } from '@/services/findings.service';
import { useAuth } from '@/contexts/AuthContext';
import { pageChips, useScope } from '@/hooks/useScope';
import { errorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, Table, TD, TH, THead, TR } from '@/components/ui/display';
import { ActiveFilters, EmptyState, ErrorState, LoadingRows, PageHeader, Pagination, SearchInput, usePaged } from '@/components/common';
import { formatBytes, formatDateTime, formatPercent } from '@/lib/utils';

export function ReportsPage() {
  const { can } = useAuth();
  const scope = useScope();
  const [params, set, reset] = usePaged({ search: '', includeArchived: '' });
  const query = { ...params, ...scope.params };
  const q = useQuery({ queryKey: ['reports', query], queryFn: () => reportsService.list(query) });
  const chips = [...scope.chips, ...pageChips(params, { search: { label: 'Search' }, includeArchived: { label: 'Archived', format: () => 'Included' } }, set)];
  const open = (id: string, inline: boolean) => reportsService.open(id, inline).catch((e) => toast.error(errorMessage(e)));
  return (
    <div className="space-y-6">
      <PageHeader title="Reports & Analytics" description="Central repository of final assessment reports. Reports are generated only after review and approval, are immutable, and every version is retained." />
      <Card>
        <div className="flex flex-wrap items-center gap-3 p-5">
          <SearchInput value={params.search as string} onChange={(v) => set({ search: v })} placeholder="Search report ID or title" className="w-full max-w-sm" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand" checked={params.includeArchived === 'true'} onChange={(e) => set({ includeArchived: e.target.checked ? 'true' : '' })} /> Include archived
          </label>
        </div>
        <ActiveFilters chips={chips} total={q.data?.meta.total} onClearAll={() => (reset(), scope.clear())} />
        {q.isLoading ? (
          <LoadingRows />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.data.length ? (
          <EmptyState icon={FileBarChart2} title="No final reports yet" description="A PDF report is generated automatically when an assessment is approved (or finalised after review)." />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Report</TH>
                  <TH>Site / department</TH>
                  <TH>Period</TH>
                  <TH>Compliance</TH>
                  <TH>Evidence</TH>
                  <TH>Findings</TH>
                  <TH>Generated</TH>
                  <TH className="w-28" />
                </tr>
              </THead>
              <tbody>
                {q.data.data.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <p className="font-medium">{r.code}</p>
                      <p className="line-clamp-1 text-xs text-muted">{r.title}</p>
                      <div className="mt-1 flex gap-1">
                        <Badge tone="brand">v{r.version}</Badge>
                        {r.archivedAt ? <Badge>{r.approvalStatus === 'DELETED' ? 'Deleted' : 'Archived'}</Badge> : <Badge tone="ok">Approved</Badge>}
                      </div>
                    </TD>
                    <TD className="text-[13px]">
                      {r.site.name}
                      <span className="block text-muted">{r.department.name}</span>
                    </TD>
                    <TD className="text-[13px]">{r.assessment.periodLabel}</TD>
                    <TD className="tabular font-semibold">{formatPercent(r.summary.metrics.compliancePercent)}</TD>
                    <TD className="tabular text-[13px]">{formatPercent(r.summary.metrics.evidenceCoverage.percent)}</TD>
                    <TD className="tabular text-[13px]">
                      {r.summary.findings.total} <span className="text-muted">({r.summary.findings.open} open)</span>
                    </TD>
                    <TD className="text-[13px] text-muted">
                      {formatDateTime(r.generatedAt)}
                      <br />
                      {r.generatedBy.name} · {formatBytes(r.size)}
                    </TD>
                    <TD>
                      {!r.archivedAt && (
                        <div className="flex gap-1">
                          <Button size="icon-sm" variant="ghost" aria-label="View PDF" onClick={() => open(r.id, true)}>
                            <Eye />
                          </Button>
                          <Button size="icon-sm" variant="ghost" aria-label="Download PDF" onClick={() => open(r.id, false)}>
                            <Download />
                          </Button>
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <Pagination {...q.data.meta} onPage={(p) => set({ page: p })} />
          </>
        )}
      </Card>
      {(can('finding:export') || can('corrective_action:export')) && (
        <Card>
          <CardHeader title="Data exports" description="Exports use the branch and period chosen in the top bar. Every export is recorded in the audit trail." />
          <CardBody className="flex flex-wrap gap-2">
            {can('finding:export') && (
              <>
                <Button onClick={() => findingsService.export(scope.params, 'xlsx')}>
                  <FileSpreadsheet /> Findings (XLSX)
                </Button>
                <Button onClick={() => findingsService.export(scope.params, 'csv')}>Findings (CSV)</Button>
              </>
            )}
            {can('corrective_action:export') && (
              <>
                <Button onClick={() => actionsService.export(scope.params, 'xlsx')}>
                  <FileSpreadsheet /> Corrective actions (XLSX)
                </Button>
                <Button onClick={() => actionsService.export(scope.params, 'csv')}>Corrective actions (CSV)</Button>
              </>
            )}
            <p className="w-full text-xs text-muted">Per-assessment response exports are available from each assessment's Export menu.</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
