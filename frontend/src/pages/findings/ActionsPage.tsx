import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Wrench } from 'lucide-react';
import { actionsService } from '@/services/findings.service';
import { useAuth } from '@/contexts/AuthContext';
import { pageChips, useScope } from '@/hooks/useScope';
import { Button } from '@/components/ui/button';
import { Badge, Card, Progress, Table, TD, TH, THead, TR } from '@/components/ui/display';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays';
import { NativeSelect } from '@/components/ui/form-controls';
import { ActiveFilters, EmptyState, ErrorState, LoadingRows, PageHeader, Pagination, SearchInput, StatusBadge, usePaged } from '@/components/common';
import { ACTION_STATUS, SEVERITY } from '@/constants/status';
import { cn, formatDate } from '@/lib/utils';

export function ActionsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const scope = useScope();
  const [params, set, reset] = usePaged({ search: '', status: '', ownerId: '', overdue: '' });
  const query = { ...params, ...scope.params };
  const q = useQuery({ queryKey: ['actions', query], queryFn: () => actionsService.list(query) });
  const chips = [
    ...scope.chips,
    ...pageChips(
      params,
      { search: { label: 'Search' }, status: { label: 'Status', format: (v) => ACTION_STATUS[v]?.label ?? v }, ownerId: { label: 'Owner', format: () => 'Me' }, overdue: { label: 'Overdue', format: () => 'Only' } },
      set,
    ),
  ];
  return (
    <div>
      <PageHeader
        title="Corrective Actions"
        description="Root cause, correction and corrective action for each finding, tracked to verified closure."
        actions={
          can('corrective_action:export', 'finding:export', 'report:export') && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>
                  <Download /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => actionsService.export(query, 'xlsx')}>Excel (XLSX) · rows shown</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actionsService.export(query, 'csv')}>CSV · rows shown</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap gap-3 p-5">
          <SearchInput value={params.search as string} onChange={(v) => set({ search: v })} placeholder="Search actions or finding ID" className="w-full max-w-xs" />
          <NativeSelect aria-label="Status" className="w-56" value={params.status as string} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Any status</option>
            {Object.entries(ACTION_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Owner" className="w-40" value={params.ownerId as string} onChange={(e) => set({ ownerId: e.target.value })}>
            <option value="">Any owner</option>
            <option value="me">My actions</option>
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
          <EmptyState icon={Wrench} title="No corrective actions" description="Actions are planned from a finding." />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Action</TH>
                  <TH>Finding</TH>
                  <TH>Owner</TH>
                  <TH>Target</TH>
                  <TH>Progress</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <tbody>
                {q.data.data.map((a) => (
                  <TR key={a.id} className="cursor-pointer hover:bg-subtle" onClick={() => navigate(`/corrective-actions/${a.id}`)}>
                    <TD className="max-w-md">
                      <p className="font-medium">{a.code}</p>
                      <p className="line-clamp-1 text-xs text-muted">{a.correctiveAction}</p>
                    </TD>
                    <TD className="text-[13px]">
                      <span className="flex items-center gap-1.5">
                        <Badge tone={SEVERITY[a.finding.severity]?.tone}>{SEVERITY[a.finding.severity]?.label}</Badge> {a.finding.code}
                      </span>
                    </TD>
                    <TD className="text-[13px]">{a.owner.name}</TD>
                    <TD className={cn('tabular text-[13px]', a.overdue && 'font-medium text-bad')}>
                      {formatDate(a.targetDate)}
                      {a.overdue && <span className="block text-xs">Overdue</span>}
                    </TD>
                    <TD className="min-w-[120px]">
                      <div className="flex items-center gap-2">
                        <Progress value={a.progressPercent} tone={a.status === 'VERIFIED' ? 'ok' : 'brand'} className="w-16" />
                        <span className="tabular text-xs text-muted">{a.progressPercent}%</span>
                      </div>
                    </TD>
                    <TD>
                      <StatusBadge map={ACTION_STATUS} value={a.status} />
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
