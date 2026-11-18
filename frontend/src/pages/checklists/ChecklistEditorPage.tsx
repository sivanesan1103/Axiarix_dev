import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, Archive, ArrowDown, ArrowUp, CheckCircle2, Download, Lock, MessageSquare, MoreHorizontal, Pencil, Plus, Send, Trash2, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { checklistsService, type MappingPayload } from '@/services/checklists.service';
import { useAuth } from '@/contexts/AuthContext';
import { errorDetails, errorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge, Card, Table, TD, TH, THead, TR } from '@/components/ui/display';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Field, Input, NativeSelect, Switch, Textarea } from '@/components/ui/form-controls';
import { ConfirmDialog, EmptyState, ErrorState, LoadingRows, PageHeader, SearchInput, StatusBadge } from '@/components/common';
import { UserSelect } from '@/components/common/pickers';
import { CHECKLIST_STATUS, PRIORITY } from '@/constants/status';
import { cn, formatDateTime } from '@/lib/utils';
import type { ChecklistItem, IsoReference } from '@/types/api';

const itemSchema = z.object({
  question: z.string().trim().min(3, 'Question is required'),
  description: z.string().max(4000).optional(),
  guidance: z.string().max(4000).optional(),
  internalPolicyRef: z.string().max(200).optional(),
  riskRef: z.string().max(200).optional(),
  evidenceRequirement: z.string().max(2000).optional(),
  evidenceMandatory: z.boolean(),
  responseMandatory: z.boolean(),
  defaultOwnerId: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  category: z.string().max(120).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});
type ItemForm = z.infer<typeof itemSchema>;

export function MappingChips({ mappings }: { mappings: ChecklistItem['mappings'] }) {
  if (!mappings.length) return <span className="text-xs text-faint">Not mapped</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {mappings.map((m) => (
        <span
          key={m.id ?? `${m.type}${m.reference}`}
          title={m.needsReview ? 'Imported mapping flagged for review' : m.title ?? undefined}
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
            m.type === 'ANNEX_A' ? 'bg-brand-soft text-brand-ink' : m.type === 'ISO_CLAUSE' ? 'bg-info-soft text-info' : 'bg-muted-bg text-ink-2',
            m.needsReview && 'ring-1 ring-warn',
          )}
        >
          {m.needsReview && <AlertTriangle className="size-3 text-warn" />}
          {m.type === 'ANNEX_A' ? 'A.' : m.type === 'ISO_CLAUSE' ? 'Cl. ' : m.type === 'RISK' ? 'Risk ' : 'Pol. '}
          {m.reference}
        </span>
      ))}
    </div>
  );
}

