import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Circle, AlertTriangle } from 'lucide-react';
import { adminService } from '@/services/admin.service';
import { useAuth } from '@/contexts/AuthContext';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/display';
import { ErrorState, LoadingRows, PageHeader } from '@/components/common';
import { ROLE_LABEL } from '@/constants/status';
import { cn } from '@/lib/utils';

interface Step {
  key: string;
  title: string;
  done: boolean;
  detail: string;
  to: string;
  action: string;
  warn?: string;
}

/**
 * Admin home: what is set up and what is left, in the order an organisation is normally configured.
 * A branch administrator sees only their own branch(es).
 */
export function AdminHomePage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['setup-status'], queryFn: adminService.setupStatus });
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data!;
  const steps: Step[] = [
    { key: 'org', title: 'Organisation', done: true, detail: s.organisation.legalEntity ?? s.organisation.name, to: '/organisation', action: 'Review' },
    { key: 'sites', title: 'Branches', done: s.sites > 0, detail: s.sites ? s.siteNames.join(', ') : 'No branch yet', to: '/organisation', action: s.sites ? 'Manage' : 'Add a branch' },
    {
      key: 'depts',
      title: 'Departments and owners',
      done: s.departments > 0 && s.departmentsWithoutOwner.length === 0,
      detail: `${s.departments} department(s)`,
      warn: s.departmentsWithoutOwner.length ? `${s.departmentsWithoutOwner.length} without an owner: ${s.departmentsWithoutOwner.map((d) => d.name).join(', ')}` : undefined,
      to: '/organisation',
      action: s.departments ? 'Assign owners' : 'Add a department',
    },
    {
      key: 'users',
      title: 'People and access',
      done: s.users > 1 && !!s.roleCounts.AUDITOR && !!s.roleCounts.ISMS_OWNER,
      detail: `${s.users} active user(s)` + (s.usersNeverSignedIn ? ` · ${s.usersNeverSignedIn} not signed in yet` : ''),
      warn: !s.roleCounts.AUDITOR ? 'No auditor yet. Someone independent must review assessments.' : !s.roleCounts.ISMS_OWNER ? 'No ISMS owner yet.' : undefined,
      to: '/users',
      action: 'Manage users',
    },
    {
      key: 'checklist',
      title: 'Published checklist',
      done: s.checklists.published > 0,
      detail: `${s.checklists.published} published · ${s.checklists.underReview} in review · ${s.checklists.draft} draft`,
      warn: s.flaggedMappings ? `${s.flaggedMappings} ISO mapping(s) still to resolve in drafts` : undefined,
      to: '/checklists',
      action: s.checklists.published ? 'Open library' : 'Import from Excel',
    },
    { key: 'assessment', title: 'First assessment', done: s.assessments > 0, detail: `${s.assessments} assessment(s) · ${s.schedules} active schedule(s)`, to: '/assessments', action: s.assessments ? 'View' : 'Create' },
  ];
  const done = steps.filter((x) => x.done).length;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin Home"
        description={s.scope === 'organisation' ? `${s.organisation.name} · organisation-wide administration` : `${s.organisation.name} · you administer ${s.siteNames.join(', ')} only`}
      />
      <Card>
        <CardHeader title={`Setup · ${done} of ${steps.length} done`} description="Work top to bottom. Each step links to the page where you finish it." />
        <ol className="divide-y divide-line">
          {steps.map((st) => (
            <li key={st.key} className="flex flex-wrap items-center gap-4 px-5 py-4">
              {st.done ? <CheckCircle2 className="size-5 shrink-0 text-ok" /> : <Circle className="size-5 shrink-0 text-faint" />}
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm font-medium', st.done ? 'text-ink' : 'text-ink')}>{st.title}</p>
                <p className="truncate text-[13px] text-muted">{st.detail}</p>
                {st.warn && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-warn">
                    <AlertTriangle className="size-3.5" /> {st.warn}
                  </p>
                )}
              </div>
              <Link to={st.to} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
                {st.action} <ArrowRight className="size-3.5" />
              </Link>
            </li>
          ))}
        </ol>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="People by role" />
          <CardBody className="flex flex-wrap gap-2">
            {Object.entries(ROLE_LABEL).map(([k, label]) => (
              <Badge key={k} tone={s.roleCounts[k] ? 'brand' : 'neutral'}>
                {label}: {s.roleCounts[k] ?? 0}
              </Badge>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Rules this system enforces" />
          <CardBody>
            <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-ink-2">
              <li>Branch administrators can only manage people and departments in their own branch.</li>
              <li>Nobody can change their own roles or restrictions; another administrator must do it.</li>
              <li>A checklist is published by a named reviewer, never by its author.</li>
              <li>Whoever prepared an assessment cannot audit it; whoever prepared or audited it cannot approve it.</li>
              {can('role:assign') && <li>To limit one person, use Users → Access → Restrict permissions. Their role stays the same.</li>}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
