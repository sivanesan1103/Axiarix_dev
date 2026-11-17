import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, MessageSquare, Pencil, Plus, Upload, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { findingsService, type FindingDetail } from '@/services/findings.service';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, CardBody, CardHeader, Progress, Table, TD, TH, THead, TR } from '@/components/ui/display';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/overlays';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/form-controls';
import { ErrorState, KeyValue, LoadingRows, PageHeader, StatusBadge, Timeline } from '@/components/common';
import { UserSelect } from '@/components/common/pickers';
import { EvidenceList, UploadEvidenceDialog } from '@/components/evidence/EvidenceList';
import { ACTION_STATUS, FINDING_CATEGORY, FINDING_STATUS, SEVERITY } from '@/constants/status';
import { cn, formatDate, formatDateTime, toInputDate } from '@/lib/utils';

const actionSchema = z.object({
  rootCause: z.string().max(4000).optional(),
  immediateCorrection: z.string().max(4000).optional(),
  correctiveAction: z.string().trim().min(5, 'Describe the corrective action'),
  ownerId: z.string().min(1, 'Select the responsible owner'),
  targetDate: z.string().min(1, 'Target date is required'),
});

export function ActionFormDialog({ open, onOpenChange, title, initial, siteId, departmentId, onSubmit, submitting }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; initial?: Partial<z.infer<typeof actionSchema>>; siteId?: string; departmentId?: string; onSubmit: (v: z.infer<typeof actionSchema>) => void; submitting: boolean }) {
  const form = useForm<z.infer<typeof actionSchema>>({
    resolver: zodResolver(actionSchema),
    values: { rootCause: initial?.rootCause ?? '', immediateCorrection: initial?.immediateCorrection ?? '', correctiveAction: initial?.correctiveAction ?? '', ownerId: initial?.ownerId ?? '', targetDate: initial?.targetDate ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) },
  });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader title={title} description="Root cause analysis, immediate correction and the corrective action to prevent recurrence." />
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Root cause" className="sm:col-span-2" htmlFor="ca-rc">
              <Textarea id="ca-rc" rows={2} {...form.register('rootCause')} />
            </Field>
            <Field label="Immediate correction" className="sm:col-span-2" htmlFor="ca-ic">
              <Textarea id="ca-ic" rows={2} {...form.register('immediateCorrection')} />
            </Field>
            <Field label="Corrective action" required className="sm:col-span-2" error={e.correctiveAction?.message} htmlFor="ca-ca">
              <Textarea id="ca-ca" rows={3} {...form.register('correctiveAction')} />
            </Field>
            <Field label="Responsible owner" required error={e.ownerId?.message} htmlFor="ca-owner">
              <UserSelect id="ca-owner" value={form.watch('ownerId')} onChange={(v) => form.setValue('ownerId', v, { shouldValidate: true })} roles={['IT_OWNER', 'CONTRIBUTOR']} siteId={siteId} departmentId={departmentId} />
            </Field>
            <Field label="Target completion date" required error={e.targetDate?.message} htmlFor="ca-date">
              <Input id="ca-date" type="date" {...form.register('targetDate')} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={submitting}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditFindingDialog({ f, open, onOpenChange, onSaved }: { f: FindingDetail; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const form = useForm({ values: { title: f.title, description: f.description, auditorComments: f.auditorComments ?? '', severity: f.severity, category: f.category, dueDate: toInputDate(f.dueDate) } });
  const m = useMutation({ mutationFn: (v: Record<string, string>) => findingsService.update(f.id, { ...v, auditorComments: v.auditorComments || null }), onSuccess: () => (toast.success('Finding updated'), onSaved(), onOpenChange(false)) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader title={`Edit ${f.code}`} />
        <form onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" className="sm:col-span-2">
              <Input {...form.register('title', { required: true, minLength: 3 })} />
            </Field>
            <Field label="Severity">
              <NativeSelect {...form.register('severity')}>
                {Object.entries(SEVERITY).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Category">
              <NativeSelect {...form.register('category')}>
                {Object.entries(FINDING_CATEGORY).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <Textarea rows={3} {...form.register('description', { required: true, minLength: 5 })} />
            </Field>
            <Field label="Auditor comments" className="sm:col-span-2">
              <Textarea rows={2} {...form.register('auditorComments')} />
            </Field>
            <Field label="Due date">
              <Input type="date" {...form.register('dueDate', { required: true })} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={m.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FindingDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['finding', id], queryFn: () => findingsService.get(id) });
  const [dlg, setDlg] = useState<null | 'assign' | 'action' | 'close' | 'edit' | 'upload'>(null);
  const [assignee, setAssignee] = useState('');
  const [closure, setClosure] = useState({ recommendation: '', override: '' });
  const [comment, setComment] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['finding', id] });
    qc.invalidateQueries({ queryKey: ['findings'] });
  };
  const assign = useMutation({ mutationFn: () => findingsService.assign(id, assignee), onSuccess: () => (toast.success('Owner assigned'), setDlg(null), refresh()) });
  const plan = useMutation({
    mutationFn: (v: z.infer<typeof actionSchema>) => findingsService.createAction(id, { ...v, rootCause: v.rootCause || null, immediateCorrection: v.immediateCorrection || null }),
    onSuccess: (ca) => {
      toast.success(`Corrective action ${ca.code} planned`);
      setDlg(null);
      refresh();
    },
  });
  const close = useMutation({ mutationFn: () => findingsService.close(id, closure.recommendation, closure.override || null), onSuccess: () => (toast.success('Finding verified and closed'), setDlg(null), refresh()) });
  const post = useMutation({ mutationFn: () => findingsService.comment(id, comment), onSuccess: () => (setComment(''), refresh()) });

  if (q.isLoading) return <Card><LoadingRows rows={8} /></Card>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const f = q.data!;
  const allVerified = f.actions.length > 0 && f.actions.every((a) => a.status === 'VERIFIED');
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ to: '/findings', label: 'Findings' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {f.title} <StatusBadge map={FINDING_STATUS} value={f.status} />
          </span>
        }
        description={`${f.code} · ${FINDING_CATEGORY[f.category]} · raised by ${f.raisedBy.name} on ${formatDate(f.createdAt)}`}
        actions={
          <>
            {f.actionsAllowed.edit && (
              <Button onClick={() => setDlg('edit')}>
                <Pencil /> Edit
              </Button>
            )}
            {f.actionsAllowed.assign && (
              <Button onClick={() => (setAssignee(f.ownerId ?? ''), setDlg('assign'))}>
                <UserPlus /> {f.owner ? 'Reassign' : 'Assign owner'}
              </Button>
            )}
            {f.actionsAllowed.planAction && (
              <Button variant="soft" onClick={() => setDlg('action')}>
                <Plus /> Plan corrective action
              </Button>
            )}
            {f.actionsAllowed.close && (
              <Button variant="primary" onClick={() => setDlg('close')}>
                <CheckCircle2 /> Verify & close
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card>
            <CardBody className="pt-5">
              <dl className="grid gap-5 sm:grid-cols-3">
                <KeyValue label="Severity">
                  <Badge tone={SEVERITY[f.severity]?.tone} dot>
                    {SEVERITY[f.severity]?.label}
                  </Badge>
                </KeyValue>
                <KeyValue label="Owner">{f.owner?.name ?? 'Unassigned'}</KeyValue>
                <KeyValue label="Due date">
                  <span className={cn(f.overdue && 'font-medium text-bad')}>
                    {formatDate(f.dueDate)}
                    {f.overdue && ' · overdue'}
                  </span>
                </KeyValue>
                <KeyValue label="Assessment">
                  <Link className="text-brand hover:underline" to={`/assessments/${f.assessment.id}`}>
                    {f.assessment.code}
                  </Link>{' '}
                  · {f.assessment.periodLabel}
                </KeyValue>
                <KeyValue label="Question" className="sm:col-span-2">
                  {f.item ? `${f.item.questionCode} – ${f.item.question}` : 'Assessment-level'}
                </KeyValue>
                <KeyValue label="Description" className="sm:col-span-3">
                  <span className="whitespace-pre-wrap">{f.description}</span>
                </KeyValue>
                {f.auditorComments && (
                  <KeyValue label="Auditor comments" className="sm:col-span-3">
                    {f.auditorComments}
                  </KeyValue>
                )}
                {f.closureRecommendation && (
                  <KeyValue label="Closure recommendation" className="sm:col-span-3">
                    {f.closureRecommendation}
                  </KeyValue>
                )}
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Corrective actions" description="The finding closes only after every action is verified by an authorised reviewer." />
            {!f.actions.length ? (
              <p className="px-5 pb-5 text-sm text-muted">No corrective action planned yet.</p>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Action</TH>
                    <TH>Owner</TH>
                    <TH>Target</TH>
                    <TH>Progress</TH>
                    <TH>Status</TH>
                  </tr>
                </THead>
                <tbody>
                  {f.actions.map((a) => (
                    <TR key={a.id} className="cursor-pointer hover:bg-subtle" onClick={() => navigate(`/corrective-actions/${a.id}`)}>
                      <TD className="max-w-md">
                        <p className="font-medium">{a.code}</p>
                        <p className="line-clamp-1 text-xs text-muted">{a.correctiveAction}</p>
                      </TD>
                      <TD className="text-[13px]">{a.owner.name}</TD>
                      <TD className="text-[13px]">{formatDate(a.targetDate)}</TD>
                      <TD className="min-w-[110px]">
                        <Progress value={a.progressPercent} tone={a.status === 'VERIFIED' ? 'ok' : 'brand'} />
                      </TD>
                      <TD>
                        <StatusBadge map={ACTION_STATUS} value={a.status} />
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader
              title="Finding evidence"
              actions={
                f.status !== 'CLOSED' &&
                can('evidence:create') && (
                  <Button size="sm" variant="soft" onClick={() => setDlg('upload')}>
                    <Upload /> Upload
                  </Button>
                )
              }
            />
            <CardBody>
              <EvidenceList items={f.evidence} onChanged={refresh} />
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Lifecycle" />
            <CardBody>
              <Timeline items={f.history.map((h) => ({ id: h.id, title: FINDING_STATUS[h.toStatus]?.label ?? h.toStatus, meta: h.actor?.name, body: h.reason, at: h.createdAt, tone: FINDING_STATUS[h.toStatus]?.tone }))} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Discussion" />
            <CardBody className="space-y-3">
              {f.comments.map((c) => (
                <div key={c.id} className="flex gap-2.5">
                  <Avatar name={c.author.name} size={28} />
                  <div className="min-w-0 flex-1 rounded-md bg-subtle px-3 py-2">
                    <p className="text-xs text-muted">
                      <span className="font-medium text-ink">{c.author.name}</span> · {formatDateTime(c.createdAt)}
                    </p>
                    <p className="whitespace-pre-wrap text-[13px]">{c.body}</p>
                  </div>
                </div>
              ))}
              <Textarea aria-label="Comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…" />
              <Button size="sm" disabled={!comment.trim()} loading={post.isPending} onClick={() => post.mutate()}>
                <MessageSquare /> Post
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>

      <Dialog open={dlg === 'assign'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent size="sm">
          <DialogHeader title="Assign finding owner" />
          <DialogBody>
            <Field label="Owner" required>
              <UserSelect value={assignee} onChange={setAssignee} roles={['IT_OWNER', 'CONTRIBUTOR']} siteId={f.site.id} departmentId={f.departmentId} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setDlg(null)}>Cancel</Button>
            <Button variant="primary" disabled={!assignee} loading={assign.isPending} onClick={() => assign.mutate()}>
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ActionFormDialog open={dlg === 'action'} onOpenChange={(o) => !o && setDlg(null)} title={`Plan corrective action for ${f.code}`} initial={{ ownerId: f.ownerId ?? '' }} siteId={f.site.id} departmentId={f.departmentId} onSubmit={(v) => plan.mutate(v)} submitting={plan.isPending} />
      <Dialog open={dlg === 'close'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader title={`Verify & close ${f.code}`} description={allVerified ? 'All corrective actions are verified.' : f.actions.length ? 'Some corrective actions are not yet verified — closing is blocked until they are.' : 'No corrective action exists. Closing requires an override reason (e.g. observation with no action required).'} />
          <DialogBody className="space-y-4">
            <Field label="Closure recommendation" required>
              <Textarea rows={3} value={closure.recommendation} onChange={(e) => setClosure((c) => ({ ...c, recommendation: e.target.value }))} />
            </Field>
            {!f.actions.length && (
              <Field label="Override reason" required hint="Recorded in the finding lifecycle and audit trail.">
                <Textarea rows={2} value={closure.override} onChange={(e) => setClosure((c) => ({ ...c, override: e.target.value }))} />
              </Field>
            )}
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setDlg(null)}>Cancel</Button>
            <Button variant="primary" disabled={closure.recommendation.trim().length < 5 || (f.actions.length > 0 && !allVerified) || (!f.actions.length && closure.override.trim().length < 3)} loading={close.isPending} onClick={() => close.mutate()}>
              Close finding
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <EditFindingDialog f={f} open={dlg === 'edit'} onOpenChange={(o) => !o && setDlg(null)} onSaved={refresh} />
      <UploadEvidenceDialog open={dlg === 'upload'} onOpenChange={(o) => !o && setDlg(null)} link={{ findingId: f.id }} onUploaded={refresh} />
    </div>
  );
}