function MappingEditor({ value, onChange, refs }: { value: (MappingPayload & { needsReview?: boolean })[]; onChange: (v: (MappingPayload & { needsReview?: boolean })[]) => void; refs: IsoReference[] }) {
  const [type, setType] = useState<MappingPayload['type']>('ANNEX_A');
  const [ref, setRef] = useState('');
  const options = refs.filter((r) => (type === 'ANNEX_A' ? r.type === 'ANNEX_A' : r.type === 'CLAUSE'));
  const add = () => {
    const reference = ref.trim();
    if (!reference || value.some((v) => v.type === type && v.reference === reference)) return;
    const title = refs.find((r) => r.code === reference && (type === 'ANNEX_A' ? r.type === 'ANNEX_A' : r.type === 'CLAUSE'))?.title ?? null;
    onChange([...value, { type, reference, title }]);
    setRef('');
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {value.length ? (
          value.map((m) => (
            <span key={`${m.type}${m.reference}`} className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs', m.needsReview ? 'border-warn/50 bg-warn-soft' : 'border-line bg-subtle')}>
              {m.needsReview && <AlertTriangle className="size-3 text-warn" />}
              <span className="font-medium">{m.type === 'ANNEX_A' ? `A.${m.reference}` : m.type === 'ISO_CLAUSE' ? `Clause ${m.reference}` : `${m.type === 'RISK' ? 'Risk' : 'Policy'} ${m.reference}`}</span>
              {m.title && <span className="max-w-48 truncate text-muted">{m.title}</span>}
              <button type="button" aria-label={`Remove ${m.reference}`} onClick={() => onChange(value.filter((v) => v !== m))} className="text-muted hover:text-bad">
                <X className="size-3" />
              </button>
            </span>
          ))
        ) : (
          <span className="text-xs text-muted">No mappings</span>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
        <NativeSelect aria-label="Mapping type" value={type} onChange={(e) => (setType(e.target.value as MappingPayload['type']), setRef(''))}>
          <option value="ANNEX_A">Annex A control</option>
          <option value="ISO_CLAUSE">ISO clause</option>
          <option value="INTERNAL_POLICY">Internal policy</option>
          <option value="RISK">Risk reference</option>
        </NativeSelect>
        {type === 'ANNEX_A' || type === 'ISO_CLAUSE' ? (
          <NativeSelect aria-label="Reference" value={ref} onChange={(e) => setRef(e.target.value)}>
            <option value="">Select…</option>
            {options.map((o) => (
              <option key={o.id} value={o.code}>
                {type === 'ANNEX_A' ? 'A.' : ''}
                {o.code} – {o.title}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <Input aria-label="Reference" placeholder={type === 'RISK' ? 'e.g. RISK-012' : 'e.g. POL-IT-004'} value={ref} onChange={(e) => setRef(e.target.value)} />
        )}
        <Button type="button" variant="soft" onClick={add} disabled={!ref}>
          <Plus /> Add
        </Button>
      </div>
      <p className="text-xs text-muted">Applicability of Annex A controls is determined by the hospital's risk assessment and Statement of Applicability.</p>
    </div>
  );
}

function ItemDialog({ versionId, item, open, onOpenChange, refs, readOnly }: { versionId: string; item?: ChecklistItem; open: boolean; onOpenChange: (o: boolean) => void; refs: IsoReference[]; readOnly: boolean }) {
  const qc = useQueryClient();
  const initialMappings = useMemo<(MappingPayload & { needsReview?: boolean })[]>(() => item?.mappings.map((m) => ({ type: m.type, reference: m.reference, title: m.title, needsReview: m.needsReview })) ?? [], [item]);
  const [mappings, setMappings] = useState(initialMappings);
  const [prevItem, setPrevItem] = useState(item);
  if (prevItem !== item) {
    setPrevItem(item);
    setMappings(initialMappings);
  }
  const itemDefaults = (): ItemForm => ({
    question: item?.question ?? '',
    description: item?.description ?? '',
    guidance: item?.guidance ?? '',
    internalPolicyRef: item?.internalPolicyRef ?? '',
    riskRef: item?.riskRef ?? '',
    evidenceRequirement: item?.evidenceRequirement ?? '',
    evidenceMandatory: item?.evidenceMandatory ?? true,
    responseMandatory: item?.responseMandatory ?? true,
    defaultOwnerId: item?.defaultOwnerId ?? '',
    priority: item?.priority ?? 'MEDIUM',
    category: item?.category ?? '',
    status: item?.status ?? 'ACTIVE',
  });
  const form = useForm<ItemForm>({ resolver: zodResolver(itemSchema), defaultValues: itemDefaults() });
  // Every opening starts from the question being edited, or from a blank form for a new question
  // (previously "Add question" reopened with the last question's text and mappings).
  useEffect(() => {
    if (!open) return;
    form.reset(itemDefaults());
    setMappings(initialMappings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);
  const m = useMutation({
    mutationFn: async (v: ItemForm) => {
      const body = { ...v, defaultOwnerId: v.defaultOwnerId || null, description: v.description || null, guidance: v.guidance || null, internalPolicyRef: v.internalPolicyRef || null, riskRef: v.riskRef || null, evidenceRequirement: v.evidenceRequirement || null, category: v.category || null };
      const payload = mappings.map(({ type, reference, title }) => ({ type, reference, title }));
      if (!item) return checklistsService.addItem(versionId, { ...body, mappings: payload });
      await checklistsService.updateItem(item.id, body);
      const changed = JSON.stringify(initialMappings) !== JSON.stringify(mappings) || initialMappings.some((x) => x.needsReview);
      if (changed) await checklistsService.setMappings(item.id, payload);
    },
    onSuccess: () => {
      toast.success(item ? 'Question saved' : 'Question added');
      qc.invalidateQueries({ queryKey: ['version', versionId] });
      onOpenChange(false);
    },
    onError: (e) => {
      // Someone submitted or published this version while the dialog was open: refresh so the page shows the lock.
      toast.error(`${errorMessage(e)} The page has been refreshed to show the current state.`);
      qc.invalidateQueries({ queryKey: ['version', versionId] });
      onOpenChange(false);
    },
  });
  const flagged = mappings.some((x) => x.needsReview);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader title={readOnly ? `${item?.questionCode} (read-only)` : item ? `Edit ${item.questionCode}` : 'Add question'} description={readOnly ? 'This version is locked. Create a new version to make changes.' : undefined} />
        <form onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <fieldset disabled={readOnly}>
            <DialogBody className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-4">
                <Field label="Question" required error={form.formState.errors.question?.message} htmlFor="i-q">
                  <Textarea id="i-q" rows={3} {...form.register('question')} />
                </Field>
                <Field label="Description / explanation" htmlFor="i-d">
                  <Textarea id="i-d" rows={3} {...form.register('description')} />
                </Field>
                <Field label="Guidance for respondents" htmlFor="i-g">
                  <Textarea id="i-g" rows={2} {...form.register('guidance')} />
                </Field>
                <Field label="Evidence requirement" htmlFor="i-er">
                  <Textarea id="i-er" rows={2} {...form.register('evidenceRequirement')} />
                </Field>
                {(item?.isoClauseRaw || item?.annexControlRaw) && (
                  <div className="rounded-md bg-subtle px-3 py-2 text-xs text-ink-2">
                    <p className="font-medium">Original source values (preserved)</p>
                    <p>Clauses: {item.isoClauseRaw ?? '—'}</p>
                    <p>Controls (2022): {item.annexControlRaw ?? '—'}</p>
                  </div>
                )}
              </div>
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Priority" htmlFor="i-p">
                    <NativeSelect id="i-p" {...form.register('priority')}>
                      {Object.entries(PRIORITY).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Category" htmlFor="i-c">
                    <Input id="i-c" {...form.register('category')} />
                  </Field>
                  <Field label="Internal policy reference" htmlFor="i-pol">
                    <Input id="i-pol" {...form.register('internalPolicyRef')} />
                  </Field>
                  <Field label="Risk reference" htmlFor="i-risk">
                    <Input id="i-risk" {...form.register('riskRef')} />
                  </Field>
                  <Field label="Default owner" className="sm:col-span-2" htmlFor="i-owner">
                    <UserSelect id="i-owner" value={form.watch('defaultOwnerId') ?? ''} onChange={(v) => form.setValue('defaultOwnerId', v)} roles={['IT_OWNER', 'CONTRIBUTOR']} placeholder="Unassigned" />
                  </Field>
                </div>
                <div className="flex flex-wrap gap-6 rounded-md border border-line px-4 py-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={form.watch('responseMandatory')} onCheckedChange={(c) => form.setValue('responseMandatory', c)} disabled={readOnly} /> Answer mandatory
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={form.watch('evidenceMandatory')} onCheckedChange={(c) => form.setValue('evidenceMandatory', c)} disabled={readOnly} /> Evidence mandatory
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={form.watch('status') === 'ACTIVE'} onCheckedChange={(c) => form.setValue('status', c ? 'ACTIVE' : 'INACTIVE')} disabled={readOnly} /> Active
                  </label>
                </div>
                <div>
                  <p className="mb-2 text-[13px] font-medium text-ink-2">ISO / control mapping</p>
                  {flagged && !readOnly && (
                    <p className="mb-2 flex items-start gap-1.5 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Flagged mappings came from an ambiguous source column. Correct them if needed — saving confirms the mapping as reviewed.
                    </p>
                  )}
                  {readOnly ? <MappingChips mappings={item?.mappings ?? []} /> : <MappingEditor value={mappings} onChange={setMappings} refs={refs} />}
                </div>
              </div>
            </DialogBody>
          </fieldset>
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              {readOnly ? 'Close' : 'Cancel'}
            </Button>
            {!readOnly && (
              <Button type="submit" variant="primary" loading={m.isPending}>
                {item ? (flagged ? 'Save & confirm mapping' : 'Save') : 'Add question'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Everyone who can approve checklists (by permission, after personal restrictions), minus the author
 * and you. When nobody qualifies, the message says how to fix it instead of showing an empty list.
 */
function ReviewerSelect({ versionId, value, onChange }: { versionId: string; value: string; onChange: (v: string) => void }) {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['eligible-reviewers', versionId], queryFn: () => checklistsService.eligibleReviewers(versionId) });
  const people = q.data ?? [];
  return (
    <>
      <NativeSelect id="v-reviewer" value={value} onChange={(e) => onChange(e.target.value)} disabled={q.isLoading || !people.length}>
        <option value="">{q.isLoading ? 'Loading…' : people.length ? 'Choose a reviewer' : 'No eligible reviewer'}</option>
        {people.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
            {u.id === user?.id ? ' (you)' : ''} — {u.roles.join(', ')}
          </option>
        ))}
      </NativeSelect>
      {!q.isLoading && !people.length && (
        <p className="mt-2 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          Nobody other than the author can approve checklists in this organisation. An administrator can give someone the ISMS / Compliance Owner role (Users → Edit details &amp; roles), or add the checklist Approve permission to a role.
        </p>
      )}
    </>
  );
}

function CommentDialog({ versionId, item, onClose, onSaved }: { versionId: string; item: ChecklistItem | null | undefined; onClose: () => void; onSaved: () => void }) {
  const [body, setBody] = useState('');
  const save = useMutation({
    mutationFn: () => checklistsService.addReviewComment(versionId, body.trim(), item?.id ?? null),
    onSuccess: () => (toast.success('Comment added'), setBody(''), onSaved(), onClose()),
  });
  return (
    <Dialog open={item !== undefined} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader title={item ? `Comment on ${item.questionCode}` : 'Review comment'} description={item ? item.question : 'A general comment on this version.'} />
        <DialogBody>
          <Field label="Comment" required htmlFor="rc-body">
            <Textarea id="rc-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={body.trim().length < 2} loading={save.isPending} onClick={() => save.mutate()}>
            Add comment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ChecklistEditorPage() {
  const { id = '', versionId = '' } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  // A link from global search opens the editor filtered to that question.
  const [params] = useSearchParams();
  const [filters, setFilters] = useState({ search: params.get('search') ?? '', priority: '', clause: '', needsReview: '' });
  const q = useQuery({ queryKey: ['version', versionId, filters], queryFn: () => checklistsService.version(versionId, filters) });
  const refs = useQuery({ queryKey: ['iso-refs'], queryFn: checklistsService.isoReferences, staleTime: Infinity });
  const [dlg, setDlg] = useState<{ open: boolean; item?: ChecklistItem }>({ open: false });
  const [confirm, setConfirm] = useState<null | 'submit-review' | 'return-to-draft' | 'publish' | 'archive' | { delete: ChecklistItem }>(null);
  const [reviewerId, setReviewerId] = useState('');
  const [mappingIssues, setMappingIssues] = useState<{ questionCode: string; references: string[] }[] | null>(null);
  const [commentFor, setCommentFor] = useState<ChecklistItem | null | undefined>(undefined);
  const comments = useQuery({ queryKey: ['version-comments', versionId], queryFn: () => checklistsService.reviewComments(versionId), enabled: !!versionId });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['version', versionId] });
    qc.invalidateQueries({ queryKey: ['version-comments', versionId] });
    qc.invalidateQueries({ queryKey: ['checklist', id] });
  };
  const confirmMapping = useMutation({
    mutationFn: (item: ChecklistItem) => checklistsService.confirmMappings(item.id, 'Confirmed in review'),
    onSuccess: (_d, item) => (toast.success(`${item.questionCode}: mapping confirmed`), invalidate()),
  });
  const resolveComment = useMutation({ mutationFn: (cid: string) => checklistsService.resolveReviewComment(cid), onSuccess: invalidate });
  const reorder = useMutation({ mutationFn: (ids: string[]) => checklistsService.reorder(versionId, ids), onSuccess: invalidate });

  if (q.isLoading) return <Card><LoadingRows rows={10} /></Card>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const v = q.data!;
  const editable = v.status === 'DRAFT' && can('checklist:update');
  const filtered = Object.values(filters).some(Boolean);
  const move = (idx: number, dir: -1 | 1) => {
    const ids = v.items.map((i) => i.id);
    const [x] = ids.splice(idx, 1);
    ids.splice(idx + dir, 0, x);
    reorder.mutate(ids);
  };
  const clauses = ['4', '5', '6', '7', '8', '9', '10'];

  return (
    <div>
      <PageHeader
        back={{ to: `/checklists/${id}`, label: v.template.title }}
        title={
          <span className="flex items-center gap-3">
            Version {v.versionNumber} <StatusBadge map={CHECKLIST_STATUS} value={v.status} />
          </span>
        }
        description={v.changeSummary ?? undefined}
        actions={
          <>
            <Button onClick={() => checklistsService.exportVersion(versionId)}>
              <Download /> Export
            </Button>
            {v.status === 'DRAFT' && can('checklist:update') && (
              <Button variant="primary" onClick={() => (setReviewerId(''), setConfirm('submit-review'))}>
                <Send /> Submit for review
              </Button>
            )}
            {v.review.canReturn && (
              <Button onClick={() => setConfirm('return-to-draft')}>
                <Undo2 /> Return with comments
              </Button>
            )}
            {v.review.canPublish && (
              <Button
                variant="primary"
                disabled={v.flaggedCount > 0 || v.review.openComments > 0}
                title={v.flaggedCount > 0 ? 'Resolve every flagged mapping first' : v.review.openComments > 0 ? 'Resolve or return the open comments first' : undefined}
                onClick={() => setConfirm('publish')}
              >
                <CheckCircle2 /> Publish
              </Button>
            )}
            {v.status === 'PUBLISHED' && can('checklist:approve') && (
              <Button onClick={() => setConfirm('archive')}>
                <Archive /> Archive
              </Button>
            )}
          </>
        }
      />

      {v.status !== 'DRAFT' && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-subtle px-4 py-3 text-sm text-ink-2">
          <Lock className="size-4 text-muted" />
          {v.status === 'PUBLISHED' ? 'Published versions are immutable. Existing assessments keep this exact version.' : v.status === 'UNDER_REVIEW' ? 'Under review — editing is locked until it is returned to draft.' : 'Archived version (read-only).'}
        </div>
      )}
      {(v.status === 'UNDER_REVIEW' || v.review.submittedBy || (comments.data?.length ?? 0) > 0) && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-start justify-between gap-4 p-5">
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-muted">Author</dt><dd>{v.review.author?.name ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">Submitted by</dt><dd>{v.review.submittedBy?.name ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">Named reviewer</dt><dd className="font-medium">{v.review.reviewer?.name ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">Published by</dt><dd>{v.review.publishedBy?.name ?? '—'}</dd></div>
            </dl>
            {['DRAFT', 'UNDER_REVIEW'].includes(v.status) && can('checklist:update', 'checklist:review', 'checklist:approve') && (
              <Button size="sm" onClick={() => setCommentFor(null)}>
                <MessageSquare /> Add review comment
              </Button>
            )}
          </div>
          {v.review.blocked && (
            <p className="mx-5 mb-4 flex items-center gap-2 rounded-md bg-info-soft px-3 py-2 text-[13px] text-info">
              <Lock className="size-4" /> {v.review.blocked}
            </p>
          )}
          {v.status === 'UNDER_REVIEW' && v.review.canPublish && (v.flaggedCount > 0 || v.review.openComments > 0) && (
            <p className="mx-5 mb-4 flex items-center gap-2 rounded-md bg-warn-soft px-3 py-2 text-[13px] text-warn">
              <AlertTriangle className="size-4" /> Publishing stays disabled until {v.flaggedCount > 0 ? `${v.flaggedCount} flagged mapping(s) are confirmed` : ''}
              {v.flaggedCount > 0 && v.review.openComments > 0 ? ' and ' : ''}
              {v.review.openComments > 0 ? `${v.review.openComments} open comment(s) are resolved` : ''}.
            </p>
          )}
          {!!comments.data?.length && (
            <ul className="divide-y divide-line border-t border-line">
              {comments.data.map((c) => (
                <li key={c.id} className={cn('flex flex-wrap items-start gap-3 px-5 py-3', c.resolvedAt && 'opacity-60')}>
                  <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {c.item && <span className="mr-1.5 font-medium text-brand">{c.item.questionCode}</span>}
                      {c.body}
                    </p>
                    <p className="text-xs text-muted">
                      {c.author?.name} · {formatDateTime(c.createdAt)}
                      {c.resolvedAt && ` · resolved by ${c.resolvedBy?.name ?? '—'}`}
                    </p>
                  </div>
                  {c.canResolve && (
                    <Button size="sm" variant="ghost" loading={resolveComment.isPending && resolveComment.variables === c.id} onClick={() => resolveComment.mutate(c.id)}>
                      <CheckCircle2 /> Resolve
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {v.flaggedCount > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          <AlertTriangle className="size-4" />
          <span>
            <strong>{v.flaggedCount}</strong> question(s) have ISO mappings flagged during import. Each must be confirmed or corrected before publishing.
          </span>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setFilters((f) => ({ ...f, needsReview: f.needsReview ? '' : 'true' }))}>
            {filters.needsReview ? 'Show all' : 'Show flagged only'}
          </Button>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 p-5">
          <SearchInput value={filters.search} onChange={(s) => setFilters((f) => ({ ...f, search: s }))} placeholder="Search questions" className="w-full max-w-sm" />
          <NativeSelect aria-label="Priority" className="w-40" value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}>
            <option value="">Any priority</option>
            {Object.entries(PRIORITY).map(([k, p]) => (
              <option key={k} value={k}>
                {p.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Clause" className="w-40" value={filters.clause} onChange={(e) => setFilters((f) => ({ ...f, clause: e.target.value }))}>
            <option value="">Any clause</option>
            {clauses.map((c) => (
              <option key={c} value={c}>
                Clause {c}
              </option>
            ))}
          </NativeSelect>
          <span className="text-sm text-muted">{v.items.length} question(s)</span>
          {editable && (
            <Button variant="primary" className="ml-auto" onClick={() => setDlg({ open: true })}>
              <Plus /> Add question
            </Button>
          )}
        </div>
        {!v.items.length ? (
          <EmptyState title={filtered ? 'No questions match these filters' : 'No questions yet'} description={editable ? 'Add the first question to this draft.' : undefined} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH className="w-24">ID</TH>
                <TH>Question</TH>
                <TH>Mapping</TH>
                <TH>Priority</TH>
                <TH>Evidence</TH>
                <TH>Owner</TH>
                <TH className="w-28" />
              </tr>
            </THead>
            <tbody>
              {v.items.map((i, idx) => (
                <TR key={i.id} className={cn('hover:bg-subtle', i.status === 'INACTIVE' && 'opacity-50')}>
                  <TD className="text-[13px] font-medium text-muted">{i.questionCode}</TD>
                  <TD className="max-w-xl">
                    <button className="text-left hover:text-brand" onClick={() => setDlg({ open: true, item: i })}>
                      <p className="line-clamp-2 font-medium">{i.question}</p>
                    </button>
                    {i.description && <p className="line-clamp-1 text-xs text-muted">{i.description}</p>}
                  </TD>
                  <TD className="max-w-[240px]">
                    <MappingChips mappings={i.mappings} />
                    {v.review.canConfirmMappings && i.mappings.some((m) => m.needsReview) && (
                      <button className="mt-1 text-xs font-medium text-brand hover:underline" disabled={confirmMapping.isPending} onClick={() => confirmMapping.mutate(i)}>
                        Confirm as correct
                      </button>
                    )}
                  </TD>
                  <TD>
                    <Badge tone={PRIORITY[i.priority].tone}>{PRIORITY[i.priority].label}</Badge>
                  </TD>
                  <TD className="text-[13px]">{i.evidenceMandatory ? 'Required' : 'Optional'}</TD>
                  <TD className="text-[13px]">{i.defaultOwner?.name ?? <span className="text-faint">—</span>}</TD>
                  <TD className="text-right">
                    <div className="flex justify-end">
                      {editable && !filtered && (
                        <>
                          <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={idx === 0 || reorder.isPending} onClick={() => move(idx, -1)}>
                            <ArrowUp />
                          </Button>
                          <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={idx === v.items.length - 1 || reorder.isPending} onClick={() => move(idx, 1)}>
                            <ArrowDown />
                          </Button>
                        </>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${i.questionCode}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => setDlg({ open: true, item: i })}>
                            <Pencil /> {editable ? 'Edit question & mapping' : 'View details'}
                          </DropdownMenuItem>
                          {v.review.canConfirmMappings && i.mappings.some((m) => m.needsReview) && (
                            <DropdownMenuItem onSelect={() => confirmMapping.mutate(i)}>
                              <CheckCircle2 /> Confirm flagged mapping as correct
                            </DropdownMenuItem>
                          )}
                          {['DRAFT', 'UNDER_REVIEW'].includes(v.status) && can('checklist:update', 'checklist:review', 'checklist:approve') && (
                            <DropdownMenuItem onSelect={() => setCommentFor(i)}>
                              <MessageSquare /> Comment on this question
                            </DropdownMenuItem>
                          )}
                          {editable && (
                            <DropdownMenuItem destructive onSelect={() => setConfirm({ delete: i })}>
                              <Trash2 /> Delete draft question
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <ItemDialog versionId={versionId} item={dlg.item} open={dlg.open} onOpenChange={(o) => setDlg((s) => ({ ...s, open: o }))} refs={refs.data ?? []} readOnly={!editable} />

      <ConfirmDialog
        open={confirm === 'submit-review'}
        onOpenChange={() => setConfirm(null)}
        title="Submit for review"
        description="Editing is locked while the reviewer checks this version. One reviewer is needed: anyone with checklist approval rights (an administrator or ISMS owner) except the author of this version. If you did not write it, you can name yourself."
        confirmLabel="Submit"
        onConfirm={async () => {
          if (!reviewerId) throw new Error('Choose a reviewer.');
          await checklistsService.transition(versionId, 'submit-review', { reviewerId });
          toast.success('Submitted for review. The reviewer has been notified.');
          invalidate();
        }}
      >
        <Field label="Reviewer" required htmlFor="v-reviewer">
          <ReviewerSelect versionId={versionId} value={reviewerId} onChange={setReviewerId} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'return-to-draft'}
        onOpenChange={() => setConfirm(null)}
        title="Return to the author"
        description="The version goes back to draft with your open comments, and the author is notified."
        reasonLabel="Summary of what needs to change"
        confirmLabel="Return to draft"
        onConfirm={async (reason) => {
          await checklistsService.transition(versionId, 'return-to-draft', { reason });
          toast.success('Returned to draft');
          invalidate();
        }}
      />
      <ConfirmDialog
        open={confirm === 'publish'}
        onOpenChange={() => (setConfirm(null), setMappingIssues(null))}
        title={`Publish version ${v.versionNumber}?`}
        description="Published versions become immutable and available for new assessments. Any previously published version is archived."
        confirmLabel="Publish"
        onConfirm={async () => {
          try {
            await checklistsService.transition(versionId, 'publish');
          } catch (e) {
            const d = errorDetails<{ mappingReview?: { questionCode: string; references: string[] }[] }>(e);
            if (d?.mappingReview) setMappingIssues(d.mappingReview);
            throw new Error(errorMessage(e));
          }
          toast.success(`Version ${v.versionNumber} published`);
          invalidate();
        }}
      >
        {mappingIssues && <p className="text-xs text-muted">Still to resolve: {mappingIssues.map((m) => m.questionCode).join(', ')}</p>}
      </ConfirmDialog>
      <CommentDialog
        versionId={versionId}
        item={commentFor}
        onClose={() => setCommentFor(undefined)}
        onSaved={invalidate}
      />
      <ConfirmDialog
        open={confirm === 'archive'}
        onOpenChange={() => setConfirm(null)}
        title="Archive this version?"
        description="It will no longer be available for new assessments. Existing assessments and reports are unaffected."
        confirmLabel="Archive"
        reasonLabel="Reason"
        onConfirm={async (reason) => {
          await checklistsService.transition(versionId, 'archive', { reason });
          toast.success('Version archived');
          invalidate();
        }}
      />
      <ConfirmDialog
        open={typeof confirm === 'object' && confirm !== null}
        onOpenChange={() => setConfirm(null)}
        title={`Delete ${typeof confirm === 'object' && confirm ? confirm.delete.questionCode : ''}?`}
        description="Only draft questions can be deleted. This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          if (typeof confirm === 'object' && confirm) await checklistsService.deleteItem(confirm.delete.id);
          toast.success('Question deleted');
          invalidate();
        }}
      />
    </div>
  );
}
