import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, History, Lock, MessageSquare, Play, Save, Send, ShieldCheck, Siren, Upload, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { assessmentsService, type MissingItem } from '@/services/assessments.service';
import { errorDetails, errorMessage } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge, Card, Progress, Skeleton } from '@/components/ui/display';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/overlays';
import { Field, NativeSelect, Textarea } from '@/components/ui/form-controls';
import { ConfirmDialog, EmptyState, SodNotice, ErrorState, SearchInput, StatusBadge } from '@/components/common';
import { EvidenceList, UploadEvidenceDialog } from '@/components/evidence/EvidenceList';
import { FindingDialog } from '@/components/findings/FindingDialog';
import { MappingChips } from '@/pages/checklists/ChecklistEditorPage';
import { ASSESSMENT_STATUS, PRIORITY, RESPONSE_STATUS, SEVERITY, FINDING_STATUS } from '@/constants/status';
import { cn, formatDate, formatDateTime, humanize, relativeTime } from '@/lib/utils';
import type { AssessmentDetail, ItemDetail, ResponseStatus, WorkspaceItem } from '@/types/api';

type Mode = 'respond' | 'review';

const STATUS_ORDER: ResponseStatus[] = ['COMPLIANT', 'PARTIALLY_COMPLIANT', 'NON_COMPLIANT', 'NOT_APPLICABLE', 'NOT_ASSESSED'];

/** Source-workbook columns that carry earlier audit observations, shown to both IT and auditors. */
const OBSERVATION_KEYS = /strength|opportunit|observation|remark|evidence available|available evidence|evidence shown|evidences availability/i;

