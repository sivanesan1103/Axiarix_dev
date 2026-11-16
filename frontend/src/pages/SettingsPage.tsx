import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, KeyRound, Mail, Monitor, Moon, Play, Plus, ShieldCheck, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { authService } from '@/services/auth.service';
import { adminService, type Settings } from '@/services/admin.service';
import { checklistsService } from '@/services/checklists.service';
import { organisationService } from '@/services/organisation.service';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme, type ThemePreference } from '@/contexts/ThemeContext';
import { passwordSchema } from '@/schemas/common';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, Table, TD, TH, THead, TR, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/display';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/overlays';
import { Field, Input, NativeSelect, Switch, Textarea } from '@/components/ui/form-controls';
import { ConfirmDialog, ErrorState, LoadingRows, PageHeader } from '@/components/common';
import { ROLE_LABEL } from '@/constants/status';
import { formatDate, formatDateTime, humanize } from '@/lib/utils';

// ───────────── Profile & security ─────────────

const pwSchema = z.object({ currentPassword: z.string().min(1, 'Required'), newPassword: passwordSchema, confirm: z.string() }).refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

function AppearanceCard() {
  const { preference, setPreference } = useTheme();
  const options: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];
  return (
    <Card>
      <CardHeader title="Appearance" description="Saved in this browser. System follows your operating-system setting." />
      <CardBody>
        <div role="radiogroup" aria-label="Theme" className="grid max-w-md grid-cols-3 gap-2">
          {options.map((o) => (
            <button
              key={o.value}
              role="radio"
              aria-checked={preference === o.value}
              onClick={() => setPreference(o.value)}
              className={`flex flex-col items-center gap-2 rounded-lg border px-3 py-4 text-sm font-medium transition-colors ${preference === o.value ? 'border-brand bg-brand-soft text-brand-ink ring-1 ring-brand' : 'border-line hover:bg-subtle'}`}
            >
              <o.icon className="size-5" />
              {o.label}
            </button>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function ProfileTab() {
  const { user, reload } = useAuth();
  const form = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const pw = useMutation({ mutationFn: (v: z.infer<typeof pwSchema>) => authService.changePassword(v.currentPassword, v.newPassword), onSuccess: () => (toast.success('Password changed'), form.reset()) });
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [disable, setDisable] = useState({ open: false, password: '', code: '' });
  const start = useMutation({ mutationFn: authService.mfaSetup, onSuccess: setSetup });
  const enable = useMutation({ mutationFn: () => authService.mfaEnable(code), onSuccess: async () => (toast.success('Two-step verification enabled'), setSetup(null), setCode(''), await reload()) });
  const off = useMutation({ mutationFn: () => authService.mfaDisable(disable.password, disable.code), onSuccess: async () => (toast.success('Two-step verification disabled'), setDisable({ open: false, password: '', code: '' }), await reload()) });
  const e = form.formState.errors;
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <AppearanceCard />
      <Card>
        <CardHeader title="Profile" />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-xs text-muted">Name</dt>
              <dd>{user?.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">E-mail</dt>
              <dd>{user?.email}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted">Roles</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {user?.roles.map((r) => (
                  <Badge key={r} tone="brand">
                    {ROLE_LABEL[r]}
                  </Badge>
                ))}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Two-step verification (MFA)"
          description="Time-based one-time codes from an authenticator app. Required for privileged and auditor accounts when the security policy enforces it."
          actions={user?.mfaEnabled ? <Badge tone="ok" dot>Enabled</Badge> : <Badge dot>Off</Badge>}
        />
        <CardBody className="space-y-4">
          {user?.mfaEnabled ? (
            <Button variant="danger-outline" onClick={() => setDisable((d) => ({ ...d, open: true }))}>
              Disable MFA
            </Button>
          ) : setup ? (
            <div className="space-y-3">
              <p className="text-sm">Add this key to your authenticator app (Google Authenticator, Microsoft Authenticator, etc.), then enter the 6-digit code.</p>
              <code className="block break-all rounded-md bg-subtle px-3 py-2 text-sm font-semibold tracking-wider">{setup.secret}</code>
              <p className="break-all text-xs text-muted">{setup.otpauthUrl}</p>
              <div className="flex gap-2">
                <Input aria-label="Verification code" inputMode="numeric" maxLength={6} className="w-40 text-center tracking-[0.3em]" value={code} onChange={(ev) => setCode(ev.target.value.replace(/\D/g, ''))} />
                <Button variant="primary" disabled={code.length !== 6} loading={enable.isPending} onClick={() => enable.mutate()}>
                  <ShieldCheck /> Verify & enable
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="primary" loading={start.isPending} onClick={() => start.mutate()}>
              <ShieldCheck /> Set up MFA
            </Button>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Change password" description="At least 12 characters with upper-case, lower-case and a digit." />
        <CardBody>
          <form className="max-w-sm space-y-4" onSubmit={form.handleSubmit((v) => pw.mutate(v))}>
            <Field label="Current password" error={e.currentPassword?.message} htmlFor="pw-cur">
              <Input id="pw-cur" type="password" autoComplete="current-password" {...form.register('currentPassword')} />
            </Field>
            <Field label="New password" error={e.newPassword?.message} htmlFor="pw-new">
              <Input id="pw-new" type="password" autoComplete="new-password" {...form.register('newPassword')} />
            </Field>
            <Field label="Confirm new password" error={e.confirm?.message} htmlFor="pw-conf">
              <Input id="pw-conf" type="password" autoComplete="new-password" {...form.register('confirm')} />
            </Field>
            <Button type="submit" variant="primary" loading={pw.isPending}>
              <KeyRound /> Change password
            </Button>
          </form>
        </CardBody>
      </Card>
      <Dialog open={disable.open} onOpenChange={(o) => setDisable((d) => ({ ...d, open: o }))}>
        <DialogContent size="sm">
          <DialogHeader title="Disable MFA" />
          <DialogBody className="space-y-4">
            <Field label="Password">
              <Input type="password" value={disable.password} onChange={(ev) => setDisable((d) => ({ ...d, password: ev.target.value }))} />
            </Field>
            <Field label="Current 6-digit code">
              <Input inputMode="numeric" maxLength={6} value={disable.code} onChange={(ev) => setDisable((d) => ({ ...d, code: ev.target.value.replace(/\D/g, '') }))} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setDisable({ open: false, password: '', code: '' })}>Cancel</Button>
            <Button variant="danger" disabled={!disable.password || disable.code.length !== 6} loading={off.isPending} onClick={() => off.mutate()}>
              Disable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ───────────── System settings (admin) ─────────────

/** Only administrators may read system settings; others never send the request (no 403 noise). */
function useSettings(enabled = true) {
  return useQuery({ queryKey: ['settings'], queryFn: adminService.settings, enabled });
}

function SaveSetting<K extends keyof Settings>({ k, value, disabled }: { k: K; value: Settings[K]; disabled?: boolean }) {
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: () => adminService.saveSetting(k, value), onSuccess: () => (toast.success('Settings saved'), qc.invalidateQueries({ queryKey: ['settings'] })) });
  return (
    <Button variant="primary" disabled={disabled} loading={m.isPending} onClick={() => m.mutate()}>
      Save
    </Button>
  );
}

function WorkflowTab({ s, canEdit }: { s: Settings; canEdit: boolean }) {
  const [wf, setWf] = useState(s['workflow.policy']);
  const [up, setUp] = useState(s['upload.policy']);
  const [sec, setSec] = useState(s['security.policy']);
  const [ext, setExt] = useState(s['upload.policy'].allowedExtensions.join(', '));
  useEffect(() => setUp((u) => ({ ...u, allowedExtensions: ext.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) })), [ext]);
  const row = (label: string, desc: string, checked: boolean, onChange: (c: boolean) => void) => (
    <label className="flex items-start justify-between gap-4 border-b border-line py-3 last:border-0">
      <span>
        <span className="text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted">{desc}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={!canEdit} />
    </label>
  );
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Assessment workflow" description="Conditional stages of the assessment lifecycle." actions={canEdit && <SaveSetting k="workflow.policy" value={wf} />} />
        <CardBody>
          {row('Separate approval step by default', 'New assessments require ISMS approval after the auditor review.', wf.approvalRequiredByDefault, (c) => setWf({ ...wf, approvalRequiredByDefault: c }))}
          {row('Clarification stage', 'Open auditor rejections send the assessment back to the department.', wf.clarificationEnabled, (c) => setWf({ ...wf, clarificationEnabled: c }))}
          {row('Auditor acceptance of N/A', 'Not Applicable answers are reviewed by the auditor like other items.', wf.requireAuditorAcceptanceForNA, (c) => setWf({ ...wf, requireAuditorAcceptanceForNA: c }))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Security policy" actions={canEdit && <SaveSetting k="security.policy" value={sec} />} />
        <CardBody className="space-y-4">
          {row('Enforce MFA for privileged roles', 'Administrators, ISMS owners and auditors are prompted to enrol at sign-in.', sec.enforceMfaForPrivileged, (c) => setSec({ ...sec, enforceMfaForPrivileged: c }))}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Failed sign-ins before lock-out">
              <Input type="number" min={3} max={20} disabled={!canEdit} value={sec.maxFailedLogins} onChange={(e) => setSec({ ...sec, maxFailedLogins: Number(e.target.value) })} />
            </Field>
            <Field label="Lock-out minutes">
              <Input type="number" min={1} max={1440} disabled={!canEdit} value={sec.lockoutMinutes} onChange={(e) => setSec({ ...sec, lockoutMinutes: Number(e.target.value) })} />
            </Field>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Evidence uploads" description="Allow-listed formats and size limit (pending hospital confirmation, SRS §13)." actions={canEdit && <SaveSetting k="upload.policy" value={up} disabled={!up.allowedExtensions.length} />} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Maximum file size (MB)">
            <Input type="number" min={1} max={200} disabled={!canEdit} value={up.maxFileSizeMb} onChange={(e) => setUp({ ...up, maxFileSizeMb: Number(e.target.value) })} />
          </Field>
          <Field label="Allowed extensions" hint="Executables and scripts are always blocked.">
            <Input disabled={!canEdit} value={ext} onChange={(e) => setExt(e.target.value)} />
          </Field>
        </CardBody>
      </Card>
    </div>
  );
}

function NotificationsTab({ s, canEdit }: { s: Settings; canEdit: boolean }) {
  const { user } = useAuth();
  const [np, setNp] = useState(s['notification.policy']);
  const [to, setTo] = useState(user?.email ?? '');
  const test = useMutation({ mutationFn: () => adminService.testEmail(to), onSuccess: () => toast.success(`Test e-mail sent to ${to}`) });
  const remind = useMutation({ mutationFn: adminService.runReminders, onSuccess: (r) => toast.success(`${r.sent} reminder(s) sent`) });
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="E-mail notifications" description="Delivery failures never block the underlying workflow; they are recorded per notification." actions={canEdit && <SaveSetting k="notification.policy" value={np} />} />
        <CardBody className="space-y-3">
          <label className="flex items-center justify-between border-b border-line pb-3 text-sm font-medium">
            Send e-mail via SMTP <Switch checked={np.emailEnabled} disabled={!canEdit} onCheckedChange={(c) => setNp({ ...np, emailEnabled: c })} />
          </label>
          {Object.entries(np.events).map(([k, v]) => (
            <label key={k} className="flex items-center justify-between text-sm">
              {humanize(k)} <Switch checked={v} disabled={!canEdit || !np.emailEnabled} onCheckedChange={(c) => setNp({ ...np, events: { ...np.events, [k]: c } })} />
            </label>
          ))}
          <Field label="Deadline reminder (days before due)" className="pt-2">
            <Input type="number" min={0} max={60} disabled={!canEdit} value={np.deadlineReminderDays} onChange={(e) => setNp({ ...np, deadlineReminderDays: Number(e.target.value) })} />
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Test & run" />
        <CardBody className="space-y-4">
          <Field label="Send a test e-mail to">
            <div className="flex gap-2">
              <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} />
              <Button loading={test.isPending} disabled={!to || !canEdit} onClick={() => test.mutate()}>
                <Mail /> Send
              </Button>
            </div>
          </Field>
          <div>
            <Button loading={remind.isPending} disabled={!canEdit} onClick={() => remind.mutate()}>
              <Play /> Send deadline reminders now
            </Button>
            <p className="mt-1 text-xs text-muted">Also runs automatically every 6 hours. Reminders are not repeated on the same day.</p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function ReportTab({ s, canEdit }: { s: Settings; canEdit: boolean }) {
  const [rc, setRc] = useState(s['report.config']);
  return (
    <Card>
      <CardHeader title="Final report configuration" description="Applies to newly generated reports. Issued reports are never changed." actions={canEdit && <SaveSetting k="report.config" value={rc} disabled={!rc.headerTitle.trim()} />} />
      <CardBody className="grid max-w-3xl gap-4">
        <Field label="Report title">
          <Input disabled={!canEdit} value={rc.headerTitle} onChange={(e) => setRc({ ...rc, headerTitle: e.target.value })} />
        </Field>
        <Field label="Sign-off roles" hint="Comma-separated; printed as signature lines.">
          <Input disabled={!canEdit} value={rc.signOffRoles.join(', ')} onChange={(e) => setRc({ ...rc, signOffRoles: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
        </Field>
        <Field label="Footer / standards note">
          <Textarea disabled={!canEdit} rows={3} value={rc.footerText} onChange={(e) => setRc({ ...rc, footerText: e.target.value })} />
        </Field>
        <label className="flex items-center gap-3 text-sm">
          <Switch disabled={!canEdit} checked={rc.includeEvidenceList} onCheckedChange={(c) => setRc({ ...rc, includeEvidenceList: c })} /> Include evidence register in report
        </label>
      </CardBody>
    </Card>
  );
}

const policySchema = z.object({ name: z.string().min(3), weightCompliant: z.coerce.number().min(0).max(1), weightPartial: z.coerce.number().min(0).max(1), weightNonCompliant: z.coerce.number().min(0).max(1), excludeNotApplicable: z.boolean(), excludeNotAssessed: z.boolean(), notes: z.string().optional() });

function ScoringTab({ canEdit, canApprove }: { canEdit: boolean; canApprove: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['scoring'], queryFn: adminService.scoringPolicies });
  const [open, setOpen] = useState(false);
  const [activate, setActivate] = useState<string | null>(null);
  const form = useForm<z.input<typeof policySchema>, unknown, z.output<typeof policySchema>>({ resolver: zodResolver(policySchema), defaultValues: { name: '', weightCompliant: 1, weightPartial: 0.5, weightNonCompliant: 0, excludeNotApplicable: true, excludeNotAssessed: false, notes: '' } });
  const create = useMutation({ mutationFn: (v: z.output<typeof policySchema>) => adminService.createScoringPolicy({ ...v, notes: v.notes || null }), onSuccess: () => (toast.success('Draft policy created'), setOpen(false), qc.invalidateQueries({ queryKey: ['scoring'] })) });
  if (q.isLoading) return <Card><LoadingRows /></Card>;
  if (q.isError) return <ErrorState error={q.error} />;
  return (
    <Card>
      <CardHeader
        title="Scoring policies"
        description="Versioned. New assessments pin the active policy; existing assessments and issued reports never change retroactively."
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setOpen(true)}>
              <Plus /> New version
            </Button>
          )
        }
      />
      <Table>
        <THead>
          <tr>
            <TH>Version</TH>
            <TH>Weights (C / PC / NC)</TH>
            <TH>N/A</TH>
            <TH>Not assessed</TH>
            <TH>Assessments</TH>
            <TH>Status</TH>
            <TH />
          </tr>
        </THead>
        <tbody>
          {q.data!.map((p) => (
            <TR key={p.id}>
              <TD>
                <p className="font-medium">
                  v{p.version} · {p.name}
                </p>
                {p.notes && <p className="max-w-md text-xs text-muted">{p.notes}</p>}
              </TD>
              <TD className="tabular">
                {p.weightCompliant} / {p.weightPartial} / {p.weightNonCompliant}
              </TD>
              <TD className="text-[13px]">{p.excludeNotApplicable ? 'Excluded' : 'Counted'}</TD>
              <TD className="text-[13px]">{p.excludeNotAssessed ? 'Excluded' : 'Counted as 0'}</TD>
              <TD className="tabular">{p._count.assessments}</TD>
              <TD>{p.isActive ? <Badge tone="ok" dot>Active since {formatDate(p.approvedAt)}</Badge> : <Badge>Draft</Badge>}</TD>
              <TD>
                {!p.isActive && canApprove && (
                  <Button size="sm" variant="soft" onClick={() => setActivate(p.id)}>
                    <CheckCircle2 /> Approve & activate
                  </Button>
                )}
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader title="New scoring policy version" />
          <form onSubmit={form.handleSubmit((v) => create.mutate(v))}>
            <DialogBody className="grid gap-4 sm:grid-cols-3">
              <Field label="Name" className="sm:col-span-3">
                <Input {...form.register('name')} />
              </Field>
              <Field label="Compliant">
                <Input type="number" step="0.05" {...form.register('weightCompliant')} />
              </Field>
              <Field label="Partially">
                <Input type="number" step="0.05" {...form.register('weightPartial')} />
              </Field>
              <Field label="Non-compliant">
                <Input type="number" step="0.05" {...form.register('weightNonCompliant')} />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-3">
                <Switch checked={form.watch('excludeNotApplicable')} onCheckedChange={(c) => form.setValue('excludeNotApplicable', c)} /> Exclude Not Applicable from denominator
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-3">
                <Switch checked={form.watch('excludeNotAssessed')} onCheckedChange={(c) => form.setValue('excludeNotAssessed', c)} /> Exclude Not Assessed from denominator
              </label>
              <Field label="Approval notes" className="sm:col-span-3">
                <Textarea rows={2} {...form.register('notes')} />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={create.isPending}>
                Create draft
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!activate}
        onOpenChange={() => setActivate(null)}
        title="Approve and activate this policy?"
        description="It applies to assessments created from now on. Existing assessments keep their pinned policy."
        confirmLabel="Activate"
        onConfirm={async () => {
          await adminService.activateScoringPolicy(activate!);
          toast.success('Scoring policy activated');
          qc.invalidateQueries({ queryKey: ['scoring'] });
        }}
      />
    </Card>
  );
}

function RetentionTab({ canEdit, canApprove }: { canEdit: boolean; canApprove: boolean }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const policies = useQuery({ queryKey: ['retention'], queryFn: adminService.retentionPolicies });
  const requests = useQuery({ queryKey: ['deletion-requests'], queryFn: adminService.deletionRequests });
  const [draft, setDraft] = useState<Record<string, { retentionDays: number; action: 'ARCHIVE' | 'REQUEST_DELETION'; isActive: boolean }>>({});
  useEffect(() => {
    if (policies.data) setDraft(Object.fromEntries(policies.data.map((p) => [p.entityType, { retentionDays: p.retentionDays, action: p.action, isActive: p.isActive }])));
  }, [policies.data]);
  const save = useMutation({ mutationFn: (t: string) => adminService.saveRetention(t, { ...draft[t], description: null }), onSuccess: () => (toast.success('Retention policy saved'), qc.invalidateQueries({ queryKey: ['retention'] })) });
  const run = useMutation({ mutationFn: adminService.runRetention, onSuccess: (r) => (toast.success(`${r.archived} archived · ${r.deletionRequests} deletion request(s) opened`), qc.invalidateQueries({ queryKey: ['deletion-requests'] })) });
  const decide = useMutation({ mutationFn: ({ id, d }: { id: string; d: 'APPROVED' | 'REJECTED' }) => adminService.decideDeletion(id, d), onSuccess: () => qc.invalidateQueries({ queryKey: ['deletion-requests'] }) });
  const exec = useMutation({ mutationFn: (id: string) => adminService.executeDeletion(id), onSuccess: () => (toast.success('Secure deletion executed'), qc.invalidateQueries({ queryKey: ['deletion-requests'] })) });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Retention policies"
          description="Applies to records of closed assessments. Proposed defaults pending hospital policy (SRS §13)."
          actions={
            canEdit && (
              <Button loading={run.isPending} onClick={() => run.mutate()}>
                <Play /> Apply retention now
              </Button>
            )
          }
        />
        <CardBody className="grid gap-4 lg:grid-cols-2">
          {(['EVIDENCE', 'REPORT'] as const).map((t) =>
            draft[t] ? (
              <div key={t} className="space-y-3 rounded-lg border border-line p-4">
                <p className="font-medium">{t === 'EVIDENCE' ? 'Evidence files' : 'Final reports'}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Retain for (days)">
                    <Input type="number" min={30} disabled={!canEdit} value={draft[t].retentionDays} onChange={(e) => setDraft({ ...draft, [t]: { ...draft[t], retentionDays: Number(e.target.value) } })} />
                  </Field>
                  <Field label="Then">
                    <NativeSelect disabled={!canEdit} value={draft[t].action} onChange={(e) => setDraft({ ...draft, [t]: { ...draft[t], action: e.target.value as 'ARCHIVE' | 'REQUEST_DELETION' } })}>
                      <option value="ARCHIVE">Archive</option>
                      <option value="REQUEST_DELETION">Request secure deletion</option>
                    </NativeSelect>
                  </Field>
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch disabled={!canEdit} checked={draft[t].isActive} onCheckedChange={(c) => setDraft({ ...draft, [t]: { ...draft[t], isActive: c } })} /> Active
                  </label>
                  {canEdit && (
                    <Button size="sm" variant="primary" loading={save.isPending && save.variables === t} onClick={() => save.mutate(t)}>
                      Save
                    </Button>
                  )}
                </div>
              </div>
            ) : null,
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Secure deletion requests" description="Two-person rule: the requester cannot approve their own request. Files are destroyed; a metadata tombstone remains." />
        {!requests.data?.length ? (
          <p className="px-5 pb-5 text-sm text-muted">No deletion requests.</p>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Record</TH>
                <TH>Reason</TH>
                <TH>Requested</TH>
                <TH>Status</TH>
                <TH />
              </tr>
            </THead>
            <tbody>
              {requests.data.map((r) => (
                <TR key={r.id}>
                  <TD className="text-[13px]">
                    {r.entityType}
                    <span className="block max-w-[160px] truncate text-xs text-muted">{r.entityId}</span>
                  </TD>
                  <TD className="max-w-sm text-[13px]">{r.reason}</TD>
                  <TD className="text-[13px] text-muted">
                    {r.requestedBy.name}
                    <br />
                    {formatDateTime(r.createdAt)}
                  </TD>
                  <TD>
                    <Badge tone={r.status === 'EXECUTED' ? 'bad' : r.status === 'APPROVED' ? 'warn' : r.status === 'REJECTED' ? 'neutral' : 'info'}>{humanize(r.status)}</Badge>
                    {r.decidedBy && <span className="block text-xs text-muted">by {r.decidedBy.name}</span>}
                  </TD>
                  <TD className="text-right">
                    {r.status === 'PENDING' && canApprove && r.requestedById !== user?.id && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" onClick={() => decide.mutate({ id: r.id, d: 'REJECTED' })}>
                          Reject
                        </Button>
                        <Button size="sm" variant="soft" onClick={() => decide.mutate({ id: r.id, d: 'APPROVED' })}>
                          Approve
                        </Button>
                      </div>
                    )}
                    {r.status === 'APPROVED' && canEdit && (
                      <Button size="sm" variant="danger" loading={exec.isPending} onClick={() => exec.mutate(r.id)}>
                        Execute deletion
                      </Button>
                    )}
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

function SchedulesTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['schedules'], queryFn: adminService.schedules });
  const org = useQuery({ queryKey: ['org'], queryFn: organisationService.current });
  const templates = useQuery({ queryKey: ['checklists', 'all'], queryFn: () => checklistsService.list({ pageSize: 100 }) });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ siteId: '', departmentId: '', checklistTemplateId: '', frequency: 'QUARTERLY' as const, nextRunDate: '', durationDays: 30, isActive: true });
  const site = org.data?.sites.find((s) => s.id === f.siteId);
  const create = useMutation({ mutationFn: () => adminService.createSchedule(f), onSuccess: () => (toast.success('Schedule created'), setOpen(false), qc.invalidateQueries({ queryKey: ['schedules'] })) });
  const run = useMutation({ mutationFn: (id: string) => adminService.runSchedule(id), onSuccess: (a) => (toast.success(`Assessment ${a.code} created`), qc.invalidateQueries({ queryKey: ['schedules'] })) });
  const toggle = useMutation({ mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => adminService.updateSchedule(id, { isActive }), onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }) });
  return (
    <Card>
      <CardHeader
        title="Assessment schedules"
        description="Periodic (e.g. quarterly) IA cycles. Running a schedule creates the next assessment from the latest published checklist version."
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setOpen(true)}>
              <Plus /> New schedule
            </Button>
          )
        }
      />
      {!q.data?.length ? (
        <p className="px-5 pb-5 text-sm text-muted">No schedules configured.</p>
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Checklist</TH>
              <TH>Site / department</TH>
              <TH>Frequency</TH>
              <TH>Next period starts</TH>
              <TH>Active</TH>
              <TH />
            </tr>
          </THead>
          <tbody>
            {q.data.map((s) => (
              <TR key={s.id}>
                <TD className="font-medium">{s.template.title}</TD>
                <TD className="text-[13px]">
                  {s.site.name} / {s.department.name}
                </TD>
                <TD className="text-[13px]">{humanize(s.frequency)}</TD>
                <TD className="text-[13px]">
                  {formatDate(s.nextRunDate)} · {s.durationDays} days
                </TD>
                <TD>
                  <Switch checked={s.isActive} disabled={!canEdit} onCheckedChange={(c) => toggle.mutate({ id: s.id, isActive: c })} />
                </TD>
                <TD className="text-right">
                  {canEdit && s.isActive && (
                    <Button size="sm" variant="soft" loading={run.isPending && run.variables === s.id} onClick={() => run.mutate(s.id)}>
                      <Play /> Create next assessment
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader title="New assessment schedule" />
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Checklist" className="sm:col-span-2">
              <NativeSelect value={f.checklistTemplateId} onChange={(e) => setF({ ...f, checklistTemplateId: e.target.value })}>
                <option value="">Select…</option>
                {templates.data?.data.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Site">
              <NativeSelect value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value, departmentId: '' })}>
                <option value="">Select…</option>
                {org.data?.sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Department">
              <NativeSelect value={f.departmentId} disabled={!site} onChange={(e) => setF({ ...f, departmentId: e.target.value })}>
                <option value="">Select…</option>
                {site?.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Frequency">
              <NativeSelect value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as typeof f.frequency })}>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="HALF_YEARLY">Half-yearly</option>
                <option value="YEARLY">Yearly</option>
              </NativeSelect>
            </Field>
            <Field label="Next period start">
              <Input type="date" value={f.nextRunDate} onChange={(e) => setF({ ...f, nextRunDate: e.target.value })} />
            </Field>
            <Field label="Days to complete">
              <Input type="number" min={1} max={365} value={f.durationDays} onChange={(e) => setF({ ...f, durationDays: Number(e.target.value) })} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!f.checklistTemplateId || !f.departmentId || !f.nextRunDate} loading={create.isPending} onClick={() => create.mutate()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function SettingsPage() {
  const { can } = useAuth();
  const isAdmin = can('settings:read');
  const s = useSettings(isAdmin);
  const canEdit = can('settings:update');
  const canApprove = can('settings:approve');
  return (
    <div>
      <PageHeader title="Settings" description={isAdmin ? 'Your profile and security, plus system configuration for workflow, scoring, retention, notifications, reports and schedules.' : 'Your profile and account security.'} />
      <Tabs defaultValue="profile">
        <TabsList className="flex-wrap">
          <TabsTrigger value="profile">Profile & security</TabsTrigger>
          {isAdmin && (
            <>
              <TabsTrigger value="workflow">Workflow & uploads</TabsTrigger>
              <TabsTrigger value="scoring">Scoring</TabsTrigger>
              <TabsTrigger value="retention">Retention</TabsTrigger>
              <TabsTrigger value="notifications">Notifications</TabsTrigger>
              <TabsTrigger value="reports">Report configuration</TabsTrigger>
            </>
          )}
          {can('assessment:create') && <TabsTrigger value="schedules">Schedules</TabsTrigger>}
        </TabsList>
        <TabsContent value="profile">
          <ProfileTab />
        </TabsContent>
        {isAdmin && (
          <>
            {['workflow', 'notifications', 'reports'].map((t) => (
              <TabsContent key={t} value={t}>
                {s.isLoading ? <Card><LoadingRows /></Card> : s.isError ? <ErrorState error={s.error} onRetry={() => s.refetch()} /> : t === 'workflow' ? <WorkflowTab s={s.data!} canEdit={canEdit} /> : t === 'notifications' ? <NotificationsTab s={s.data!} canEdit={canEdit} /> : <ReportTab s={s.data!} canEdit={canEdit} />}
              </TabsContent>
            ))}
            <TabsContent value="scoring">
              <ScoringTab canEdit={canEdit} canApprove={canApprove} />
            </TabsContent>
            <TabsContent value="retention">
              <RetentionTab canEdit={canEdit} canApprove={canApprove} />
            </TabsContent>
          </>
        )}
        <TabsContent value="schedules">
          <SchedulesTab canEdit={can('assessment:create')} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
