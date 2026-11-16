import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { assessmentsService } from '@/services/assessments.service';
import { Badge, Card, CardHeader, Table, TD, TH, THead, TR } from '@/components/ui/display';
import { ActiveFilters, EmptyState, ErrorState, LoadingRows, PageHeader, Pagination, usePaged } from '@/components/common';
import { useScope } from '@/hooks/useScope';
import { RESPONSE_STATUS, PRIORITY } from '@/constants/status';
import { cn, formatDate } from '@/lib/utils';
import { AssessmentTable } from './AssessmentsPage';

export function MyAssessmentsPage() {
  const navigate = useNavigate();
  const scope = useScope();
  const [params, set] = usePaged({ mine: 'true' });
  const query = { ...params, ...scope.params };
  const list = useQuery({ queryKey: ['assessments', 'mine', query], queryFn: () => assessmentsService.list(query) });
  const tasks = useQuery({ queryKey: ['my-assignments', scope.params], queryFn: () => assessmentsService.myAssignments(scope.params) });
  const open = (tasks.data ?? []).filter((t) => !t.completed);
  return (
    <div className="space-y-6">
      <PageHeader title="My Assessments" description="Assessments you own or have questions assigned in. Answer, attach evidence and respond to clarifications." />
      <Card>
        <CardHeader title="Assessments" />
        <ActiveFilters chips={scope.chips} total={list.data?.meta.total} onClearAll={scope.clear} />
        {list.isLoading ? (
          <LoadingRows />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data?.data.length ? (
          <EmptyState icon={ClipboardCheck} title="Nothing assigned to you" description="When an assessment is assigned to your department or questions are assigned to you, it appears here." />
        ) : (
          <>
            <AssessmentTable rows={list.data.data} onOpen={(a) => navigate(`/my-assessments/${a.id}`)} />
            <Pagination {...list.data.meta} onPage={(p) => set({ page: p })} />
          </>
        )}
      </Card>
      <Card>
        <CardHeader title="My open question assignments" description={`${open.length} awaiting an answer · ${open.filter((t) => t.overdue).length} overdue`} />
        {tasks.isLoading ? (
          <LoadingRows rows={3} />
        ) : tasks.isError ? (
          <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />
        ) : !tasks.data?.length ? (
          <EmptyState title="No question assignments" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Question</TH>
                <TH>Assessment</TH>
                <TH>Priority</TH>
                <TH>Answer</TH>
                <TH>Due</TH>
              </tr>
            </THead>
            <tbody>
              {tasks.data.map((t) => (
                <TR key={t.id} className="hover:bg-subtle">
                  <TD className="max-w-lg">
                    <Link to={`/my-assessments/${t.assessmentId}?item=${t.itemId}`} className="hover:text-brand">
                      <span className="text-xs text-muted">{t.item.questionCode}</span>
                      <p className="line-clamp-1 font-medium">{t.item.question}</p>
                    </Link>
                  </TD>
                  <TD className="text-[13px]">{t.assessment.code}</TD>
                  <TD>
                    <Badge tone={PRIORITY[t.item.priority]?.tone}>{PRIORITY[t.item.priority]?.label}</Badge>
                  </TD>
                  <TD>
                    <Badge tone={RESPONSE_STATUS[t.responseStatus].tone}>{RESPONSE_STATUS[t.responseStatus].label}</Badge>
                  </TD>
                  <TD className={cn('tabular text-[13px]', t.overdue && 'font-medium text-bad')}>
                    {formatDate(t.dueDate ?? t.assessment.dueDate)}
                    {t.overdue && ' · overdue'}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
