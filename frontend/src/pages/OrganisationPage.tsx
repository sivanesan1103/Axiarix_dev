import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, MapPin, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { organisationService } from '@/services/organisation.service';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, Table, TD, TH, THead, TR } from '@/components/ui/display';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/overlays';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/form-controls';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/common';
import { UserSelect } from '@/components/common/pickers';
import type { Department, Site } from '@/types/api';

const siteSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  code: z.string().trim().min(2, 'Code is required').regex(/^[A-Z0-9-]+$/, 'Upper-case letters, digits and dashes only'),
  address: z.string().trim().max(500).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});
const deptSchema = z.object({ name: z.string().trim().min(2, 'Name is required'), ownerId: z.string().optional(), status: z.enum(['ACTIVE', 'INACTIVE']) });

function SiteDialog({ site, open, onOpenChange }: { site?: Site; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const form = useForm<z.infer<typeof siteSchema>>({ resolver: zodResolver(siteSchema), values: { name: site?.name ?? '', code: site?.code ?? '', address: site?.address ?? '', status: site?.status ?? 'ACTIVE' } });
  const m = useMutation({
    mutationFn: (v: z.infer<typeof siteSchema>) => (site ? organisationService.updateSite(site.id, v) : organisationService.createSite(v)),
    onSuccess: () => {
      toast.success(site ? 'Branch updated' : 'Branch created');
      qc.invalidateQueries({ queryKey: ['org'] });
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title={site ? 'Edit branch / site' : 'Add branch / site'} description="Branch identity is preserved on every assessment, evidence file and report." />
        <form onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required error={form.formState.errors.name?.message} htmlFor="s-name">
              <Input id="s-name" {...form.register('name')} />
            </Field>
            <Field label="Code" required error={form.formState.errors.code?.message} htmlFor="s-code">
              <Input id="s-code" {...form.register('code', { setValueAs: (v: string) => v.toUpperCase() })} />
            </Field>
            <Field label="Address" className="sm:col-span-2" htmlFor="s-addr">
              <Textarea id="s-addr" rows={2} {...form.register('address')} />
            </Field>
            <Field label="Status" htmlFor="s-status">
              <NativeSelect id="s-status" {...form.register('status')}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </NativeSelect>
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

function DeptDialog({ siteId, dept, open, onOpenChange }: { siteId: string; dept?: Department; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const form = useForm<z.infer<typeof deptSchema>>({ resolver: zodResolver(deptSchema), values: { name: dept?.name ?? '', ownerId: dept?.ownerId ?? '', status: dept?.status ?? 'ACTIVE' } });
  const m = useMutation({
    mutationFn: (v: z.infer<typeof deptSchema>) => {
      const body = { name: v.name, ownerId: v.ownerId || null, status: v.status };
      return dept ? organisationService.updateDepartment(dept.id, body) : organisationService.createDepartment({ siteId, name: v.name, ownerId: v.ownerId || null });
    },
    onSuccess: () => {
      toast.success(dept ? 'Department updated' : 'Department created');
      qc.invalidateQueries({ queryKey: ['org'] });
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title={dept ? 'Edit department' : 'Add department'} />
        <form onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <DialogBody className="space-y-4">
            <Field label="Department name" required error={form.formState.errors.name?.message} htmlFor="d-name">
              <Input id="d-name" {...form.register('name')} />
            </Field>
            <Field label="Department owner" hint="Receives assessment assignments for this department." htmlFor="d-owner">
              <UserSelect id="d-owner" value={form.watch('ownerId') ?? ''} onChange={(v) => form.setValue('ownerId', v)} roles={['IT_OWNER', 'ISMS_OWNER', 'SYSTEM_ADMIN']} siteId={siteId} placeholder="No owner" />
            </Field>
            {dept && (
              <Field label="Status" htmlFor="d-status">
                <NativeSelect id="d-status" {...form.register('status')}>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </NativeSelect>
              </Field>
            )}
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

export function OrganisationPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['org'], queryFn: organisationService.current });
  const [siteDlg, setSiteDlg] = useState<{ open: boolean; site?: Site }>({ open: false });
  const [deptDlg, setDeptDlg] = useState<{ open: boolean; siteId: string; dept?: Department }>({ open: false, siteId: '' });
  const [orgEdit, setOrgEdit] = useState(false);
  const orgForm = useForm<{ name: string; legalEntity: string }>({ values: { name: q.data?.name ?? '', legalEntity: q.data?.legalEntity ?? '' } });
  const orgM = useMutation({
    mutationFn: (v: { name: string; legalEntity: string }) => organisationService.update(q.data!.id, v),
    onSuccess: () => {
      toast.success('Organisation updated');
      qc.invalidateQueries({ queryKey: ['org'] });
      setOrgEdit(false);
    },
  });
  const canEdit = can('organisation:update');

  return (
    <div>
      <PageHeader
        title="Hospitals & Branches"
        description="Organisation, branches/sites and departments. Data and evidence are partitioned by branch."
        actions={can('organisation:create') && (
          <Button variant="primary" onClick={() => setSiteDlg({ open: true })}>
            <Plus /> Add branch
          </Button>
        )}
      />
      {q.isLoading ? (
        <Card>
          <LoadingRows />
        </Card>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-6">
          <Card className="flex flex-wrap items-center gap-5 p-5">
            <span className="flex size-12 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <Building2 className="size-6" />
            </span>
            {orgEdit ? (
              <form className="flex flex-1 flex-wrap items-end gap-3" onSubmit={orgForm.handleSubmit((v) => orgM.mutate(v))}>
                <Field label="Organisation name" className="min-w-60 flex-1">
                  <Input {...orgForm.register('name', { required: true, minLength: 2 })} />
                </Field>
                <Field label="Legal entity" className="min-w-60 flex-1">
                  <Input {...orgForm.register('legalEntity')} />
                </Field>
                <Button type="button" onClick={() => setOrgEdit(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={orgM.isPending}>
                  Save
                </Button>
              </form>
            ) : (
              <>
                <div className="flex-1">
                  <p className="text-lg font-semibold">{q.data!.name}</p>
                  <p className="text-sm text-muted">
                    {q.data!.legalEntity ?? 'Legal entity not set'} · {q.data!.sites.length} branch(es)
                  </p>
                </div>
                <Badge tone={q.data!.status === 'ACTIVE' ? 'ok' : 'neutral'} dot>
                  {q.data!.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                </Badge>
                {canEdit && (
                  <Button size="sm" onClick={() => setOrgEdit(true)}>
                    <Pencil /> Edit
                  </Button>
                )}
              </>
            )}
          </Card>

          {!q.data!.sites.length ? (
            <Card>
              <EmptyState title="No branches yet" description="Add the pilot site to begin." />
            </Card>
          ) : (
            q.data!.sites.map((s) => (
              <Card key={s.id}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      {s.name} <Badge>{s.code}</Badge>
                      {s.status === 'INACTIVE' && <Badge tone="warn">Inactive</Badge>}
                    </span>
                  }
                  description={
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3.5" /> {s.address || 'No address'} · {s._count?.assessments ?? 0} assessment(s)
                    </span>
                  }
                  actions={
                    canEdit && (
                      <>
                        <Button size="sm" onClick={() => setSiteDlg({ open: true, site: s })}>
                          <Pencil /> Edit branch
                        </Button>
                        <Button size="sm" variant="soft" onClick={() => setDeptDlg({ open: true, siteId: s.id })}>
                          <Plus /> Department
                        </Button>
                      </>
                    )
                  }
                />
                {s.departments.length ? (
                  <Table>
                    <THead>
                      <tr>
                        <TH>Department</TH>
                        <TH>Owner</TH>
                        <TH>Status</TH>
                        <TH className="w-24" />
                      </tr>
                    </THead>
                    <tbody>
                      {s.departments.map((d) => (
                        <TR key={d.id}>
                          <TD className="font-medium">{d.name}</TD>
                          <TD>{d.owner ? `${d.owner.name} (${d.owner.email})` : <span className="text-muted">Not assigned</span>}</TD>
                          <TD>
                            <Badge tone={d.status === 'ACTIVE' ? 'ok' : 'neutral'} dot>
                              {d.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                            </Badge>
                          </TD>
                          <TD className="text-right">
                            {canEdit && (
                              <Button size="sm" variant="ghost" onClick={() => setDeptDlg({ open: true, siteId: s.id, dept: d })}>
                                Edit
                              </Button>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <EmptyState className="py-8" title="No departments" />
                )}
              </Card>
            ))
          )}
        </div>
      )}
      <SiteDialog open={siteDlg.open} site={siteDlg.site} onOpenChange={(o) => setSiteDlg((s) => ({ ...s, open: o }))} />
      <DeptDialog open={deptDlg.open} siteId={deptDlg.siteId} dept={deptDlg.dept} onOpenChange={(o) => setDeptDlg((s) => ({ ...s, open: o }))} />
    </div>
  );
}
