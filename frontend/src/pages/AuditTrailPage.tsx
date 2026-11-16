import { Fragment, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, ScrollText, ShieldCheck, ShieldX } from 'lucide-react';
import { toast } from 'sonner';
import { auditService } from '@/services/reports.service';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge, Card, Table, TD, TH, THead, TR } from '@/components/ui/display';
import { Input, NativeSelect } from '@/components/ui/form-controls';
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination, SearchInput, usePaged } from '@/components/common';
import { formatDateTime, humanize } from '@/lib/utils';

export function AuditTrailPage() {
  const { can } = useAuth();
  const [params, set] = usePaged({ search: '', action: '', outcome: '', entityType: '', from: '', to: '', pageSize: 50 });
  const q = useQuery({ queryKey: ['audit', params], queryFn: () => auditService.list(params) });
  const actions = useQuery({ queryKey: ['audit-actions'], queryFn: auditService.actions, staleTime: 60_000 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const verify = useMutation({
    mutationFn: auditService.verify,
    onSuccess: (r) => (r.valid ? toast.success(`Hash chain intact — ${r.checked} events verified`) : toast.error(`Chain broken at event #${r.brokenAtSeq}`)),
  });
  return (
    <div>
      <PageHeader
        title="Audit Trail"
        description="Append-only, hash-chained log of security-relevant and business-critical actions. Records cannot be edited or deleted through the application."
        actions={
          <>
            <Button loading={verify.isPending} onClick={() => verify.mutate()}>
              {verify.data && !verify.data.valid ? <ShieldX /> : <ShieldCheck />} Verify integrity
            </Button>
            {can('audit_log:export') && (
              <Button onClick={() => auditService.export(params, 'csv')}>
                <Download /> Export CSV
              </Button>
            )}
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap gap-3 p-5">
          <SearchInput value={params.search as string} onChange={(v) => set({ search: v })} placeholder="Search actor, action or entity ID" className="w-full max-w-xs" />
          <NativeSelect aria-label="Action" className="w-60" value={params.action as string} onChange={(e) => set({ action: e.target.value })}>
            <option value="">All actions</option>
            {actions.data?.map((a) => (
              <option key={a} value={a}>
                {humanize(a)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Outcome" className="w-40" value={params.outcome as string} onChange={(e) => set({ outcome: e.target.value })}>
            <option value="">Any outcome</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILURE">Failure</option>
            <option value="DENIED">Denied</option>
          </NativeSelect>
          <Input aria-label="From date" type="date" className="w-40" value={params.from as string} onChange={(e) => set({ from: e.target.value })} />
          <Input aria-label="To date" type="date" className="w-40" value={params.to as string} onChange={(e) => set({ to: e.target.value ? `${e.target.value}T23:59:59` : '' })} />
        </div>
        {q.isLoading ? (
          <LoadingRows rows={10} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.data.length ? (
          <EmptyState icon={ScrollText} title="No events match these filters" />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH className="w-16">#</TH>
                  <TH>Timestamp</TH>
                  <TH>Actor</TH>
                  <TH>Action</TH>
                  <TH>Entity</TH>
                  <TH>Outcome</TH>
                  <TH>Source</TH>
                </tr>
              </THead>
              <tbody>
                {q.data.data.map((e) => (
                  <Fragment key={e.id}>
                    <TR className="cursor-pointer hover:bg-subtle" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                      <TD className="tabular text-xs text-muted">{e.seq}</TD>
                      <TD className="whitespace-nowrap text-[13px]">{formatDateTime(e.createdAt)}</TD>
                      <TD className="text-[13px]">{e.actor?.name ?? e.actorEmail ?? 'System'}</TD>
                      <TD className="text-[13px] font-medium">{humanize(e.action)}</TD>
                      <TD className="text-[13px]">
                        {e.entityType}
                        {e.entityId && <span className="block max-w-[180px] truncate text-xs text-muted">{e.entityId}</span>}
                      </TD>
                      <TD>
                        <Badge tone={e.outcome === 'SUCCESS' ? 'ok' : e.outcome === 'DENIED' ? 'bad' : 'warn'} dot>
                          {humanize(e.outcome)}
                        </Badge>
                      </TD>
                      <TD className="text-xs text-muted">{e.ip ?? '—'}</TD>
                    </TR>
                    {expanded === e.id && (
                      <tr className="border-b border-line bg-subtle/60">
                        <td colSpan={7} className="px-5 py-3">
                          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs text-ink-2">{JSON.stringify(e.metadata ?? {}, null, 2)}</pre>
                          <p className="mt-2 break-all font-mono text-[11px] text-faint">hash {e.hash}</p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
