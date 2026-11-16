import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { assessmentsService } from '@/services/assessments.service';
import { evidenceService } from '@/services/evidence.service';
import { actionsService, findingsService } from '@/services/findings.service';
import { Badge, Card, CardHeader, Table, TD, TH, THead, TR } from '@/components/ui/display';
import { ActiveFilters, EmptyState, ErrorState, LoadingRows, PageHeader, StatusBadge } from '@/components/common';
import { useScope } from '@/hooks/useScope';
import { AssessmentTable } from '@/pages/assessments/AssessmentsPage';
import { SEVERITY, FINDING_STATUS } from '@/constants/status';
import { cn, formatDate } from '@/lib/utils';

export function AuditorPage() {
  const navigate = useNavigate();
  const scope = useScope();
  const s = scope.params;
  const OPEN = 'OPEN,ASSIGNED,ACTION_IN_PROGRESS,READY_FOR_VERIFICATION';
  const queue = useQuery({ queryKey: ['assessments', 'audit-queue', s], queryFn: () => assessmentsService.list({ ...s, status: 'SUBMITTED_FOR_AUDIT,UNDER_REVIEW', pageSize: 50 }) });
  const clar = useQuery({ queryKey: ['assessments', 'clarification', s], queryFn: () => assessmentsService.list({ ...s, status: 'CLARIFICATION_REQUIRED', pageSize: 50 }) });
  const done = useQuery({ queryKey: ['assessments', 'reviewed', s], queryFn: () => assessmentsService.list({ ...s, status: 'REVIEWED,PENDING_APPROVAL,APPROVED', pageSize: 10 }) });
  const pendingEvidence = useQuery({ queryKey: ['evidence', 'pending-count', s], queryFn: () => evidenceService.list({ ...s, verificationStatus: 'PENDING', link: 'response', pageSize: 1 }) });
  const open = useQuery({ queryKey: ['findings', 'open-audit', s], queryFn: () => findingsService.list({ ...s, status: OPEN, pageSize: 8 }) });
  const high = useQuery({ queryKey: ['findings', 'high', s], queryFn: () => findingsService.list({ ...s, status: OPEN, severity: 'HIGH', pageSize: 1 }) });
  const critical = useQuery({ queryKey: ['findings', 'critical', s], queryFn: () => findingsService.list({ ...s, status: OPEN, severity: 'CRITICAL', pageSize: 1 }) });
  const verify = useQuery({ queryKey: ['actions', 'verify', s], queryFn: () => actionsService.list({ ...s, status: 'SUBMITTED_FOR_VERIFICATION', pageSize: 10 }) });

  const tiles = [
    { label: 'Awaiting review', value: queue.data?.meta.total },
    { label: 'Evidence to verify', value: pendingEvidence.data?.meta.total },
    { label: 'Clarifications out', value: clar.data?.meta.total },
    { label: 'Open findings', value: open.data?.meta.total },
    { label: 'Critical / high', value: (critical.data?.meta.total ?? 0) + (high.data?.meta.total ?? 0), alert: true },
    { label: 'Closure verification', value: verify.data?.meta.total },
    { label: 'Completed reviews', value: done.data?.meta.total },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Auditor Workspace" description="Review submitted assessments, verify evidence, raise findings and verify corrective actions." />
      {scope.chips.length > 0 && (
        <Card>
          <ActiveFilters chips={scope.chips} onClearAll={scope.clear} className="border-0" />
        </Card>
      )}
      <Card className="bg-subtle/60">
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7">
          {tiles.map((t, i) => (
            <div key={t.label} className={cn('px-6 py-6', i > 0 && 'xl:border-l', 'border-line')}>
              <p className={cn('tabular text-[30px] font-semibold leading-none', t.alert && (t.value ?? 0) > 0 && 'text-bad')}>{t.value ?? '—'}</p>
              <p className="mt-2 text-[14px] text-ink-2">{t.label}</p>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="Review queue" description="Submitted for audit or under review" />
        {queue.isLoading ? (
          <LoadingRows />
        ) : queue.isError ? (
          <ErrorState error={queue.error} onRetry={() => queue.refetch()} />
        ) : !queue.data?.data.length ? (
          <EmptyState icon={ShieldCheck} title="No assessments awaiting review" />
        ) : (
          <AssessmentTable rows={queue.data.data} onOpen={(a) => navigate(`/auditor/${a.id}`)} />
        )}
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Corrective actions awaiting verification" />
          {!verify.data?.data.length ? (
            <EmptyState title="Nothing to verify" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Action</TH>
                  <TH>Finding</TH>
                  <TH>Owner</TH>
                  <TH>Target</TH>
                </tr>
              </THead>
              <tbody>
                {verify.data.data.map((c) => (
                  <TR key={c.id} className="cursor-pointer hover:bg-subtle" onClick={() => navigate(`/corrective-actions/${c.id}`)}>
                    <TD className="font-medium">{c.code}</TD>
                    <TD className="text-[13px]">{c.finding.code}</TD>
                    <TD className="text-[13px]">{c.owner.name}</TD>
                    <TD className="text-[13px]">{formatDate(c.targetDate)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Open findings" actions={<Link to="/findings" className="text-sm text-brand hover:underline">All findings</Link>} />
          {!open.data?.data.length ? (
            <EmptyState title="No open findings" />
          ) : (
            <Table>
              <tbody>
                {open.data.data.map((f) => (
                  <TR key={f.id} className="cursor-pointer hover:bg-subtle" onClick={() => navigate(`/findings/${f.id}`)}>
                    <TD>
                      <Badge tone={SEVERITY[f.severity]?.tone}>{SEVERITY[f.severity]?.label}</Badge>
                    </TD>
                    <TD>
                      <p className="font-medium">{f.code}</p>
                      <p className="line-clamp-1 text-xs text-muted">{f.title}</p>
                    </TD>
                    <TD>
                      <StatusBadge map={FINDING_STATUS} value={f.status} />
                    </TD>
                    <TD className={cn('text-[13px]', f.overdue && 'text-bad')}>{formatDate(f.dueDate)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
      {!!clar.data?.data.length && (
        <Card>
          <CardHeader title="Clarifications with the department" />
          <AssessmentTable rows={clar.data.data} onOpen={(a) => navigate(`/auditor/${a.id}`)} />
        </Card>
      )}
    </div>
  );
}
