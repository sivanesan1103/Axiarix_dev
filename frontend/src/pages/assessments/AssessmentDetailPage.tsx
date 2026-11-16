import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardCheck, Download, FileText, RotateCcw, Send, ShieldCheck, UserPlus, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { assessmentsService } from '@/services/assessments.service';
import { reportsService } from '@/services/reports.service';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, Table, TD, TH, THead, TR, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/display';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Checkbox, Field, Input, NativeSelect } from '@/components/ui/form-controls';
import { ConfirmDialog, EmptyState, SodNotice, ErrorState, KeyValue, LoadingRows, PageHeader, StatusBadge, Timeline } from '@/components/common';
import { UserSelect } from '@/components/common/pickers';
import { ClauseBreakdown, LifecycleStepper, MetricsStrip } from '@/components/assessment/Lifecycle';
import { MappingChips } from '@/pages/checklists/ChecklistEditorPage';
import { ASSESSMENT_STATUS, RESPONSE_STATUS } from '@/constants/status';
import { formatDate, formatDateTime } from '@/lib/utils';
import type { AssessmentDetail } from '@/types/api';

function AssignDialog({ a, itemIds, open, onOpenChange, onDone }: { a: AssessmentDetail; itemIds: string[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const m = useMutation({
    mutationFn: () => assessmentsService.assign(a.id, itemIds, assignee, due || null),
    onSuccess: () => {
      toast.success(`${itemIds.length} question(s) assigned`);
      onDone();
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title={`Assign ${itemIds.length} question(s)`} description="The assignee is notified and can answer and attach evidence for these questions." />
        <DialogBody className="space-y-4">
          <Field label="Assignee" required htmlFor="as-user">
            <UserSelect id="as-user" value={assignee} onChange={setAssignee} roles={['IT_OWNER', 'CONTRIBUTOR']} siteId={a.site.id} />
          </Field>
          <Field label="Due date (optional)" hint={`Defaults to the assessment due date (${formatDate(a.dueDate)}).`} htmlFor="as-due">
            <Input id="as-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!assignee} loading={m.isPending} onClick={() => m.mutate()}>
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuestionsTab({ a }: { a: AssessmentDetail }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState({ assignee: '', status: '' });
  const items = useQuery({ queryKey: ['assessment-items', a.id, filter], queryFn: () => assessmentsService.items(a.id, filter) });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const refresh = () => {
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ['assessment-items', a.id] });
    qc.invalidateQueries({ queryKey: ['assessment', a.id] });
  };
  const unassign = useMutation({ mutationFn: () => assessmentsService.unassign(a.id, [...selected]), onSuccess: () => (toast.success('Unassigned'), refresh()) });
  const rows = items.data ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 p-5">
        <NativeSelect aria-label="Assignee filter" className="w-52" value={filter.assignee} onChange={(e) => setFilter((f) => ({ ...f, assignee: e.target.value }))}>
          <option value="">All questions</option>
          <option value="unassigned">Unassigned</option>
          <option value="me">Assigned to me</option>
        </NativeSelect>
        <NativeSelect aria-label="Response filter" className="w-52" value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}>
          <option value="">Any answer</option>
          {Object.entries(RESPONSE_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </NativeSelect>
        {a.actions.assign && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-muted">{selected.size} selected</span>
            <Button size="sm" disabled={!selected.size} loading={unassign.isPending} onClick={() => unassign.mutate()}>
              Unassign
            </Button>
            <Button size="sm" variant="primary" disabled={!selected.size} onClick={() => setAssignOpen(true)}>
              <UserPlus /> Assign / reassign
            </Button>
          </div>
        )}
      </div>
      {items.isLoading ? (
        <LoadingRows />
      ) : items.isError ? (
        <ErrorState error={items.error} onRetry={() => items.refetch()} />
      ) : !rows.length ? (
        <EmptyState title="No questions match" />
      ) : (
        <Table>
          <THead>
            <tr>
              {a.actions.assign && (
                <TH className="w-10">
                  <Checkbox aria-label="Select all" checked={allSelected} onCheckedChange={(c) => setSelected(c ? new Set(rows.map((r) => r.id)) : new Set())} />
                </TH>
              )}
              <TH className="w-24">ID</TH>
              <TH>Question</TH>
              <TH>Mapping</TH>
              <TH>Assigned to</TH>
              <TH>Answer</TH>
              <TH>Evidence</TH>
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => (
              <TR key={r.id}>
                {a.actions.assign && (
                  <TD>
                    <Checkbox
                      aria-label={`Select ${r.questionCode}`}
                      checked={selected.has(r.id)}
                      onCheckedChange={(c) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (c) n.add(r.id);
                          else n.delete(r.id);
                          return n;
                        })
                      }
                    />
                  </TD>
                )}
                <TD className="text-[13px] text-muted">{r.questionCode}</TD>
                <TD className="max-w-lg">
                  <p className="line-clamp-2 text-[14px]">{r.question}</p>
                  {r.clarificationOpen && <Badge tone="warn">Clarification open</Badge>}
                </TD>
                <TD className="max-w-[200px]">
                  <MappingChips mappings={r.mappings} />
                </TD>
                <TD className="text-[13px]">
                  {r.assignment ? (
                    <>
                      {r.assignment.assignee.name}
                      {r.assignment.dueDate && <span className="block text-xs text-muted">due {formatDate(r.assignment.dueDate)}</span>}
                    </>
                  ) : (
                    <span className="text-faint">Unassigned</span>
                  )}
                </TD>
                <TD>
                  <Badge tone={RESPONSE_STATUS[r.response?.status ?? 'NOT_ASSESSED'].tone}>{RESPONSE_STATUS[r.response?.status ?? 'NOT_ASSESSED'].label}</Badge>
                </TD>
                <TD className="tabular text-[13px]">{r.evidence.length || '—'}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
      <AssignDialog a={a} itemIds={[...selected]} open={assignOpen} onOpenChange={setAssignOpen} onDone={refresh} />
    </Card>
  );
}

export function AssessmentDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['assessment', id], queryFn: () => assessmentsService.get(id) });
  const history = useQuery({ queryKey: ['assessment-history', id], queryFn: () => assessmentsService.history(id) });
  const [dlg, setDlg] = useState<null | 'release' | 'approve' | 'reject' | 'reopen' | 'finalise'>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['assessment', id] });
    qc.invalidateQueries({ queryKey: ['assessment-history', id] });
    qc.invalidateQueries({ queryKey: ['assessments'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const timeline = useMemo(
    () => (history.data ?? []).map((h) => ({ id: h.id, title: `${ASSESSMENT_STATUS[h.fromStatus ?? '']?.label ?? 'Created'} → ${ASSESSMENT_STATUS[h.toStatus]?.label ?? h.toStatus}`, meta: h.actor?.name, body: h.reason, at: h.createdAt, tone: ASSESSMENT_STATUS[h.toStatus]?.tone })),
    [history.data],
  );
  if (q.isLoading) return <Card><LoadingRows rows={10} /></Card>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const a = q.data!;
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ to: '/assessments', label: 'Assessment Periods' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {a.title} <StatusBadge map={ASSESSMENT_STATUS} value={a.status} />
          </span>
        }
        description={`${a.code} · ${a.site.name} / ${a.department.name} · ${a.periodLabel} · round ${a.round}`}
        actions={
          <>
            {a.actions.release && (
              <Button variant="primary" onClick={() => setDlg('release')}>
                <Send /> Assign to department
              </Button>
            )}
            {(a.actions.respond || a.actions.submit) && (
              <Button variant="primary" asChild>
                <Link to={`/my-assessments/${a.id}`}>
                  <ClipboardCheck /> Open workspace
                </Link>
              </Button>
            )}
            {(a.actions.startReview || a.actions.review) && (
              <Button variant="primary" asChild>
                <Link to={`/auditor/${a.id}`}>
                  <ShieldCheck /> Audit review
                </Link>
              </Button>
            )}
            {a.actions.approve && (
              <>
                <Button variant="danger-outline" onClick={() => setDlg('reject')}>
                  <XCircle /> Reject
                </Button>
                <Button variant="primary" onClick={() => setDlg('approve')}>
                  <CheckCircle2 /> Approve & issue report
                </Button>
              </>
            )}
            {a.actions.finalise && (
              <Button variant="primary" onClick={() => setDlg('finalise')}>
                <CheckCircle2 /> Finalise & issue report
              </Button>
            )}
            {a.actions.export && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button>
                    <Download /> Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => assessmentsService.export(a.id, 'xlsx')}>Responses (XLSX)</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => assessmentsService.export(a.id, 'csv')}>Responses (CSV)</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {a.actions.reopen && (
              <Button variant="danger-outline" onClick={() => setDlg('reopen')}>
                <RotateCcw /> Reopen
              </Button>
            )}
          </>
        }
      />
      <SodNotice messages={[a.actions.blocked?.review, a.actions.blocked?.approve]} />
      <Card className="px-5 py-5">
        <LifecycleStepper status={a.status} approvalRequired={a.approvalRequired} />
      </Card>
      <MetricsStrip m={a.metrics} />
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="questions">Questions & assignments</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="grid gap-6 xl:grid-cols-3">
            <Card>
              <CardHeader title="Details" />
              <CardBody>
                <dl className="grid grid-cols-2 gap-4">
                  <KeyValue label="Checklist">
                    <Link className="text-brand hover:underline" to={`/checklists/${a.checklistVersion.template.id}/versions/${a.checklistVersion.id}`}>
                      {a.checklistVersion.template.title} v{a.checklistVersion.versionNumber}
                    </Link>
                  </KeyValue>
                  <KeyValue label="Owner">{a.owner.name}</KeyValue>
                  <KeyValue label="Period">
                    {formatDate(a.periodStart)} – {formatDate(a.periodEnd)}
                  </KeyValue>
                  <KeyValue label="Due">{formatDate(a.dueDate)}</KeyValue>
                  <KeyValue label="Scoring policy">
                    v{a.scoringPolicy.version} · {a.scoringPolicy.name}
                  </KeyValue>
                  <KeyValue label="Approval step">{a.approvalRequired ? 'Required' : 'Not required'}</KeyValue>
                  <KeyValue label="Created by">{a.createdBy.name}</KeyValue>
                  <KeyValue label="Findings">
                    <Link className="text-brand hover:underline" to={`/findings?assessmentId=${a.id}`}>
                      {a._count.findings}
                    </Link>
                  </KeyValue>
                  <KeyValue label="Scope" className="col-span-2">
                    {a.scope}
                  </KeyValue>
                </dl>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Clause-wise results" />
              <CardBody>{a.metrics.byClause.length ? <ClauseBreakdown m={a.metrics} /> : <EmptyState title="No clause mappings" />}</CardBody>
            </Card>
            <div className="space-y-6">
              <Card>
                <CardHeader title="Assignments" description={`${a._count.assignments} of ${a.metrics.totalItems} questions assigned`} />
                <CardBody>
                  {a.assignmentSummary.length ? (
                    <ul className="space-y-2 text-sm">
                      {a.assignmentSummary.map((s) => (
                        <li key={s.assignee?.id} className="flex justify-between">
                          <span>{s.assignee?.name}</span>
                          <span className="tabular text-muted">{s.count}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted">No questions assigned yet.</p>
                  )}
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Audit & approval" />
                <CardBody className="space-y-3 text-sm">
                  {a.overallReview ? (
                    <div className="rounded-md bg-subtle px-3 py-2">
                      <p className="text-xs text-muted">
                        Auditor opinion · {a.overallReview.auditor.name} · {formatDateTime(a.overallReview.createdAt)}
                      </p>
                      <p className="mt-1">{a.overallReview.comments}</p>
                    </div>
                  ) : (
                    <p className="text-muted">No auditor opinion yet.</p>
                  )}
                  {a.approvals.map((ap) => (
                    <p key={ap.id}>
                      <Badge tone={ap.decision === 'APPROVED' ? 'ok' : 'bad'}>{ap.decision === 'APPROVED' ? 'Approved' : 'Rejected'}</Badge> {ap.approver.name} · {formatDateTime(ap.createdAt)}
                      {ap.comments && <span className="block text-xs text-muted">{ap.comments}</span>}
                    </p>
                  ))}
                  {a.reports.map((r) => (
                    <button key={r.id} onClick={() => reportsService.open(r.id, true)} className="flex w-full items-center gap-2 rounded-md border border-line px-3 py-2 text-left hover:bg-subtle">
                      <FileText className="size-4 text-brand" />
                      <span className="flex-1">
                        {r.code} <span className="text-xs text-muted">v{r.version}</span>
                      </span>
                      <span className="text-xs text-muted">{formatDate(r.generatedAt)}</span>
                    </button>
                  ))}
                </CardBody>
              </Card>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="questions">
          <QuestionsTab a={a} />
        </TabsContent>
        <TabsContent value="history">
          <Card>
            <CardHeader title="Lifecycle history" description="Every transition with actor, timestamp and reason. Prior submissions are preserved as snapshots." />
            <CardBody>
              {history.isLoading ? <LoadingRows rows={3} /> : <Timeline items={timeline} />}
              {a.submissions.length > 0 && <p className="mt-6 text-xs text-muted">Submission snapshots: {a.submissions.map((s) => `round ${s.round} (${formatDate(s.createdAt)})`).join(', ')}</p>}
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={dlg === 'release'}
        onOpenChange={() => setDlg(null)}
        title="Assign to the department?"
        description={`${a.owner.name} will be notified and can start answering. Assessment details become fixed once work starts.`}
        confirmLabel="Assign"
        onConfirm={async () => {
          await assessmentsService.release(a.id);
          toast.success('Assessment assigned to department');
          refresh();
        }}
      />
      <ConfirmDialog
        open={dlg === 'approve'}
        onOpenChange={() => setDlg(null)}
        title="Approve assessment?"
        description="The final, versioned PDF report will be generated and stored in the central report repository."
        confirmLabel="Approve"
        onConfirm={async () => {
          await assessmentsService.approval(a.id, 'APPROVED');
          toast.success('Approved — final report generated');
          refresh();
        }}
      />
      <ConfirmDialog
        open={dlg === 'finalise'}
        onOpenChange={() => setDlg(null)}
        title="Finalise assessment?"
        description="No separate approval is configured. The final PDF report will be generated now."
        confirmLabel="Finalise"
        onConfirm={async () => {
          await assessmentsService.finalise(a.id);
          toast.success('Finalised — final report generated');
          refresh();
        }}
      />
      <ConfirmDialog
        open={dlg === 'reject'}
        onOpenChange={() => setDlg(null)}
        title="Reject approval"
        description="The assessment returns to the auditor (Under review)."
        reasonLabel="Reason"
        tone="danger"
        confirmLabel="Reject"
        onConfirm={async (reason) => {
          await assessmentsService.approval(a.id, 'REJECTED', reason);
          toast.success('Approval rejected');
          refresh();
        }}
      />
      <ConfirmDialog
        open={dlg === 'reopen'}
        onOpenChange={() => setDlg(null)}
        title="Reopen assessment"
        description="Returns the assessment to In progress. Earlier submissions, reviews and issued reports are preserved."
        reasonLabel="Reason for reopening"
        reasonMin={10}
        tone="danger"
        confirmLabel="Reopen"
        onConfirm={async (reason) => {
          await assessmentsService.reopen(a.id, reason);
          toast.success('Assessment reopened');
          refresh();
        }}
      />
    </div>
  );
}
