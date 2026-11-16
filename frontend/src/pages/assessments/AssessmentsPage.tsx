import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarRange, Plus } from 'lucide-react';
import { assessmentsService } from '@/services/assessments.service';
import { useAuth } from '@/contexts/AuthContext';
import { pageChips, useScope } from '@/hooks/useScope';
import { Button } from '@/components/ui/button';
import { Card, Progress, Table, TD, TH, THead, TR } from '@/components/ui/display';
import { NativeSelect } from '@/components/ui/form-controls';
import { ActiveFilters, EmptyState, ErrorState, LoadingRows, PageHeader, Pagination, SearchInput, StatusBadge, usePaged } from '@/components/common';
import { ASSESSMENT_STATUS } from '@/constants/status';
import { cn, formatDate } from '@/lib/utils';
import type { AssessmentRow } from '@/types/api';

export function AssessmentTable({ rows, onOpen }: { rows: AssessmentRow[]; onOpen: (a: AssessmentRow) => void }) {
  return (
    <Table>
      <THead>
        <tr>
          <TH>Assessment</TH>
          <TH>Site / department</TH>
          <TH>Period</TH>
          <TH>Checklist</TH>
          <TH>Owner</TH>
          <TH>Progress</TH>
          <TH>Status</TH>
          <TH>Due</TH>
        </tr>
      </THead>
      <tbody>
        {rows.map((a) => {
          const pct = a.totalItems ? Math.round(((a.answered ?? 0) / a.totalItems) * 100) : 0;
          return (
            <TR key={a.id} className="cursor-pointer hover:bg-subtle" onClick={() => onOpen(a)}>
              <TD>
                <p className="font-medium">{a.title}</p>
                <p className="text-xs text-muted">{a.code}</p>
              </TD>
              <TD className="text-[13px]">
                {a.site.name}
                <br />
                <span className="text-muted">{a.department.name}</span>
              </TD>
              <TD className="text-[13px]">{a.periodLabel}</TD>
              <TD className="max-w-[220px] text-[13px]">
                <span className="line-clamp-1">{a.checklistVersion.template.title}</span>
                <span className="text-muted">v{a.checklistVersion.versionNumber}</span>
              </TD>
              <TD className="text-[13px]">{a.owner.name}</TD>
              <TD className="min-w-[130px]">
                <div className="flex items-center gap-2">
                  <Progress value={pct} className="w-16" />
                  <span className="tabular text-xs text-muted">
                    {a.answered}/{a.totalItems}
                  </span>
                </div>
              </TD>
              <TD>
                <StatusBadge map={ASSESSMENT_STATUS} value={a.status} />
              </TD>
              <TD className={cn('tabular text-[13px]', a.overdue && 'font-medium text-bad')}>{formatDate(a.dueDate)}</TD>
            </TR>
          );
        })}
      </tbody>
    </Table>
  );
}

export function AssessmentsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const scope = useScope();
  const [params, set, reset] = usePaged({ search: '', status: '' });
  const query = { ...params, ...scope.params };
  const q = useQuery({ queryKey: ['assessments', query], queryFn: () => assessmentsService.list(query) });
  const chips = [...scope.chips, ...pageChips(params, { search: { label: 'Search' }, status: { label: 'Status', format: (v) => ASSESSMENT_STATUS[v]?.label ?? v } }, set)];
  return (
    <div>
      <PageHeader
        title="Assessment Periods"
        description="Time-bound assessments of a published checklist version for a site and department (quarterly IA by default)."
        actions={
          can('assessment:create') && (
            <Button variant="primary" onClick={() => navigate('/assessments/new')}>
              <Plus /> New assessment
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap gap-3 p-5">
          <SearchInput value={params.search as string} onChange={(v) => set({ search: v })} placeholder="Search title or ID" className="w-full max-w-sm" />
          <NativeSelect aria-label="Status" className="w-56" value={params.status as string} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All statuses</option>
            {Object.entries(ASSESSMENT_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <ActiveFilters chips={chips} total={q.data?.meta.total} onClearAll={() => (reset(), scope.clear())} />
        {q.isLoading ? (
          <LoadingRows />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.data.length ? (
          <EmptyState icon={CalendarRange} title="No assessments found" description="Create an assessment from a published checklist version." />
        ) : (
          <>
            <AssessmentTable rows={q.data.data} onOpen={(a) => navigate(`/assessments/${a.id}`)} />
            <Pagination {...q.data.meta} onPage={(p) => set({ page: p })} />
          </>
        )}
      </Card>
    </div>
  );
}
