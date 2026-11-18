import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { passwordSchema } from '@/schemas/common';
import { Ban, MoreHorizontal, Plus, ShieldCheck, Trash2, UserCheck, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { usersService, type RoleAssignment } from '@/services/users.service';
import { organisationService } from '@/services/organisation.service';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, Table, TD, TH, THead, TR, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/display';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Checkbox, Field, Input, NativeSelect, Switch } from '@/components/ui/form-controls';
import { ConfirmDialog, EmptyState, ErrorState, LoadingRows, PageHeader, Pagination, SearchInput, usePaged } from '@/components/common';
import { ROLE_LABEL } from '@/constants/status';
import { formatDateTime } from '@/lib/utils';
import type { UserRow } from '@/types/api';

const roleSchema = z.object({ roleKey: z.string().min(1, 'Choose a role'), siteId: z.string().optional(), departmentId: z.string().optional() });
const userSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required'),
    email: z.string().trim().email('Valid e-mail required'),
    designation: z.string().trim().max(120).optional(),
    sendInvite: z.boolean(),
    // Only when no invitation is e-mailed: the administrator gives a starting password instead.
    password: z.string().optional(),
    roles: z.array(roleSchema).min(1, 'Assign at least one role'),
  })
  .superRefine((v, ctx) => {
    if (v.sendInvite) return;
    const r = passwordSchema.safeParse(v.password ?? '');
    if (!r.success) ctx.addIssue({ code: 'custom', path: ['password'], message: r.error.issues[0]?.message ?? 'Enter a starting password' });
  });
type UserForm = z.infer<typeof userSchema>;

const toAssignments = (roles: UserForm['roles']): RoleAssignment[] => roles.map((r) => ({ roleKey: r.roleKey, siteId: r.siteId || null, departmentId: r.departmentId || null }));

