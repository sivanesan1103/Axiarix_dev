import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Siren } from 'lucide-react';
import { findingsService } from '@/services/findings.service';
import { useAuth } from '@/contexts/AuthContext';
import { useScope, pageChips } from '@/hooks/useScope';
import { Button } from '@/components/ui/button';
import { Badge, Card, Table, TD, TH, THead, TR } from '@/components/ui/display';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays';
import { NativeSelect } from '@/components/ui/form-controls';
import { ActiveFilters, EmptyState, ErrorState, LoadingRows, PageHeader, Pagination, SearchInput, StatusBadge, usePaged } from '@/components/common';
import { FINDING_CATEGORY, FINDING_STATUS, SEVERITY } from '@/constants/status';
import { cn, formatDate } from '@/lib/utils';

const OPEN_STATUSES = 'OPEN,ASSIGNED,ACTION_IN_PROGRESS,READY_FOR_VERIFICATION';

export function FindingsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const scope = useScope();
  const [params, set, reset] = usePaged({ search: '', status: '', severity: '', ownerId: '', overdue: '', assessmentId: '' });
  const query = { ...params, ...scope.params };
  const q = useQuery({ queryKey: ['findings', query], queryFn: () => findingsService.list(query) });
  const chips = [
    ...scope.chips,
    ...pageChips(
      params,
      {
        search: { label: 'Search' },
        status: { label: 'Status', format: (v) => (v === OPEN_STATUSES ? 'All open' : (FINDING_STATUS[v]?.label ?? v)) },
        severity: { label: 'Severity', format: (v) => SEVERITY[v]?.label ?? v },
        ownerId: { label: 'Owner', format: () => 'Me' },
        overdue: { label: 'Overdue', format: () => 'Only' },
        assessmentId: { label: 'Assessment', format: () => 'One assessment' },
      },
      set,
    ),
  ];
  return (
    <div>
      <PageHeader
        title="Findings"
        description="Nonconformities, observations and improvement items raised by auditors. Overdue status is derived from due date and closure state."
        actions={
          can('finding:export') && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>
                  <Download /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => findingsService.export(query, 'xlsx')}>Excel (XLSX) · rows shown</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => findingsService.export(query, 'csv')}>CSV · rows shown</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap gap-3 p-5">
          <SearchInput value={params.search as string} onChange={(v) => set({ search: v })} placeholder="Search findings" className="w-full max-w-xs" />
          <NativeSelect aria-label="Status" className="w-52" value={params.status as string} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Any status</option>
            <option value={OPEN_STATUSES}>All open</option>
            {Object.entries(FINDING_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Severity" className="w-40" value={params.severity as string} onChange={(e) => set({ severity: e.target.value })}>
            <option value="">Any severity</option>
            {Object.entries(SEVERITY).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Owner" className="w-40" value={params.ownerId as string} onChange={(e) => set({ ownerId: e.target.value })}>
            <option value="">Any owner</option>
            <option value="me">Owned by me</option>
          </NativeSelect>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand" checked={params.overdue === 'true'} onChange={(e) => set({ overdue: e.target.checked ? 'true' : '' })} /> Overdue only
          </label>
        </div>
        <ActiveFilters chips={chips} total={q.data?.meta.total} onClearAll={() => (reset(), scope.clear())} />
        {q.isLoading ? (
          <LoadingRows />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.data.length ? (
          <EmptyState icon={Siren} title="No findings" description="Findings are raised by auditors during assessment review." />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Finding</TH>
                  <TH>Severity</TH>
                  <TH>Category</TH>
                  <TH>Assessment</TH>
                  <TH>Owner</TH>
                  <TH>Due</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <tbody>
                {q.data.data.map((f) => (
                  <TR key={f.id} className="cursor-pointer hover:bg-subtle" onClick={() => navigate(`/findings/${f.id}`)}>
                    <TD className="max-w-md">
                      <p className="font-medium">{f.title}</p>
                      <p className="text-xs text-muted">
                        {f.code}
                        {f.item && ` · ${f.item.questionCode}`}
                      </p>
                    </TD>
                    <TD>
                      <Badge tone={SEVERITY[f.severity]?.tone} dot>
                        {SEVERITY[f.severity]?.label}
                      </Badge>
                    </TD>
                    <TD className="text-[13px]">{FINDING_CATEGORY[f.category]}</TD>
                    <TD className="text-[13px]">
                      {f.assessment.code}
                      <span className="block text-muted">{f.site.name}</span>
                    </TD>
                    <TD className="text-[13px]">{f.owner?.name ?? <span className="text-faint">Unassigned</span>}</TD>
                    <TD className={cn('tabular text-[13px]', f.overdue && 'font-medium text-bad')}>
                      {formatDate(f.dueDate)}
                      {f.overdue && <span className="block text-xs">Overdue</span>}
                    </TD>
                    <TD>
                      <StatusBadge map={FINDING_STATUS} value={f.status} />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <Pagination {...q.data.meta} onPage={(p) => set({ page: p })} />
          </>
        )}
      </Card>
    </div>
  );
}
