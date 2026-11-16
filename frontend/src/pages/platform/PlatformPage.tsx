import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { platformService, type PlatformOrg } from '@/services/platform.service';
import { Button } from '@/components/ui/button';
import { Badge, Card, Table, TD, TH, THead, TR } from '@/components/ui/display';
import { ConfirmDialog, EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/common';
import { formatDate, formatDateTime } from '@/lib/utils';

/** Platform owner's home: every customer organisation, with suspend / reactivate. */
export function PlatformPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform-orgs'], queryFn: platformService.organisations });
  const [target, setTarget] = useState<PlatformOrg | null>(null);
  return (
    <div>
      <PageHeader
        title="Organisations"
        description="Each organisation has its own branches, users, roles, settings and audit data. Platform owners create organisations but cannot see their audit data."
        actions={
          <Button variant="primary" onClick={() => navigate('/platform/new')}>
            <Plus /> New organisation
          </Button>
        }
      />
      <Card>
        {q.isLoading ? (
          <LoadingRows />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState icon={Building2} title="No organisations yet" description="Create the first one with the wizard; you can load it from a setup workbook." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Organisation</TH>
                <TH>Branches</TH>
                <TH>Users</TH>
                <TH>Checklists</TH>
                <TH>Assessments</TH>
                <TH>Administrators</TH>
                <TH>Status</TH>
                <TH className="w-32" />
              </tr>
            </THead>
            <tbody>
              {q.data.map((o) => (
                <TR key={o.id}>
                  <TD>
                    <p className="font-medium">{o.name}</p>
                    <p className="text-xs text-muted">
                      {o.legalEntity ?? '—'} · created {formatDate(o.createdAt)}
                    </p>
                  </TD>
                  <TD className="tabular">{o._count.sites}</TD>
                  <TD className="tabular">{o._count.users}</TD>
                  <TD className="tabular">{o._count.checklistTemplates}</TD>
                  <TD className="tabular">{o._count.assessments}</TD>
                  <TD className="text-[13px]">
                    {o.admins.length ? (
                      o.admins.map((a) => (
                        <span key={a.id} className="block">
                          {a.name} <span className="text-muted">· {a.lastLoginAt ? `last in ${formatDateTime(a.lastLoginAt)}` : 'not signed in yet'}</span>
                        </span>
                      ))
                    ) : (
                      <span className="text-bad">No active organisation-wide admin</span>
                    )}
                  </TD>
                  <TD>
                    <Badge tone={o.status === 'ACTIVE' ? 'ok' : 'warn'} dot>
                      {o.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                    </Badge>
                  </TD>
                  <TD>
                    <Button size="sm" variant={o.status === 'ACTIVE' ? 'ghost' : 'soft'} onClick={() => setTarget(o)}>
                      {o.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                    </Button>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={target?.status === 'ACTIVE' ? `Suspend ${target?.name}?` : `Reactivate ${target?.name}?`}
        description={target?.status === 'ACTIVE' ? 'Everyone in this organisation is signed out and cannot sign in until it is reactivated. No data is deleted.' : 'People in this organisation can sign in again.'}
        confirmLabel={target?.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
        tone={target?.status === 'ACTIVE' ? 'danger' : 'primary'}
        reasonLabel="Reason"
        onConfirm={async (reason) => {
          await platformService.update(target!.id, { status: target!.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', reason });
          toast.success(target!.status === 'ACTIVE' ? 'Organisation suspended' : 'Organisation reactivated');
          qc.invalidateQueries({ queryKey: ['platform-orgs'] });
        }}
      />
    </div>
  );
}