function PreviousObservations({ item }: { item: ItemDetail }) {
  const [open, setOpen] = useState(true);
  if (!item.sourceRow) return null;
  const entries = Object.entries(item.sourceRow.rawData).filter(([k, v]) => v && OBSERVATION_KEYS.test(k));
  if (!entries.length) return null;
  return (
    <div className="rounded-lg border border-line">
      <button className="flex w-full items-center gap-2 px-4 py-3 text-left" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <span className="text-sm font-semibold">Previous audit observations</span>
        <span className="ml-auto text-xs text-muted">
          Source: “{item.sourceRow.sheetName}”, row {item.sourceRow.rowNumber}
        </span>
      </button>
      {open && (
        <dl className="grid gap-3 border-t border-line px-4 py-3 sm:grid-cols-2">
          {entries.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="whitespace-pre-wrap text-[13px] text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function ResponseForm({ a, item, editable, lockedReason, onSaved }: { a: AssessmentDetail; item: ItemDetail; editable: boolean; lockedReason: string | null; onSaved: () => void }) {
  const [status, setStatus] = useState<ResponseStatus>(item.response?.status ?? 'NOT_ASSESSED');
  const [comment, setComment] = useState(item.response?.comment ?? '');
  const [justification, setJustification] = useState(item.response?.justification ?? '');
  useEffect(() => {
    setStatus(item.response?.status ?? 'NOT_ASSESSED');
    setComment(item.response?.comment ?? '');
    setJustification(item.response?.justification ?? '');
  }, [item.id, item.response]);
  const dirty = status !== (item.response?.status ?? 'NOT_ASSESSED') || comment !== (item.response?.comment ?? '') || justification !== (item.response?.justification ?? '');
  // Warn before leaving with unsaved answers (SRS §10).
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  const m = useMutation({
    mutationFn: () => assessmentsService.saveResponse(a.id, item.id, { status, comment: comment || null, justification: justification || null }),
    onSuccess: () => {
      toast.success(`${item.questionCode} saved`);
      onSaved();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const naMissing = status === 'NOT_APPLICABLE' && !justification.trim();
  return (
    <div className="space-y-4">
      {lockedReason && (
        <p className="flex items-center gap-2 rounded-md bg-subtle px-3 py-2 text-[13px] text-ink-2">
          <Lock className="size-4 text-muted" /> {lockedReason}
        </p>
      )}
      <div role="radiogroup" aria-label="Compliance status" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={status === s}
            disabled={!editable}
            onClick={() => setStatus(s)}
            className={cn(
              'flex items-center gap-2 rounded-md border px-3 py-2.5 text-left text-[13px] font-medium transition-colors disabled:cursor-not-allowed',
              status === s ? 'border-brand bg-brand-soft text-brand-ink ring-1 ring-brand' : 'border-line hover:bg-subtle disabled:hover:bg-surface',
            )}
          >
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: RESPONSE_STATUS[s].color }} />
            {RESPONSE_STATUS[s].label}
          </button>
        ))}
      </div>
      <Field label="Comments" htmlFor="r-comment">
        <Textarea id="r-comment" rows={3} disabled={!editable} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Describe how the control is implemented and where the evidence is." />
      </Field>
      <Field label="Justification" required={status === 'NOT_APPLICABLE'} error={naMissing ? 'Required for Not Applicable' : undefined} hint="Required when marking Not Applicable; reference the SoA decision." htmlFor="r-just">
        <Textarea id="r-just" rows={2} disabled={!editable} value={justification} onChange={(e) => setJustification(e.target.value)} />
      </Field>
      {editable && (
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={!dirty || naMissing} loading={m.isPending} onClick={() => m.mutate()}>
            <Save /> Save answer
          </Button>
          {dirty && <span className="text-xs text-warn">Unsaved changes</span>}
          {item.response?.responder && !dirty && (
            <span className="text-xs text-muted">
              Last saved by {item.response.responder.name} · {relativeTime(item.response.updatedAt)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ReviewDecision({ a, item, evidenceId, onDone }: { a: AssessmentDetail; item: ItemDetail; evidenceId?: string; onDone: () => void }) {
  const [mode, setMode] = useState<null | 'REJECTED' | 'CLARIFICATION_REQUESTED'>(null);
  const accept = useMutation({
    mutationFn: () => assessmentsService.reviewItem(a.id, item.id, { decision: 'ACCEPTED', evidenceId }),
    onSuccess: () => (toast.success('Evidence accepted'), onDone()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="soft" loading={accept.isPending} onClick={() => accept.mutate()}>
        <CheckCircle2 /> Accept
      </Button>
      <Button size="sm" variant="danger-outline" onClick={() => setMode('REJECTED')}>
        <XCircle /> Reject
      </Button>
      <ConfirmDialog
        open={!!mode}
        onOpenChange={() => setMode(null)}
        title={mode === 'REJECTED' ? 'Reject evidence' : 'Request clarification'}
        description="The question owner is notified. The reason is recorded with your decision."
        reasonLabel={mode === 'REJECTED' ? 'Reason for rejection' : 'What needs clarifying?'}
        tone="danger"
        confirmLabel={mode === 'REJECTED' ? 'Reject' : 'Request'}
        onConfirm={async (reason) => {
          await assessmentsService.reviewItem(a.id, item.id, { decision: mode!, evidenceId, reason });
          toast.success(mode === 'REJECTED' ? 'Evidence rejected' : 'Clarification requested');
          onDone();
        }}
      />
    </div>
  );
}

function Thread({ a, item, onPosted }: { a: AssessmentDetail; item: ItemDetail; onPosted: () => void }) {
  const [body, setBody] = useState('');
  const m = useMutation({
    mutationFn: () => assessmentsService.comment(a.id, item.id, body),
    onSuccess: () => {
      setBody('');
      onPosted();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const timeline = [
    ...item.reviews.filter((r) => r.decision !== 'REVIEW_SUBMITTED').map((r) => ({ id: r.id, at: r.createdAt, who: r.auditor.name, kind: r.decision, text: r.reason || r.comments || '', round: r.round, resolved: !!r.resolvedAt })),
    ...item.comments.map((c) => ({ id: c.id, at: c.createdAt, who: c.author.name, kind: 'COMMENT_THREAD' as const, text: c.body, round: 0, resolved: false })),
  ].sort((x, y) => x.at.localeCompare(y.at));
  const label: Record<string, { t: string; tone: 'ok' | 'bad' | 'warn' | 'neutral' }> = {
    ACCEPTED: { t: 'Accepted evidence', tone: 'ok' },
    REJECTED: { t: 'Rejected evidence', tone: 'bad' },
    CLARIFICATION_REQUESTED: { t: 'Requested clarification', tone: 'warn' },
    COMMENT: { t: 'Auditor comment', tone: 'neutral' },
  };
  return (
    <div className="space-y-3">
      {!timeline.length && <p className="text-sm text-muted">No review comments yet.</p>}
      {timeline.map((t) => (
        <div key={t.id} className="rounded-md border border-line px-3 py-2.5">
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="font-medium text-ink">{t.who}</span>
            {t.kind !== 'COMMENT_THREAD' && <Badge tone={label[t.kind]?.tone}>{label[t.kind]?.t}</Badge>}
            {t.round > 0 && <span>round {t.round}</span>}
            {t.resolved && <Badge tone="ok">Resolved</Badge>}
            <span className="ml-auto">{formatDateTime(t.at)}</span>
          </p>
          {t.text && <p className="mt-1 whitespace-pre-wrap text-[13px]">{t.text}</p>}
        </div>
      ))}
      <div className="flex gap-2">
        <Textarea aria-label="Reply" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Reply or add a clarification note…" />
        <Button className="self-end" disabled={!body.trim()} loading={m.isPending} onClick={() => m.mutate()}>
          <MessageSquare /> Post
        </Button>
      </div>
    </div>
  );
}

function ItemPanel({ a, itemId, mode, onChanged }: { a: AssessmentDetail; itemId: string; mode: Mode; onChanged: () => void }) {
  const { user, hasRole } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['assessment-item', a.id, itemId], queryFn: () => assessmentsService.item(a.id, itemId) });
  const [upload, setUpload] = useState(false);
  const [finding, setFinding] = useState(false);
  const [clarify, setClarify] = useState(false);
  const [comment, setComment] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['assessment-item', a.id, itemId] });
    onChanged();
  };
  const acceptAnswer = useMutation({
    mutationFn: () => assessmentsService.reviewItem(a.id, itemId, { decision: 'ACCEPTED' }),
    onSuccess: () => (toast.success('Answer accepted'), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading)
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const item = q.data!;
  const isOwnerish = a.ownerId === user?.id || hasRole('IT_OWNER', 'SYSTEM_ADMIN');
  const assignedToMe = item.assignment?.assigneeId === user?.id;
  const statusEditable = a.actions.respond && (a.status !== 'CLARIFICATION_REQUIRED' || item.clarificationOpen);
  const editable = mode === 'respond' && statusEditable && (isOwnerish || assignedToMe);
  const lockedReason =
    mode !== 'respond'
      ? null
      : !a.actions.respond
        ? `This assessment is ${ASSESSMENT_STATUS[a.status]?.label.toLowerCase()} and read-only. Changes require a formal reopen.`
        : a.status === 'CLARIFICATION_REQUIRED' && !item.clarificationOpen
          ? 'Only questions with an open clarification request can change during clarification.'
          : !isOwnerish && !assignedToMe
            ? 'This question is not assigned to you.'
            : null;
  const reviewing = mode === 'review' && a.actions.review;

  return (
    <div className="space-y-6 p-6">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone="brand">{item.questionCode}</Badge>
          <Badge tone={PRIORITY[item.priority].tone}>{PRIORITY[item.priority].label} priority</Badge>
          {item.evidenceMandatory && <Badge>Evidence required</Badge>}
          {item.clarificationOpen && (
            <Badge tone="warn">
              <AlertTriangle className="size-3" /> Clarification open
            </Badge>
          )}
          {item.assignment && <span className="text-xs text-muted">Assigned to {item.assignment.assignee.name}{item.assignment.dueDate ? ` · due ${formatDate(item.assignment.dueDate)}` : ''}</span>}
        </div>
        <h2 className="text-[19px] font-semibold leading-snug tracking-[-0.01em]">{item.question}</h2>
        {item.description && <p className="mt-2 text-sm text-ink-2">{item.description}</p>}
        {item.guidance && <p className="mt-2 rounded-md bg-info-soft px-3 py-2 text-[13px] text-info">Guidance: {item.guidance}</p>}
        {item.evidenceRequirement && (
          <p className="mt-2 rounded-md border border-line bg-subtle px-3 py-2 text-[13px] text-ink-2">
            <span className="font-medium text-ink">Evidence expected{item.evidenceMandatory ? ' (required)' : ' (optional)'}:</span> {item.evidenceRequirement}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <MappingChips mappings={item.mappings} />
          {item.internalPolicyRef && <Badge>Policy {item.internalPolicyRef}</Badge>}
          {item.riskRef && <Badge>Risk {item.riskRef}</Badge>}
        </div>
      </div>

      <PreviousObservations item={item} />

      <section>
        <h3 className="mb-3 text-sm font-semibold">Response</h3>
        <ResponseForm a={a} item={item} editable={editable} lockedReason={lockedReason} onSaved={refresh} />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Evidence <span className="font-normal text-muted">({item.evidence.length})</span>
          </h3>
          {editable && (
            <Button size="sm" variant="soft" onClick={() => setUpload(true)}>
              <Upload /> Upload evidence
            </Button>
          )}
        </div>
        <EvidenceList
          items={item.evidence}
          canVersion={editable}
          onChanged={refresh}
          renderActions={reviewing ? (e) => (e.versions[0]?.scanStatus === 'CLEAN' && e.verificationStatus !== 'ACCEPTED' ? <ReviewDecision a={a} item={item} evidenceId={e.id} onDone={refresh} /> : null) : undefined}
        />
      </section>

      {reviewing && (
        <section className="flex flex-wrap gap-2 rounded-lg border border-brand/20 bg-brand-soft/50 p-4">
          <p className="w-full text-sm font-semibold text-brand-ink">Auditor actions for this question</p>
          <Button size="sm" variant="soft" onClick={() => acceptAnswer.mutate()} loading={acceptAnswer.isPending}>
            <CheckCircle2 /> Accept answer{item.response?.status === 'NOT_APPLICABLE' ? ' (N/A justification)' : ''}
          </Button>
          <Button size="sm" onClick={() => setClarify(true)}>
            <AlertTriangle /> Request clarification
          </Button>
          <Button size="sm" onClick={() => setComment(true)}>
            <MessageSquare /> Add comment
          </Button>
          <Button size="sm" variant="primary" onClick={() => setFinding(true)}>
            <Siren /> Raise finding
          </Button>
        </section>
      )}

      {item.findings.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Findings</h3>
          <ul className="space-y-1.5">
            {item.findings.map((f) => (
              <li key={f.id}>
                <Link to={`/findings/${f.id}`} className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm hover:bg-subtle">
                  <Badge tone={SEVERITY[f.severity]?.tone}>{SEVERITY[f.severity]?.label}</Badge>
                  <span className="font-medium">{f.code}</span>
                  <span className="truncate text-muted">{f.title}</span>
                  <span className="ml-auto">
                    <StatusBadge map={FINDING_STATUS} value={f.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-3 text-sm font-semibold">Review & clarification thread</h3>
        <Thread a={a} item={item} onPosted={refresh} />
      </section>

      {item.responseHistory.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <History className="size-4" /> Answer history
          </h3>
          <ul className="space-y-1 text-xs text-muted">
            {item.responseHistory.map((h) => (
              <li key={h.id}>
                {formatDateTime(h.createdAt)} · {h.actorEmail}: {humanize(h.metadata.from ?? 'NOT_ASSESSED')} → {humanize(h.metadata.to)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <UploadEvidenceDialog open={upload} onOpenChange={setUpload} link={{ assessmentId: a.id, itemId: item.id }} onUploaded={refresh} />
      <FindingDialog open={finding} onOpenChange={setFinding} assessmentId={a.id} itemId={item.id} itemLabel={`${item.questionCode} – ${item.question.slice(0, 80)}`} siteId={a.site.id} defaultOwnerId={item.assignment?.assigneeId} />
      <ConfirmDialog
        open={clarify}
        onOpenChange={setClarify}
        title="Request clarification"
        description="The department must respond before you can complete the review."
        reasonLabel="What needs clarifying?"
        confirmLabel="Request"
        onConfirm={async (reason) => {
          await assessmentsService.reviewItem(a.id, item.id, { decision: 'CLARIFICATION_REQUESTED', reason });
          toast.success('Clarification requested');
          refresh();
        }}
      />
      <ConfirmDialog
        open={comment}
        onOpenChange={setComment}
        title="Add auditor comment"
        reasonLabel="Comment"
        reasonMin={1}
        confirmLabel="Add"
        onConfirm={async (text) => {
          await assessmentsService.reviewItem(a.id, item.id, { decision: 'COMMENT', comments: text });
          refresh();
        }}
      />
    </div>
  );
}

function QuestionList({ items, selected, onSelect, mode }: { items: WorkspaceItem[]; selected: string | null; onSelect: (id: string) => void; mode: Mode }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((i) => {
        const s = i.response?.status ?? 'NOT_ASSESSED';
        const ev = i.evidence.length;
        const reviewed = i.latestReview?.decision;
        return (
          <li key={i.id}>
            <button onClick={() => onSelect(i.id)} className={cn('flex w-full gap-3 px-4 py-3 text-left transition-colors', selected === i.id ? 'bg-brand-soft' : 'hover:bg-subtle')}>
              <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: RESPONSE_STATUS[s].color }} title={RESPONSE_STATUS[s].label} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <span className="font-medium text-ink-2">{i.questionCode}</span>
                  {i.clarificationOpen && <AlertTriangle className="size-3 text-warn" />}
                  {ev > 0 && <span>· {ev} file(s)</span>}
                  {mode === 'review' && reviewed && <span className={cn(reviewed === 'ACCEPTED' ? 'text-ok' : reviewed === 'REJECTED' ? 'text-bad' : 'text-warn')}>· {humanize(reviewed)}</span>}
                </span>
                <span className={cn('line-clamp-2 text-[13px]', selected === i.id ? 'font-medium text-brand-ink' : 'text-ink')}>{i.question}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SubmitDialog({ a, open, onOpenChange, onDone }: { a: AssessmentDetail; open: boolean; onOpenChange: (o: boolean) => void; onDone: (focus?: string) => void }) {
  const v = useQuery({ queryKey: ['validation', a.id], queryFn: () => assessmentsService.validation(a.id), enabled: open });
  const [missing, setMissing] = useState<MissingItem[] | null>(null);
  const m = useMutation({
    mutationFn: () => assessmentsService.submit(a.id),
    onSuccess: () => {
      toast.success(a.status === 'CLARIFICATION_REQUIRED' ? 'Re-submitted to the auditor' : 'Submitted for audit');
      onOpenChange(false);
      onDone();
    },
    onError: (e) => {
      const d = errorDetails<{ missing?: MissingItem[] }>(e);
      if (d?.missing) setMissing(d.missing);
      else toast.error(errorMessage(e));
    },
  });
  const list = missing ?? v.data?.missing ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader title={a.status === 'CLARIFICATION_REQUIRED' ? 'Re-submit after clarification' : 'Submit for audit'} description="After submission the assessment is read-only for contributors. Changes then require a formal reopen." />
        <DialogBody>
          {v.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : list.length ? (
            <div>
              <p className="mb-3 flex items-center gap-2 text-sm font-medium text-bad">
                <XCircle className="size-4" /> {list.length} question(s) are incomplete
              </p>
              <ul className="max-h-80 space-y-1.5 overflow-y-auto scrollbar-thin">
                {list.map((x) => (
                  <li key={x.itemId}>
                    <button className="w-full rounded-md border border-line px-3 py-2 text-left hover:bg-subtle" onClick={() => (onOpenChange(false), onDone(x.itemId))}>
                      <span className="text-sm font-medium">{x.questionCode}</span> <span className="text-[13px] text-muted">{x.question.slice(0, 90)}</span>
                      <span className="mt-0.5 block text-xs text-bad">{x.problems.join(' · ')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="flex items-center gap-2 rounded-md bg-ok-soft px-3 py-3 text-sm text-ok">
              <CheckCircle2 className="size-4" /> All mandatory answers, justifications and evidence are complete.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={v.isLoading || list.length > 0} loading={m.isPending} onClick={() => m.mutate()}>
            <Send /> Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Workspace({ mode }: { mode: Mode }) {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const a = useQuery({ queryKey: ['assessment', id], queryFn: () => assessmentsService.get(id) });
  const [filter, setFilter] = useState({ search: '', status: '', assignee: '', flagged: '' });
  const items = useQuery({ queryKey: ['assessment-items', id, filter], queryFn: () => assessmentsService.items(id, filter), enabled: !!a.data });
  const selected = params.get('item') ?? items.data?.[0]?.id ?? null;
  const [submit, setSubmit] = useState(false);
  const [finishReview, setFinishReview] = useState(false);
  const [assessmentFinding, setAssessmentFinding] = useState(false);
  const [opinion, setOpinion] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['assessment', id] });
    qc.invalidateQueries({ queryKey: ['assessment-items', id] });
    qc.invalidateQueries({ queryKey: ['validation', id] });
  };
  const startReview = useMutation({ mutationFn: () => assessmentsService.startReview(id), onSuccess: () => (toast.success('Review started'), refresh()) });
  const review = useMutation({
    mutationFn: () => assessmentsService.submitReview(id, opinion),
    onSuccess: () => {
      toast.success('Review submitted');
      setFinishReview(false);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const counts = useMemo(() => {
    const all = items.data ?? [];
    return { answered: all.filter((i) => (i.response?.status ?? 'NOT_ASSESSED') !== 'NOT_ASSESSED').length, total: all.length };
  }, [items.data]);

  if (a.isLoading) return <Card className="p-6"><Skeleton className="h-96 w-full" /></Card>;
  if (a.isError) return <ErrorState error={a.error} onRetry={() => a.refetch()} />;
  const as = a.data!;
  const m = as.metrics;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link to={mode === 'review' ? '/auditor' : '/my-assessments'} className="text-[13px] text-muted hover:text-ink">
            ← {mode === 'review' ? 'Auditor workspace' : 'My assessments'}
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-[22px] font-semibold tracking-[-0.02em]">
            {as.title} <StatusBadge map={ASSESSMENT_STATUS} value={as.status} />
          </h1>
          <p className="text-sm text-muted">
            {as.code} · {as.site.name} / {as.department.name} · {as.periodLabel} · due {formatDate(as.dueDate)} · round {as.round}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2 w-48">
            <div className="mb-1 flex justify-between text-xs text-muted">
              <span>
                {m.totalItems - m.counts.NOT_ASSESSED}/{m.totalItems} answered
              </span>
              <span>{m.evidenceCoverage.attached} evidenced</span>
            </div>
            <Progress value={m.completionPercent} />
          </div>
          {mode === 'respond' && as.actions.submit && (
            <Button variant="primary" onClick={() => setSubmit(true)}>
              <Send /> {as.status === 'CLARIFICATION_REQUIRED' ? 'Re-submit' : 'Submit for audit'}
            </Button>
          )}
          {mode === 'review' && as.actions.startReview && (
            <Button variant="primary" loading={startReview.isPending} onClick={() => startReview.mutate()}>
              <Play /> Start review
            </Button>
          )}
          {mode === 'review' && as.actions.review && (
            <>
              <Button onClick={() => setAssessmentFinding(true)}>
                <Siren /> Assessment-level finding
              </Button>
              <Button variant="primary" onClick={() => setFinishReview(true)}>
                <ShieldCheck /> Submit review
              </Button>
            </>
          )}
        </div>
      </div>

      {mode === 'review' && <SodNotice messages={[as.actions.blocked?.review]} />}
      {as.status === 'CLARIFICATION_REQUIRED' && (
        <div className="flex items-center gap-2 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          <AlertTriangle className="size-4" /> The auditor requested clarification on {as.openClarificationCount} question(s). Respond, update evidence, then re-submit.
          <button className="ml-auto font-medium underline" onClick={() => setFilter((f) => ({ ...f, flagged: f.flagged ? '' : 'true' }))}>
            {filter.flagged ? 'Show all' : 'Show flagged'}
          </button>
        </div>
      )}

      <Card className="grid min-h-[70vh] overflow-hidden lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex max-h-[calc(100vh-260px)] flex-col border-b border-line lg:border-b-0 lg:border-r">
          <div className="space-y-2 border-b border-line p-3">
            <SearchInput value={filter.search} onChange={(v) => setFilter((f) => ({ ...f, search: v }))} placeholder="Search questions" />
            <div className="grid grid-cols-2 gap-2">
              <NativeSelect aria-label="Answer filter" className="h-9 text-[13px]" value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}>
                <option value="">Any answer</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {RESPONSE_STATUS[s].label}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect aria-label="Assignment filter" className="h-9 text-[13px]" value={filter.assignee} onChange={(e) => setFilter((f) => ({ ...f, assignee: e.target.value }))}>
                <option value="">Everyone</option>
                <option value="me">Assigned to me</option>
                <option value="unassigned">Unassigned</option>
              </NativeSelect>
            </div>
            <p className="text-xs text-muted">
              Showing {items.data?.length ?? 0} · {counts.answered} answered
            </p>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {items.isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : items.isError ? (
              <ErrorState error={items.error} onRetry={() => items.refetch()} />
            ) : !items.data?.length ? (
              <EmptyState title="No questions match" />
            ) : (
              <QuestionList items={items.data} selected={selected} mode={mode} onSelect={(itemId) => setParams({ item: itemId }, { replace: true })} />
            )}
          </div>
        </aside>
        <section className="max-h-[calc(100vh-260px)] overflow-y-auto scrollbar-thin">
          {selected ? <ItemPanel key={selected} a={as} itemId={selected} mode={mode} onChanged={refresh} /> : <EmptyState title="Select a question" />}
        </section>
      </Card>

      <SubmitDialog a={as} open={submit} onOpenChange={setSubmit} onDone={(focus) => (refresh(), focus && setParams({ item: focus }))} />
      <FindingDialog open={assessmentFinding} onOpenChange={setAssessmentFinding} assessmentId={as.id} siteId={as.site.id} />
      <Dialog open={finishReview} onOpenChange={setFinishReview}>
        <DialogContent>
          <DialogHeader title="Submit audit review" description={as.openClarificationCount ? `${as.openClarificationCount} question(s) have open rejections or clarification requests — the assessment will go back to the department.` : as.approvalRequired ? 'The assessment will move to Pending approval.' : 'The assessment will be marked Reviewed and can be finalised.'} />
          <DialogBody>
            <Field label="Overall audit opinion" required hint="Printed in the final report." htmlFor="opinion">
              <Textarea id="opinion" rows={5} value={opinion} onChange={(e) => setOpinion(e.target.value)} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setFinishReview(false)}>Cancel</Button>
            <Button variant="primary" disabled={opinion.trim().length < 5} loading={review.isPending} onClick={() => review.mutate()}>
              Submit review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function WorkspacePage() {
  return <Workspace mode="respond" />;
}

export function AuditorReviewPage() {
  return <Workspace mode="review" />;
}
