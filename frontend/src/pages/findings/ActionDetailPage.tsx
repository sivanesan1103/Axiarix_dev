import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Pencil, Send, TrendingUp, Undo2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { actionsService } from '@/services/findings.service';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, Progress } from '@/components/ui/display';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/overlays';
import { Field, Input, Textarea } from '@/components/ui/form-controls';
import { ConfirmDialog, ErrorState, SodNotice, KeyValue, LoadingRows, PageHeader, StatusBadge, Timeline } from '@/components/common';
import { EvidenceList, UploadEvidenceDialog } from '@/components/evidence/EvidenceList';
import { ACTION_STATUS, SEVERITY } from '@/constants/status';
import { cn, formatDate, formatDateTime, toInputDate } from '@/lib/utils';
import { ActionFormDialog } from './FindingDetailPage';

export function ActionDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['action', id], queryFn: () => actionsService.get(id) });
  const [dlg, setDlg] = useState<null | 'edit' | 'progress' | 'upload' | 'submit' | 'verify' | 'return'>(null);
  const [note, setNote] = useState('');
  const [pct, setPct] = useState(0);
  const [closure, setClosure] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['action', id] });
    qc.invalidateQueries({ queryKey: ['actions'] });
    qc.invalidateQueries({ queryKey: ['finding'] });
  };
  const edit = useMutation({
    mutationFn: (v: { rootCause?: string; immediateCorrection?: string; correctiveAction: string; ownerId: string; targetDate: string }) => actionsService.update(id, { ...v, rootCause: v.rootCause || null, immediateCorrection: v.immediateCorrection || null }),
    onSuccess: () => (toast.success('Action updated'), setDlg(null), refresh()),
  });
  const progress = useMutation({ mutationFn: () => actionsService.progress(id, note, pct), onSuccess: () => (toast.success('Progress recorded'), setDlg(null), setNote(''), refresh()) });
  const submit = useMutation({ mutationFn: () => actionsService.submit(id, closure), onSuccess: () => (toast.success('Submitted for verification'), setDlg(null), refresh()) });

  if (q.isLoading) return <Card><LoadingRows rows={8} /></Card>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const a = q.data!;
  const cleanEvidence = a.evidence.filter((e) => e.verificationStatus !== 'REJECTED' && e.versions[0]?.scanStatus === 'CLEAN').length;
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ to: `/findings/${a.finding.id}`, label: `Finding ${a.finding.code}` }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            Corrective action {a.code} <StatusBadge map={ACTION_STATUS} value={a.status} />
          </span>
        }
        description={`${a.finding.title} · owner ${a.owner.name}`}
        actions={
          <>
            {a.actionsAllowed.edit && (
              <>
                <Button onClick={() => setDlg('edit')}>
                  <Pencil /> Edit plan
                </Button>
                <Button onClick={() => (setPct(a.progressPercent), setDlg('progress'))}>
                  <TrendingUp /> Update progress
                </Button>
                <Button variant="primary" onClick={() => setDlg('submit')}>
                  <Send /> Submit for verification
                </Button>
              </>
            )}
            {a.actionsAllowed.verify && (
              <>
                <Button variant="danger-outline" onClick={() => setDlg('return')}>
                  <Undo2 /> Return
                </Button>
                <Button variant="primary" onClick={() => setDlg('verify')}>
                  <CheckCircle2 /> Verify closure
                </Button>
              </>
            )}
          </>
        }
      />
      <SodNotice messages={[a.blocked?.verify]} />
      {a.status === 'RETURNED' && a.verificationComment && <p className="rounded-lg border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad">Returned by auditor: {a.verificationComment}</p>}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card>
            <CardBody className="pt-5">
              <div className="mb-5 flex items-center gap-3">
                <Progress value={a.progressPercent} tone={a.status === 'VERIFIED' ? 'ok' : 'brand'} className="h-2.5 flex-1" />
                <span className="tabular text-sm font-semibold">{a.progressPercent}%</span>
              </div>
              <dl className="grid gap-5 sm:grid-cols-3">
                <KeyValue label="Finding">
                  <Link className="text-brand hover:underline" to={`/findings/${a.finding.id}`}>
                    {a.finding.code}
                  </Link>{' '}
                  <Badge tone={SEVERITY[a.finding.severity]?.tone}>{SEVERITY[a.finding.severity]?.label}</Badge>
                </KeyValue>
                <KeyValue label="Responsible owner">{a.owner.name}</KeyValue>
                <KeyValue label="Target date">
                  <span className={cn(a.overdue && 'font-medium text-bad')}>
                    {formatDate(a.targetDate)}
                    {a.overdue && ' · overdue'}
                  </span>
                </KeyValue>
                <KeyValue label="Root cause" className="sm:col-span-3">
                  {a.rootCause || <span className="text-faint">Not recorded</span>}
                </KeyValue>
                <KeyValue label="Immediate correction" className="sm:col-span-3">
                  {a.immediateCorrection || <span className="text-faint">Not recorded</span>}
                </KeyValue>
                <KeyValue label="Corrective action" className="sm:col-span-3">
                  <span className="whitespace-pre-wrap">{a.correctiveAction}</span>
                </KeyValue>
                {a.closureNotes && (
                  <KeyValue label="Closure notes" className="sm:col-span-3">
                    {a.closureNotes}
                  </KeyValue>
                )}
                {a.verifiedAt && (
                  <KeyValue label="Verified" className="sm:col-span-3">
                    {formatDateTime(a.verifiedAt)} {a.verificationComment && `· ${a.verificationComment}`}
                  </KeyValue>
                )}
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Closure evidence"
              description="At least one clean file is required before submitting for verification."
              actions={
                a.actionsAllowed.edit && (
                  <Button size="sm" variant="soft" onClick={() => setDlg('upload')}>
                    <Upload /> Upload
                  </Button>
                )
              }
            />
            <CardBody>
              <EvidenceList items={a.evidence} canVersion={a.actionsAllowed.edit} onChanged={refresh} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Progress updates" />
            <CardBody>
              {!a.updates.length ? (
                <p className="text-sm text-muted">No progress updates yet.</p>
              ) : (
                <ul className="space-y-3">
                  {a.updates.map((u) => (
                    <li key={u.id} className="rounded-md border border-line px-3 py-2.5">
                      <p className="text-xs text-muted">
                        <span className="font-medium text-ink">{u.author.name}</span> · {formatDateTime(u.createdAt)}
                        {u.progressPercent != null && ` · ${u.progressPercent}%`}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-[13px]">{u.note}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
        <Card>
          <CardHeader title="Lifecycle" />
          <CardBody>
            <Timeline items={a.history.map((h) => ({ id: h.id, title: ACTION_STATUS[h.toStatus]?.label ?? h.toStatus, meta: h.actor?.name, body: h.reason, at: h.createdAt, tone: ACTION_STATUS[h.toStatus]?.tone }))} />
          </CardBody>
        </Card>
      </div>

      <ActionFormDialog
        open={dlg === 'edit'}
        onOpenChange={(o) => !o && setDlg(null)}
        title={`Edit ${a.code}`}
        initial={{ rootCause: a.rootCause ?? '', immediateCorrection: a.immediateCorrection ?? '', correctiveAction: a.correctiveAction, ownerId: a.ownerId, targetDate: toInputDate(a.targetDate) }}
        siteId={a.finding.site?.id}
        onSubmit={(v) => edit.mutate(v)}
        submitting={edit.isPending}
      />
      <Dialog open={dlg === 'progress'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader title="Update progress" />
          <DialogBody className="space-y-4">
            <Field label={`Progress: ${pct}%`}>
              <Input type="range" min={0} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="h-auto border-0 px-0 accent-brand" />
            </Field>
            <Field label="Update note" required>
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setDlg(null)}>Cancel</Button>
            <Button variant="primary" disabled={note.trim().length < 3} loading={progress.isPending} onClick={() => progress.mutate()}>
              Save update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={dlg === 'submit'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader title="Submit for verification" description={cleanEvidence ? `${cleanEvidence} closure evidence file(s) attached.` : 'Attach closure evidence first — submission is blocked without it.'} />
          <DialogBody>
            <Field label="Closure notes" required>
              <Textarea rows={3} value={closure} onChange={(e) => setClosure(e.target.value)} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setDlg(null)}>Cancel</Button>
            <Button variant="primary" disabled={!cleanEvidence || closure.trim().length < 5} loading={submit.isPending} onClick={() => submit.mutate()}>
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <UploadEvidenceDialog open={dlg === 'upload'} onOpenChange={(o) => !o && setDlg(null)} link={{ correctiveActionId: a.id }} onUploaded={refresh} />
      <ConfirmDialog
        open={dlg === 'verify'}
        onOpenChange={() => setDlg(null)}
        title="Verify closure"
        description="Confirms the closure evidence is sufficient. The auditor can then close the finding."
        confirmLabel="Verify"
        onConfirm={async () => {
          await actionsService.verify(id, 'VERIFIED');
          toast.success('Corrective action verified');
          refresh();
        }}
      />
      <ConfirmDialog
        open={dlg === 'return'}
        onOpenChange={() => setDlg(null)}
        title="Return closure evidence"
        description="The action goes back to the owner and the finding returns to Action in progress."
        reasonLabel="Why is the evidence insufficient?"
        tone="danger"
        confirmLabel="Return"
        onConfirm={async (reason) => {
          await actionsService.verify(id, 'RETURNED', reason);
          toast.success('Returned to owner');
          refresh();
        }}
      />
    </div>
  );
}
