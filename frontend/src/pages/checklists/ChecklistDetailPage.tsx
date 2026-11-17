import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, FileSpreadsheet, GitBranch, PencilLine } from 'lucide-react';
import { toast } from 'sonner';
import { checklistsService } from '@/services/checklists.service';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Table, TD, TH, THead, TR } from '@/components/ui/display';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/overlays';
import { Field, Textarea } from '@/components/ui/form-controls';
import { ErrorState, LoadingRows, PageHeader, StatusBadge, Timeline } from '@/components/common';
import { CHECKLIST_STATUS } from '@/constants/status';
import { formatDate, humanize } from '@/lib/utils';

export function ChecklistDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['checklist', id], queryFn: () => checklistsService.get(id) });
  const [newVer, setNewVer] = useState<{ open: boolean; from?: string }>({ open: false });
  const [summary, setSummary] = useState('');
  const m = useMutation({
    mutationFn: () => checklistsService.newVersion(id, summary, newVer.from),
    onSuccess: (v) => {
      toast.success(`Draft version ${v.versionNumber} created`);
      qc.invalidateQueries({ queryKey: ['checklist', id] });
      navigate(`/checklists/${id}/versions/${v.id}`);
    },
  });
  if (q.isLoading) return <Card><LoadingRows /></Card>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const t = q.data!;
  const hasOpenDraft = t.versions.some((v) => v.status === 'DRAFT' || v.status === 'UNDER_REVIEW');
  const versionNo = (vid?: string) => t.versions.find((v) => v.id === vid)?.versionNumber;

  return (
    <div>
      <PageHeader
        back={{ to: '/checklists', label: 'Checklist Library' }}
        title={t.title}
        description={t.description}
        actions={
          can('checklist:create', 'checklist:update') && (
            <Button variant="primary" disabled={hasOpenDraft} title={hasOpenDraft ? 'Finish the open draft first' : undefined} onClick={() => setNewVer({ open: true })}>
              <GitBranch /> New version
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px] [&>*]:min-w-0">
        <Card>
          <CardHeader title="Versions" description="Assessments keep the exact version they were created from." />
          <Table>
            <THead>
              <tr>
                <TH>Version</TH>
                <TH>Status</TH>
                <TH>Questions</TH>
                <TH>Assessments</TH>
                <TH>Published</TH>
                <TH>Change summary</TH>
                <TH className="w-40" />
              </tr>
            </THead>
            <tbody>
              {t.versions.map((v) => (
                <TR key={v.id}>
                  <TD className="font-semibold">v{v.versionNumber}</TD>
                  <TD>
                    <StatusBadge map={CHECKLIST_STATUS} value={v.status} />
                  </TD>
                  <TD className="tabular">{v._count?.items}</TD>
                  <TD className="tabular">{v._count?.assessments}</TD>
                  <TD className="text-[13px]">{formatDate(v.publishedAt)}</TD>
                  <TD className="max-w-xs text-[13px] text-muted">
                    {v.changeSummary}
                    {v.sourceImport && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs">
                        <FileSpreadsheet className="size-3" /> {v.sourceImport.fileName}
                      </span>
                    )}
                  </TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant={v.status === 'DRAFT' ? 'soft' : 'ghost'} asChild>
                        <Link to={`/checklists/${id}/versions/${v.id}`}>
                          <PencilLine /> {v.status === 'DRAFT' ? 'Edit' : 'View'}
                        </Link>
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Export to Excel" onClick={() => checklistsService.exportVersion(v.id)}>
                        <Download />
                      </Button>
                      {can('checklist:create') && !hasOpenDraft && v.status !== 'DRAFT' && (
                        <Button size="icon-sm" variant="ghost" aria-label="Copy into new version" onClick={() => setNewVer({ open: true, from: v.id })}>
                          <Copy />
                        </Button>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Version history" />
          <CardBody>
            <Timeline
              items={t.history.map((h) => ({
                id: h.id,
                title: `v${versionNo(h.entityId) ?? '?'} → ${humanize(h.toStatus)}`,
                meta: h.actor?.name,
                body: h.reason,
                at: h.createdAt,
                tone: CHECKLIST_STATUS[h.toStatus]?.tone,
              }))}
            />
          </CardBody>
        </Card>
      </div>
      <Dialog open={newVer.open} onOpenChange={(o) => setNewVer((s) => ({ ...s, open: o }))}>
        <DialogContent>
          <DialogHeader title="Create new version" description={`Copies all questions and mappings from ${newVer.from ? `v${versionNo(newVer.from)}` : 'the latest published version'} into a new draft.`} />
          <DialogBody>
            <Field label="What will change?" required hint="Recorded in version history." htmlFor="nv-sum">
              <Textarea id="nv-sum" value={summary} onChange={(e) => setSummary(e.target.value)} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setNewVer({ open: false })}>Cancel</Button>
            <Button variant="primary" disabled={summary.trim().length < 3} loading={m.isPending} onClick={() => m.mutate()}>
              Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
