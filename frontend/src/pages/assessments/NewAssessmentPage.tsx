import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { assessmentsService } from '@/services/assessments.service';
import { checklistsService } from '@/services/checklists.service';
import { organisationService } from '@/services/organisation.service';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/display';
import { Field, Input, NativeSelect, Switch, Textarea } from '@/components/ui/form-controls';
import { PageHeader } from '@/components/common';
import { UserSelect } from '@/components/common/pickers';
import { buildLabel, currentFyStart, currentQuarterNumber, fyLabel, periodDates, type PeriodKind } from '@/lib/period';
import { formatDate } from '@/lib/utils';

const schema = z
  .object({
    title: z.string().trim().min(3, 'Title is required'),
    siteId: z.string().min(1, 'Select a site'),
    departmentId: z.string().min(1, 'Select a department'),
    checklistVersionId: z.string().min(1, 'Select a published checklist version'),
    periodLabel: z.string().trim().regex(/^((Q[1-4]|H[12]) )?FY\d{4}-\d{2}$/, 'Choose a period'),
    periodStart: z.string().min(1, 'Required'),
    periodEnd: z.string().min(1, 'Required'),
    startDate: z.string().min(1, 'Required'),
    dueDate: z.string().min(1, 'Required'),
    ownerId: z.string().min(1, 'Select the assessment owner'),
    scope: z.string().max(2000).optional(),
    approvalRequired: z.boolean(),
    assignDefaultOwners: z.boolean(),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { path: ['periodEnd'], message: 'Must be after period start' })
  .refine((v) => v.dueDate >= v.startDate, { path: ['dueDate'], message: 'Must be after start date' });
type Form = z.infer<typeof schema>;

export function NewAssessmentPage() {
  const navigate = useNavigate();
  const org = useQuery({ queryKey: ['org'], queryFn: organisationService.current });
  const versions = useQuery({ queryKey: ['published-versions'], queryFn: checklistsService.publishedVersions });
  const [period, setPeriod] = useState<{ kind: PeriodKind; n: number; fy: number }>({ kind: 'Q', n: currentQuarterNumber(), fy: currentFyStart() });
  const q = { label: buildLabel(period.kind, period.n, period.fy), ...periodDates(period.kind, period.n, period.fy) };
  const today = new Date().toISOString().slice(0, 10);
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { title: 'IT & IT Data Centre – Quarterly Internal Assessment', siteId: '', departmentId: '', checklistVersionId: '', periodLabel: q.label, periodStart: q.start, periodEnd: q.end, startDate: today, dueDate: q.end, ownerId: '', scope: '', approvalRequired: true, assignDefaultOwners: true },
  });
  // The period is picked from fixed options; its label and dates are derived (the server derives them too).
  useEffect(() => {
    form.setValue('periodLabel', q.label);
    form.setValue('periodStart', q.start);
    form.setValue('periodEnd', q.end);
  }, [q.label, q.start, q.end, form]);
  const fyOptions = [-1, 0, 1, 2].map((d) => currentFyStart() + d);
  const siteId = form.watch('siteId');
  const departmentId = form.watch('departmentId');
  const site = org.data?.sites.find((s) => s.id === siteId);
  useEffect(() => {
    // The owner follows the department: picking another department switches to its owner (or clears the choice).
    const dept = site?.departments.find((d) => d.id === departmentId);
    form.setValue('ownerId', dept?.ownerId ?? '');
  }, [departmentId, site, form]);
  const m = useMutation({
    mutationFn: (v: Form) => assessmentsService.create({ ...v, scope: v.scope || null }),
    onSuccess: (a) => {
      toast.success(`Assessment ${a.code} created as Draft`);
      navigate(`/assessments/${a.id}`);
    },
  });
  const err = form.formState.errors;
  return (
    <div>
      <PageHeader back={{ to: '/assessments', label: 'Assessment Periods' }} title="New assessment" description="The selected checklist version and the active scoring policy are pinned to this assessment." />
      <form onSubmit={form.handleSubmit((v) => m.mutate(v))} className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px] [&>*]:min-w-0">
        <Card>
          <CardHeader title="Scope" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" required className="sm:col-span-2" error={err.title?.message} htmlFor="a-title">
              <Input id="a-title" {...form.register('title')} />
            </Field>
            <Field label="Hospital site" required error={err.siteId?.message} htmlFor="a-site">
              <NativeSelect id="a-site" {...form.register('siteId', { onChange: () => form.setValue('departmentId', '') })}>
                <option value="">Select…</option>
                {org.data?.sites
                  .filter((s) => s.status === 'ACTIVE')
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Field label="Department" required error={err.departmentId?.message} htmlFor="a-dept">
              <NativeSelect id="a-dept" disabled={!site} {...form.register('departmentId')}>
                <option value="">Select…</option>
                {site?.departments
                  .filter((d) => d.status === 'ACTIVE')
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Field label="Checklist version" required className="sm:col-span-2" error={err.checklistVersionId?.message} hint={versions.data && !versions.data.length ? 'No published checklist yet — publish one in the Checklist Library first.' : undefined} htmlFor="a-ver">
              <NativeSelect id="a-ver" {...form.register('checklistVersionId')}>
                <option value="">Select a published version…</option>
                {versions.data?.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.template.title} — v{v.versionNumber} ({v._count?.items} questions)
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Assessment owner (IT Department Owner)" required className="sm:col-span-2" error={err.ownerId?.message} htmlFor="a-owner">
              <UserSelect id="a-owner" value={form.watch('ownerId')} onChange={(v) => form.setValue('ownerId', v, { shouldValidate: true })} roles={['IT_OWNER']} siteId={siteId || undefined} departmentId={departmentId || undefined} placeholder={departmentId ? 'Select the department owner' : 'Choose a department first'} />
            </Field>
            <Field label="Scope statement" className="sm:col-span-2" hint="Printed on the final report." htmlFor="a-scope">
              <Textarea id="a-scope" {...form.register('scope')} />
            </Field>
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Period & dates" />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
                <Field label="Period type" htmlFor="a-pk">
                  <NativeSelect id="a-pk" value={period.kind} onChange={(e) => setPeriod((p) => ({ ...p, kind: e.target.value as PeriodKind, n: 1 }))}>
                    <option value="Q">Quarter</option>
                    <option value="H">Half year</option>
                    <option value="FY">Financial year</option>
                  </NativeSelect>
                </Field>
                <Field label={period.kind === 'H' ? 'Half' : 'Quarter'} htmlFor="a-pn">
                  <NativeSelect id="a-pn" disabled={period.kind === 'FY'} value={period.n} onChange={(e) => setPeriod((p) => ({ ...p, n: Number(e.target.value) }))}>
                    {(period.kind === 'H' ? [1, 2] : [1, 2, 3, 4]).map((n) => (
                      <option key={n} value={n}>
                        {period.kind === 'H' ? `H${n} (${n === 1 ? 'Apr–Sep' : 'Oct–Mar'})` : `Q${n} (${['Apr–Jun', 'Jul–Sep', 'Oct–Dec', 'Jan–Mar'][n - 1]})`}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Financial year" htmlFor="a-pfy" className="sm:col-span-2">
                  <NativeSelect id="a-pfy" value={period.fy} onChange={(e) => setPeriod((p) => ({ ...p, fy: Number(e.target.value) }))}>
                    {fyOptions.map((y) => (
                      <option key={y} value={y}>
                        {fyLabel(y)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              <p className="text-[13px] text-muted sm:col-span-2">
                Period <span className="font-medium text-ink">{q.label}</span> · {formatDate(q.start)} – {formatDate(q.end)}
                {err.periodLabel && <span className="ml-2 text-bad">{err.periodLabel.message}</span>}
              </p>
              <Field label="Start date" required error={err.startDate?.message} htmlFor="a-sd">
                <Input id="a-sd" type="date" {...form.register('startDate')} />
              </Field>
              <Field label="Due date" required error={err.dueDate?.message} htmlFor="a-dd">
                <Input id="a-dd" type="date" {...form.register('dueDate')} />
              </Field>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Workflow" />
            <CardBody className="space-y-4">
              <label className="flex items-start gap-3 text-sm">
                <Switch checked={form.watch('approvalRequired')} onCheckedChange={(c) => form.setValue('approvalRequired', c)} />
                <span>
                  <span className="font-medium">Separate approval step</span>
                  <span className="block text-xs text-muted">After auditor review, an ISMS owner must approve before the final PDF.</span>
                </span>
              </label>
              <label className="flex items-start gap-3 text-sm">
                <Switch checked={form.watch('assignDefaultOwners')} onCheckedChange={(c) => form.setValue('assignDefaultOwners', c)} />
                <span>
                  <span className="font-medium">Assign questions to default owners</span>
                  <span className="block text-xs text-muted">Uses each question's default owner from the checklist.</span>
                </span>
              </label>
            </CardBody>
          </Card>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => navigate('/assessments')}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={m.isPending}>
              Create assessment
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