function RoleRows({ form }: { form: ReturnType<typeof useForm<UserForm>> }) {
  const org = useQuery({ queryKey: ['org'], queryFn: organisationService.current });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'roles' });
  return (
    <div className="space-y-3">
      {fields.map((f, i) => {
        const siteId = form.watch(`roles.${i}.siteId`);
        const site = org.data?.sites.find((s) => s.id === siteId);
        return (
          <div key={f.id} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[1.2fr_1fr_1fr_auto]">
            <NativeSelect aria-label="Role" {...form.register(`roles.${i}.roleKey`)}>
              <option value="">Role…</option>
              {Object.entries(ROLE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Site scope" {...form.register(`roles.${i}.siteId`, { onChange: () => form.setValue(`roles.${i}.departmentId`, '') })}>
              <option value="">All sites (organisation-wide)</option>
              {org.data?.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Department scope" disabled={!site} {...form.register(`roles.${i}.departmentId`)}>
              <option value="">All departments</option>
              {site?.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
            <Button type="button" size="icon" variant="ghost" aria-label="Remove role" onClick={() => remove(i)} disabled={fields.length === 1}>
              <Trash2 />
            </Button>
          </div>
        );
      })}
      <Button type="button" size="sm" variant="soft" onClick={() => append({ roleKey: '', siteId: '', departmentId: '' })}>
        <Plus /> Add role
      </Button>
      {form.formState.errors.roles?.message && <p className="text-xs text-bad">{form.formState.errors.roles.message}</p>}
    </div>
  );
}

function UserDialog({ user, open, onOpenChange }: { user?: UserRow; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const defaults = (): UserForm => ({
    name: user?.name ?? '',
    email: user?.email ?? '',
    designation: user?.designation ?? '',
    sendInvite: true,
    password: '',
    roles: user?.roles.map((r) => ({ roleKey: r.role.key, siteId: r.siteId ?? '', departmentId: r.departmentId ?? '' })) ?? [{ roleKey: '', siteId: '', departmentId: '' }],
  });
  const form = useForm<UserForm>({ resolver: zodResolver(userSchema), defaultValues: defaults() });
  // Start from a clean form every time the dialog opens (previously the last person's details stayed in it).
  useEffect(() => {
    if (open) form.reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user]);
  const m = useMutation({
    mutationFn: async (v: UserForm) => {
      if (user) {
        await usersService.update(user.id, { name: v.name, designation: v.designation || null });
        return usersService.setRoles(user.id, toAssignments(v.roles));
      }
      return usersService.create({ name: v.name, email: v.email, designation: v.designation || null, sendInvite: v.sendInvite, password: v.sendInvite ? undefined : v.password, roles: toAssignments(v.roles) });
    },
    onSuccess: (_r, v) => {
      toast.success(user ? 'User updated' : v.sendInvite ? 'User created — an invitation e-mail was sent' : 'User created with the starting password you gave');
      qc.invalidateQueries({ queryKey: ['users'] });
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader title={user ? `Edit ${user.name}` : 'Invite user'} description="Roles are granted within an organisation, site or department scope. The backend enforces these boundaries." />
        <form onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <DialogBody className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" required error={form.formState.errors.name?.message} htmlFor="u-name">
                <Input id="u-name" {...form.register('name')} />
              </Field>
              <Field label="E-mail" required error={form.formState.errors.email?.message} htmlFor="u-email">
                <Input id="u-email" type="email" disabled={!!user} {...form.register('email')} />
              </Field>
              <Field label="Designation" htmlFor="u-desig">
                <Input id="u-desig" {...form.register('designation')} />
              </Field>
              {!user && (
                <div className="flex items-center gap-3 pt-6">
                  <Switch id="u-invite" checked={form.watch('sendInvite')} onCheckedChange={(c) => form.setValue('sendInvite', c)} />
                  <label htmlFor="u-invite" className="text-sm">
                    E-mail a set-password link
                  </label>
                </div>
              )}
              {!user && !form.watch('sendInvite') && (
                <Field label="Starting password" required hint="Give it to the person privately; they can change it in Settings." error={form.formState.errors.password?.message} htmlFor="u-pw" className="sm:col-span-2">
                  <Input id="u-pw" type="password" autoComplete="new-password" {...form.register('password')} />
                </Field>
              )}
            </div>
            <div>
              <p className="mb-2 text-[13px] font-medium text-ink-2">Roles & scope</p>
              <RoleRows form={form} />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={m.isPending}>
              {user ? 'Save changes' : 'Create user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Limit power for a selected user": untick permissions their role grants to remove them from
 * this person only. The role itself is unchanged; the server enforces the restriction everywhere.
 */
function RestrictionsDialog({ user, onOpenChange }: { user: UserRow | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: usersService.roles, enabled: !!user });
  const granted = useMemo(() => {
    const keys = new Set(user?.roles.map((r) => r.role.key));
    return new Set((roles.data ?? []).filter((r) => keys.has(r.key)).flatMap((r) => r.permissions));
  }, [roles.data, user]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (user) {
      setRemoved(new Set(user.restrictions.map((r) => r.permission)));
      setUntil(user.restrictions.find((r) => r.expiresAt)?.expiresAt?.slice(0, 10) ?? '');
      setReason('');
    }
  }, [user]);
  const resources = useMemo(() => [...new Set([...granted].map((k) => k.split(':')[0]))].sort(), [granted]);
  const save = useMutation({
    mutationFn: () => usersService.setRestrictions(user!.id, [...removed].map((permission) => ({ permission, expiresAt: until ? new Date(`${until}T23:59:59`).toISOString() : null })), reason.trim()),
    onSuccess: () => {
      toast.success(removed.size ? `${removed.size} permission(s) restricted for ${user!.name}` : `All restrictions lifted for ${user!.name}`);
      qc.invalidateQueries({ queryKey: ['users'] });
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader title={`Restrict permissions · ${user?.name ?? ''}`} description="Ticked = allowed by their role. Untick to remove that permission from this person only. Their role stays the same, and the change is audited." />
        <DialogBody className="space-y-4">
          {roles.isLoading ? (
            <LoadingRows rows={4} />
          ) : (
            <div className="overflow-x-auto rounded-md border border-line">
              <Table>
                <THead>
                  <tr>
                    <TH>Area</TH>
                    {ACTIONS.map((a) => (
                      <TH key={a} className="px-2 text-center capitalize">
                        {a}
                      </TH>
                    ))}
                  </tr>
                </THead>
                <tbody>
                  {resources.map((res) => (
                    <TR key={res}>
                      <TD className="capitalize">{res.replace('_', ' ')}</TD>
                      {ACTIONS.map((a) => {
                        const key = `${res}:${a}`;
                        if (!granted.has(key)) return <TD key={a} className="px-2 text-center text-faint">·</TD>;
                        const allowed = !removed.has(key);
                        return (
                          <TD key={a} className={`px-2 text-center ${allowed ? '' : 'bg-bad-soft'}`}>
                            <Checkbox
                              aria-label={key}
                              checked={allowed}
                              onCheckedChange={(c) =>
                                setRemoved((s) => {
                                  const n = new Set(s);
                                  if (c) n.delete(key);
                                  else n.add(key);
                                  return n;
                                })
                              }
                            />
                          </TD>
                        );
                      })}
                    </TR>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Restriction ends (optional)" htmlFor="r-until" hint="Leave empty to keep it until an administrator lifts it.">
              <Input id="r-until" type="date" value={until} min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)} onChange={(e) => setUntil(e.target.value)} />
            </Field>
            <Field label="Reason" required htmlFor="r-reason" hint="Recorded in the audit trail.">
              <Input id="r-reason" value={reason} placeholder="e.g. Trainee: shadow reviews only" onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
          <p className="text-[13px] text-muted">{removed.size ? `${removed.size} permission(s) will be removed.` : 'No permissions removed.'}</p>
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={reason.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()}>
            Save restrictions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UsersTab() {
  const { can, user: me } = useAuth();
  const qc = useQueryClient();
  const [params, set] = usePaged({ search: '', role: '', status: '' });
  const q = useQuery({ queryKey: ['users', params], queryFn: () => usersService.list(params) });
  const [dlg, setDlg] = useState<{ open: boolean; user?: UserRow }>({ open: false });
  const [statusTarget, setStatusTarget] = useState<UserRow | null>(null);
  const [restrictTarget, setRestrictTarget] = useState<UserRow | null>(null);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 p-5">
        <SearchInput value={params.search as string} onChange={(v) => set({ search: v })} placeholder="Search name or e-mail" className="w-full max-w-xs" />
        <NativeSelect aria-label="Role filter" className="w-56" value={params.role as string} onChange={(e) => set({ role: e.target.value })}>
          <option value="">All roles</option>
          {Object.entries(ROLE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Status filter" className="w-40" value={params.status as string} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Any status</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </NativeSelect>
        {can('user:create') && (
          <Button variant="primary" className="ml-auto" onClick={() => setDlg({ open: true })}>
            <Plus /> Invite user
          </Button>
        )}
      </div>
      {q.isLoading ? (
        <LoadingRows />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.data.length ? (
        <EmptyState title="No users match these filters" />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH>User</TH>
                <TH>Roles & scope</TH>
                <TH>MFA</TH>
                <TH>Last sign-in</TH>
                <TH>Status</TH>
                <TH className="w-12" />
              </tr>
            </THead>
            <tbody>
              {q.data.data.map((u) => (
                <TR key={u.id}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} size={36} />
                      <div>
                        <p className="font-medium">{u.name}</p>
                        <p className="text-xs text-muted">
                          {u.email}
                          {u.designation ? ` · ${u.designation}` : ''}
                        </p>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <div className="flex flex-col gap-1">
                      {u.roles.map((r) => (
                        <span key={r.id} className="text-[13px]">
                          <span className="font-medium">{ROLE_LABEL[r.role.key] ?? r.role.name}</span>
                          <span className="text-muted"> · {r.site ? `${r.site.name}${r.department ? ` / ${r.department.name}` : ''}` : 'Organisation-wide'}</span>
                        </span>
                      ))}
                      {u.restrictions.length > 0 && (
                        <span title={u.restrictions.map((r) => `${r.permission}${r.expiresAt ? ` until ${r.expiresAt.slice(0, 10)}` : ''}`).join('\n')}>
                          <Badge tone="warn">{u.restrictions.length} restricted</Badge>
                        </span>
                      )}
                    </div>
                  </TD>
                  <TD>{u.mfaEnabled ? <Badge tone="ok">Enabled</Badge> : <Badge>Off</Badge>}</TD>
                  <TD className="text-[13px] text-muted">{formatDateTime(u.lastLoginAt)}</TD>
                  <TD>
                    {/* An active account that has never signed in is still waiting on its invitation. */}
                    {u.status !== 'ACTIVE' ? (
                      <Badge dot>Inactive</Badge>
                    ) : u.lastLoginAt ? (
                      <Badge tone="ok" dot>
                        Active
                      </Badge>
                    ) : (
                      <Badge tone="warn" dot>
                        Invited
                      </Badge>
                    )}
                  </TD>
                  <TD>
                    {(can('user:update') || can('role:assign')) && u.canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${u.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => setDlg({ open: true, user: u })}>
                            <ShieldCheck /> Edit details & roles
                          </DropdownMenuItem>
                          {can('role:assign', 'user:assign') && (
                            <DropdownMenuItem onSelect={() => setRestrictTarget(u)}>
                              <Ban /> Restrict permissions
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem destructive={u.status === 'ACTIVE'} onSelect={() => setStatusTarget(u)}>
                            {u.status === 'ACTIVE' ? <UserX /> : <UserCheck />} {u.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {u.id === me?.id && <span className="text-xs text-faint">You</span>}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <Pagination {...q.data.meta} onPage={(p) => set({ page: p })} />
        </>
      )}
      <UserDialog open={dlg.open} user={dlg.user} onOpenChange={(o) => setDlg((s) => ({ ...s, open: o }))} />
      <RestrictionsDialog user={restrictTarget} onOpenChange={(o) => !o && setRestrictTarget(null)} />
      <ConfirmDialog
        open={!!statusTarget}
        onOpenChange={(o) => !o && setStatusTarget(null)}
        title={statusTarget?.status === 'ACTIVE' ? `Deactivate ${statusTarget?.name}?` : `Reactivate ${statusTarget?.name}?`}
        description={statusTarget?.status === 'ACTIVE' ? 'Sessions are revoked immediately and the user can no longer sign in.' : 'The user will be able to sign in again.'}
        confirmLabel={statusTarget?.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
        tone={statusTarget?.status === 'ACTIVE' ? 'danger' : 'primary'}
        reasonLabel="Reason"
        onConfirm={async (reason) => {
          await usersService.setStatus(statusTarget!.id, statusTarget!.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', reason);
          toast.success('User status updated');
          qc.invalidateQueries({ queryKey: ['users'] });
        }}
      />
    </Card>
  );
}

const ACTIONS = ['create', 'read', 'update', 'delete', 'assign', 'submit', 'review', 'approve', 'export', 'reopen'];

function RolesTab() {
  const { can, user: me } = useAuth();
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: usersService.roles });
  const perms = useQuery({ queryKey: ['permissions'], queryFn: usersService.permissions });
  const [roleId, setRoleId] = useState('');
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const role = roles.data?.find((r) => r.id === roleId) ?? roles.data?.[0];
  useEffect(() => {
    if (role) setDraft(new Set(role.permissions));
  }, [role]);
  const resources = useMemo(() => [...new Set(perms.data?.map((p) => p.resource))], [perms.data]);
  // Role permissions apply to this organisation only; only organisation-wide administrators change them.
  const editable = can('role:update') && role?.key !== 'SYSTEM_ADMIN' && !!me?.scopes.some((s) => s.siteId === null && s.role === 'SYSTEM_ADMIN');
  const dirty = role && (draft.size !== role.permissions.length || role.permissions.some((p) => !draft.has(p)));
  const save = useMutation({
    mutationFn: () => usersService.setRolePermissions(role!.id, [...draft]),
    onSuccess: () => {
      toast.success('Permissions updated and recorded in the audit trail');
      qc.invalidateQueries({ queryKey: ['roles'] });
    },
  });
  if (roles.isLoading || perms.isLoading) return <Card><LoadingRows /></Card>;
  if (roles.isError) return <ErrorState error={roles.error} onRetry={() => roles.refetch()} />;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)] [&>*]:min-w-0">
      <Card className="p-2">
        {roles.data!.map((r) => (
          <button key={r.id} onClick={() => setRoleId(r.id)} className={`w-full rounded-md px-3 py-2.5 text-left ${role?.id === r.id ? 'bg-brand-soft' : 'hover:bg-subtle'}`}>
            <p className={`text-sm font-medium ${role?.id === r.id ? 'text-brand-ink' : ''}`}>{r.name}</p>
            <p className="text-xs text-muted">
              {r._count.userRoles} user(s) · {r.permissions.length} permissions
            </p>
          </button>
        ))}
      </Card>
      {role && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3 p-5">
            <div>
              <h3 className="text-[17px] font-semibold">{role.name}</h3>
              <p className="text-[13px] text-muted">{role.description}</p>
              {role.key === 'SYSTEM_ADMIN' && <p className="mt-1 text-xs text-warn">Administrator permissions are protected to prevent lock-out.</p>}
            </div>
            {editable && (
              <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
                Save permissions
              </Button>
            )}
          </div>
          <Table>
            <THead>
              <tr>
                <TH>Resource</TH>
                {ACTIONS.map((a) => (
                  <TH key={a} className="px-2 text-center capitalize">
                    {a}
                  </TH>
                ))}
              </tr>
            </THead>
            <tbody>
              {resources.map((res) => (
                <TR key={res}>
                  <TD className="capitalize">{res.replace('_', ' ')}</TD>
                  {ACTIONS.map((a) => {
                    const key = `${res}:${a}`;
                    return (
                      <TD key={a} className="px-2 text-center">
                        <Checkbox
                          aria-label={key}
                          checked={draft.has(key)}
                          disabled={!editable}
                          onCheckedChange={(c) =>
                            setDraft((d) => {
                              const n = new Set(d);
                              if (c) n.add(key);
                              else n.delete(key);
                              return n;
                            })
                          }
                        />
                      </TD>
                    );
                  })}
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

export function UsersPage() {
  return (
    <div>
      <PageHeader title="Users & Access Control" description="Unique accounts only — shared accounts are prohibited (SRS 2.3). Every role and permission change is audited." />
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="roles">Roles & permissions</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <UsersTab />
        </TabsContent>
        <TabsContent value="roles">
          <RolesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
