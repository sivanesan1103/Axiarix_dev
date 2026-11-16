import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '@/api/client';
import { platformService, type SetupDraft, type SetupUser } from '@/services/platform.service';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, Table, TD, TH, THead, TR } from '@/components/ui/display';
import { Field, Input, NativeSelect, Switch } from '@/components/ui/form-controls';
import { PageHeader } from '@/components/common';
import { ROLE_LABEL } from '@/constants/status';
import { cn } from '@/lib/utils';

const STEPS = ['Organisation', 'Branches & departments', 'Users', 'Checklist', 'Review & create'] as const;
const EMPTY: SetupDraft = { organisation: { name: '', legalEntity: null }, branches: [], departments: [], users: [] };
const cell = 'h-9 min-w-[150px] text-[13px]';
const wide = 'h-9 min-w-[250px] text-[13px]';

function FilePick({ accept, onFile, label, busy }: { accept: string; onFile: (f: File) => void; label: string; busy?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <Button type="button" loading={busy} onClick={() => ref.current?.click()}>
        <Upload /> {label}
      </Button>
    </>
  );
}

/**
 * Five-step wizard for a platform owner. Every step can be typed by hand or filled from a setup
 * workbook (see sample-org/01-organisation-setup.xlsx). The server re-validates everything on create.
 */
export function NewOrganisationPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [d, setD] = useState<SetupDraft>(EMPTY);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [checklistFile, setChecklistFile] = useState<File | null>(null);
  const [sendInvites, setSendInvites] = useState(true);
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState<{ name: string; users: number; invited: number; firstAdmin: string; checklists: { sheetName: string; items: number }[]; checklistError?: string } | null>(null);

  const patch = (p: Partial<SetupDraft>) => (setD((x) => ({ ...x, ...p })), setProblems(null));
  const branchCodes = d.branches.map((b) => b.code).filter(Boolean);

  const loadWorkbook = async (file: File) => {
    setParsing(true);
    try {
      const r = await platformService.parseSetup(file);
      setD(r.draft);
      setProblems(r.problems);
      toast.success(`Loaded ${r.draft.branches.length} branches, ${r.draft.departments.length} departments and ${r.draft.users.length} users`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setParsing(false);
    }
  };

  const check = async () => {
    try {
      setProblems((await platformService.validate(d)).problems);
    } catch (e) {
      setProblems([errorMessage(e)]);
    }
  };

  const create = async () => {
    setCreating(true);
    try {
      const r = await platformService.create(d, sendInvites);
      let checklists: { sheetName: string; items: number }[] = [];
      let checklistError: string | undefined;
      if (checklistFile) {
        try {
          checklists = (await platformService.importChecklists(r.organisation.id, checklistFile)).checklists;
        } catch (e) {
          checklistError = errorMessage(e);
        }
      }
      setDone({ name: r.organisation.name, users: r.users, invited: r.invited, firstAdmin: r.firstAdmin, checklists, checklistError });
      qc.invalidateQueries({ queryKey: ['platform-orgs'] });
    } catch (e) {
      const details = (e as { response?: { data?: { error?: { details?: { problems?: string[] } } } } }).response?.data?.error?.details?.problems;
      setProblems(details ?? [errorMessage(e)]);
    } finally {
      setCreating(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardBody className="space-y-4 py-10 text-center">
            <CheckCircle2 className="mx-auto size-10 text-ok" />
            <h1 className="text-xl font-semibold">{done.name} is ready</h1>
            <p className="text-sm text-muted">
              {done.users} user(s) created{done.invited ? `, ${done.invited} set-password invitation(s) sent` : ', no invitations sent'}. First administrator: {done.firstAdmin}.
            </p>
            {done.checklists.length > 0 && (
              <p className="text-sm text-muted">
                Imported as drafts: {done.checklists.map((c) => `${c.sheetName} (${c.items} questions)`).join(', ')}. The organisation's ISMS owner reviews and publishes them.
              </p>
            )}
            {done.checklistError && <p className="text-sm text-bad">Checklist import failed: {done.checklistError}. The organisation can import it later from its Checklist Library.</p>}
            <div className="flex justify-center gap-2 pt-2">
              <Button onClick={() => navigate('/platform')}>Back to organisations</Button>
              <Button variant="primary" onClick={() => (setDone(null), setD(EMPTY), setStep(0), setChecklistFile(null))}>
                Create another
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  const canNext = [
    d.organisation.name.trim().length >= 2,
    d.branches.length > 0 && d.branches.every((b) => b.code && b.name),
    d.users.length > 0 && d.users.every((u) => u.name && u.email && u.roleKey),
    true,
    true,
  ][step];

  return (
    <div className="space-y-6">
      <PageHeader title="New organisation" back={{ to: '/platform', label: 'Organisations' }} description="Fill each step, or load everything from a setup workbook and check the preview." actions={<FilePick accept=".xlsx" label="Load setup workbook" busy={parsing} onFile={loadWorkbook} />} />
      <ol className="flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => i <= step && setStep(i)}
              className={cn('rounded-full border px-3 py-1.5 text-[13px]', i === step ? 'border-brand bg-brand text-white' : i < step ? 'border-transparent bg-ok-soft text-ok' : 'border-line text-muted')}
              aria-current={i === step ? 'step' : undefined}
            >
              {i < step ? '✓ ' : `${i + 1}. `}
              {s}
            </button>
          </li>
        ))}
      </ol>

      {problems && problems.length > 0 && (
        <Card className="border-bad/40">
          <CardHeader title={`${problems.length} problem(s) to fix`} />
          <CardBody>
            <ul className="space-y-1 text-[13px] text-bad">
              {problems.map((p) => (
                <li key={p} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {p}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {step === 0 && (
        <Card>
          <CardHeader title="Organisation" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Organisation name" required htmlFor="o-name">
              <Input id="o-name" value={d.organisation.name} onChange={(e) => patch({ organisation: { ...d.organisation, name: e.target.value } })} />
            </Field>
            <Field label="Legal entity" htmlFor="o-legal">
              <Input id="o-legal" value={d.organisation.legalEntity ?? ''} onChange={(e) => patch({ organisation: { ...d.organisation, legalEntity: e.target.value || null } })} />
            </Field>
          </CardBody>
        </Card>
      )}

      {step === 1 && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="Branches" description="Code: upper-case letters, digits and dashes." actions={<Button size="sm" variant="soft" onClick={() => patch({ branches: [...d.branches, { code: '', name: '', address: null }] })}><Plus /> Add</Button>} />
            <Table>
              <THead>
                <tr>
                  <TH>Code</TH>
                  <TH>Name</TH>
                  <TH>Address</TH>
                  <TH className="w-10" />
                </tr>
              </THead>
              <tbody>
                {d.branches.map((b, i) => (
                  <TR key={i}>
                    <TD><Input aria-label="Branch code" className={`${cell} min-w-[110px]`} value={b.code} onChange={(e) => patch({ branches: d.branches.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase() } : x)) })} /></TD>
                    <TD><Input aria-label="Branch name" className={`${cell} min-w-[200px]`} value={b.name} onChange={(e) => patch({ branches: d.branches.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></TD>
                    <TD><Input aria-label="Address" className={wide} value={b.address ?? ''} onChange={(e) => patch({ branches: d.branches.map((x, j) => (j === i ? { ...x, address: e.target.value || null } : x)) })} /></TD>
                    <TD><Button size="icon-sm" variant="ghost" aria-label="Remove branch" onClick={() => patch({ branches: d.branches.filter((_, j) => j !== i) })}><Trash2 /></Button></TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Departments" description="Owner must be one of the users in the next step." actions={<Button size="sm" variant="soft" disabled={!branchCodes.length} onClick={() => patch({ departments: [...d.departments, { branchCode: branchCodes[0], name: '', ownerEmail: null }] })}><Plus /> Add</Button>} />
            <Table>
              <THead>
                <tr>
                  <TH>Branch</TH>
                  <TH>Department</TH>
                  <TH>Owner e-mail</TH>
                  <TH className="w-10" />
                </tr>
              </THead>
              <tbody>
                {d.departments.map((dep, i) => (
                  <TR key={i}>
                    <TD>
                      <NativeSelect aria-label="Branch" className={cell} value={dep.branchCode} onChange={(e) => patch({ departments: d.departments.map((x, j) => (j === i ? { ...x, branchCode: e.target.value } : x)) })}>
                        {branchCodes.map((c) => <option key={c}>{c}</option>)}
                      </NativeSelect>
                    </TD>
                    <TD><Input aria-label="Department name" className={`${cell} min-w-[200px]`} value={dep.name} onChange={(e) => patch({ departments: d.departments.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></TD>
                    <TD><Input aria-label="Owner e-mail" className={wide} value={dep.ownerEmail ?? ''} onChange={(e) => patch({ departments: d.departments.map((x, j) => (j === i ? { ...x, ownerEmail: e.target.value || null } : x)) })} /></TD>
                    <TD><Button size="icon-sm" variant="ghost" aria-label="Remove department" onClick={() => patch({ departments: d.departments.filter((_, j) => j !== i) })}><Trash2 /></Button></TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}

      {step === 2 && (
        <Card>
          <CardHeader
            title={`Users (${d.users.length})`}
            description="Leave Branch empty for organisation-wide access. Restricted permissions are removed from that person only, e.g. assessment:approve."
            actions={<Button size="sm" variant="soft" onClick={() => patch({ users: [...d.users, { name: '', email: '', designation: null, roleKey: 'CONTRIBUTOR', branchCode: null, department: null, restricted: [] }] })}><Plus /> Add user</Button>}
          />
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>E-mail</TH>
                <TH>Role</TH>
                <TH>Branch</TH>
                <TH>Department</TH>
                <TH>Restricted</TH>
                <TH className="w-10" />
              </tr>
            </THead>
            <tbody>
              {d.users.map((u, i) => {
                const set = (p: Partial<SetupUser>) => patch({ users: d.users.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                const depts = d.departments.filter((x) => x.branchCode === u.branchCode);
                return (
                  <TR key={i}>
                    <TD><Input aria-label="Name" className={cell} value={u.name} onChange={(e) => set({ name: e.target.value })} /></TD>
                    <TD><Input aria-label="E-mail" className={wide} value={u.email} onChange={(e) => set({ email: e.target.value })} /></TD>
                    <TD>
                      <NativeSelect aria-label="Role" className={`${cell} min-w-[210px]`} value={u.roleKey} onChange={(e) => set({ roleKey: e.target.value })}>
                        {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </NativeSelect>
                    </TD>
                    <TD>
                      <NativeSelect aria-label="Branch" className={cell} value={u.branchCode ?? ''} onChange={(e) => set({ branchCode: e.target.value || null, department: null })}>
                        <option value="">Whole org</option>
                        {branchCodes.map((c) => <option key={c}>{c}</option>)}
                      </NativeSelect>
                    </TD>
                    <TD>
                      <NativeSelect aria-label="Department" className={`${cell} min-w-[210px]`} disabled={!u.branchCode} value={u.department ?? ''} onChange={(e) => set({ department: e.target.value || null })}>
                        <option value="">All departments</option>
                        {depts.map((x) => <option key={x.name}>{x.name}</option>)}
                      </NativeSelect>
                    </TD>
                    <TD>
                      <Input aria-label="Restricted permissions" className={wide} placeholder="none" value={u.restricted.join(', ')} onChange={(e) => set({ restricted: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
                    </TD>
                    <TD><Button size="icon-sm" variant="ghost" aria-label="Remove user" onClick={() => patch({ users: d.users.filter((_, j) => j !== i) })}><Trash2 /></Button></TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader title="Checklist (optional)" description="Upload a checklist workbook in the Kauvery layout. Every worksheet with a 'Reports / Evidence Description' column becomes a draft checklist. The organisation's ISMS owner reviews and publishes it." />
          <CardBody className="flex flex-wrap items-center gap-3">
            <FilePick accept=".xlsx" label={checklistFile ? 'Choose another file' : 'Choose checklist workbook'} onFile={setChecklistFile} />
            {checklistFile ? (
              <Badge tone="brand">
                <FileSpreadsheet className="size-3.5" /> {checklistFile.name}
                <button className="ml-1" aria-label="Remove file" onClick={() => setChecklistFile(null)}>×</button>
              </Badge>
            ) : (
              <span className="text-sm text-muted">No file chosen. You can skip this step.</span>
            )}
          </CardBody>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader title="Review & create" />
          <CardBody className="space-y-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-muted">Organisation</dt><dd className="font-medium">{d.organisation.name}</dd></div>
              <div><dt className="text-xs text-muted">Branches / departments</dt><dd className="tabular">{d.branches.length} / {d.departments.length}</dd></div>
              <div><dt className="text-xs text-muted">Users</dt><dd className="tabular">{new Set(d.users.map((u) => u.email)).size} ({d.users.filter((u) => u.restricted.length).length} restricted)</dd></div>
              <div><dt className="text-xs text-muted">Checklist</dt><dd>{checklistFile?.name ?? 'None'}</dd></div>
            </dl>
            <label className="flex items-center gap-3 text-sm" htmlFor="o-invite">
              <Switch id="o-invite" checked={sendInvites} onCheckedChange={setSendInvites} />
              E-mail every user a set-password link (nobody is given a password)
            </label>
            {problems?.length === 0 && <p className="flex items-center gap-2 text-sm text-ok"><CheckCircle2 className="size-4" /> No problems found.</p>}
          </CardBody>
        </Card>
      )}

      <div className="flex justify-between gap-2">
        <Button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button variant="primary" disabled={!canNext} onClick={() => (setStep((s) => s + 1), step === 3 && check())}>
            Next: {STEPS[step + 1]}
          </Button>
        ) : (
          <Button variant="primary" loading={creating} disabled={!!problems?.length} onClick={create}>
            Create organisation
          </Button>
        )}
      </div>
    </div>
  );
}
