import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FileSpreadsheet, ListChecks, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { checklistsService } from '@/services/checklists.service';
import { importsService } from '@/services/imports.service';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge, Card, Table, TD, TH, THead, TR, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/display';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/overlays';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/form-controls';
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination, SearchInput, StatusBadge, usePaged } from '@/components/common';
import { CHECKLIST_STATUS } from '@/constants/status';
import { formatBytes, formatDate, formatDateTime } from '@/lib/utils';

const schema = z.object({ title: z.string().trim().min(3, 'Title needs at least 3 characters'), description: z.string().max(2000).optional(), category: z.string().max(120).optional() });

function NewChecklistDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { title: '', description: '', category: 'ISO/IEC 27001:2022' } });
  const m = useMutation({
    mutationFn: checklistsService.create,
    onSuccess: async (t) => {
      toast.success('Checklist created as draft version 1');
      qc.invalidateQueries({ queryKey: ['checklists'] });
      const full = await checklistsService.get(t.id);
      navigate(`/checklists/${t.id}/versions/${full.versions[0].id}`);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title="New checklist" description="Starts as Draft v1. Add questions, map controls, then submit for review and publish." />
        <form onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <DialogBody className="space-y-4">
            <Field label="Title" required error={form.formState.errors.title?.message} htmlFor="c-title">
              <Input id="c-title" {...form.register('title')} />
            </Field>
            <Field label="Category" htmlFor="c-cat">
              <Input id="c-cat" {...form.register('category')} />
            </Field>
            <Field label="Description" htmlFor="c-desc">
              <Textarea id="c-desc" {...form.register('description')} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={m.isPending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportHistory() {
  const [params, set] = usePaged({}, { prefix: "imports" });
  const q = useQuery({ queryKey: ['imports', params], queryFn: () => importsService.list(params) });
  return (
    <Card>
      {q.isLoading ? (
        <LoadingRows />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.data.length ? (
        <EmptyState icon={FileSpreadsheet} title="No imports yet" />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH>File</TH>
                <TH>Worksheets</TH>
                <TH>Uploaded</TH>
                <TH>Status</TH>
                <TH>Created checklists</TH>
              </tr>
            </THead>
            <tbody>
              {q.data.data.map((i) => (
                <TR key={i.id}>
                  <TD>
                    <Link to={`/checklists/import/${i.id}`} className="font-medium hover:text-brand">
                      {i.fileName}
                    </Link>
                    <p className="text-xs text-muted">
                      {formatBytes(i.fileSize)} · SHA-256 {i.checksum.slice(0, 12)}…
                    </p>
                  </TD>
                  <TD className="text-[13px]">
                    {i.sheetSummary.map((s) => (
                      <p key={s.sheetName}>
                        {s.sheetName} <span className="text-muted">({s.counts.rows} rows)</span>
                      </p>
                    ))}
                  </TD>
                  <TD className="text-[13px] text-muted">
                    {formatDateTime(i.createdAt)}
                    <br />
                    {i.uploadedBy?.name}
                  </TD>
                  <TD>
                    <Badge tone={i.status === 'CONFIRMED' ? 'ok' : i.status === 'PREVIEW' ? 'warn' : 'neutral'} dot>
                      {i.status === 'PREVIEW' ? 'Awaiting confirmation' : i.status.toLowerCase()}
                    </Badge>
                  </TD>
                  <TD className="text-[13px]">
                    {i.versions.length
                      ? i.versions.map((v) => (
                          <Link key={v.id} to={`/checklists/${v.template.id}`} className="block text-brand hover:underline">
                            {v.template.title}
                          </Link>
                        ))
                      : '—'}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <Pagination {...q.data.meta} onPage={(p) => set({ page: p })} />
        </>
      )}
    </Card>
  );
}

export function ChecklistsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, set] = usePaged({ search: '', status: '' });
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['checklists', params], queryFn: () => checklistsService.list(params) });
  return (
    <div>
      <PageHeader
        title="Checklist Library"
        description="Centralised, version-controlled ISO/IEC 27001:2022 checklists. Published versions are immutable; changes create a new version."
        actions={
          can('checklist:create') && (
            <>
              <Button onClick={() => navigate('/checklists/import')}>
                <FileSpreadsheet /> Import from Excel
              </Button>
              <Button variant="primary" onClick={() => setOpen(true)}>
                <Plus /> New checklist
              </Button>
            </>
          )
        }
      />
      <Tabs defaultValue="library">
        <TabsList>
          <TabsTrigger value="library">Checklists</TabsTrigger>
          {can('checklist:create') && <TabsTrigger value="imports">Import history</TabsTrigger>}
        </TabsList>
        <TabsContent value="library">
          <Card>
            <div className="flex flex-wrap gap-3 p-5">
              <SearchInput value={params.search as string} onChange={(v) => set({ search: v })} placeholder="Search checklists" className="w-full max-w-sm" />
              <NativeSelect aria-label="Version status" className="w-48" value={params.status as string} onChange={(e) => set({ status: e.target.value })}>
                <option value="">Any version status</option>
                {Object.entries(CHECKLIST_STATUS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {q.isLoading ? (
              <LoadingRows />
            ) : q.isError ? (
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            ) : !q.data?.data.length ? (
              <EmptyState icon={ListChecks} title="No checklists found" description="Create a checklist or import the hospital's Excel checklist." />
            ) : (
              <>
                <Table>
                  <THead>
                    <tr>
                      <TH>Checklist</TH>
                      <TH>Latest version</TH>
                      <TH>Published</TH>
                      <TH>Questions</TH>
                      <TH>Assessments</TH>
                      <TH>Updated</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {q.data.data.map((t) => {
                      const latest = t.versions[0];
                      const published = t.versions.find((v) => v.status === 'PUBLISHED');
                      return (
                        <TR key={t.id} className="cursor-pointer hover:bg-subtle" onClick={() => navigate(`/checklists/${t.id}`)}>
                          <TD>
                            <div className="flex items-center gap-3">
                              <span className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand">
                                <ListChecks className="size-[18px]" />
                              </span>
                              <div className="min-w-0">
                                <p className="truncate font-medium">{t.title}</p>
                                <p className="truncate text-xs text-muted">{t.category ?? 'Uncategorised'}</p>
                              </div>
                            </div>
                          </TD>
                          <TD>
                            <span className="mr-2 font-medium">v{latest?.versionNumber}</span>
                            {latest && <StatusBadge map={CHECKLIST_STATUS} value={latest.status} />}
                          </TD>
                          <TD className="text-[13px]">{published ? `v${published.versionNumber} · ${formatDate(published.publishedAt)}` : <span className="text-muted">Not published</span>}</TD>
                          <TD className="tabular">{latest?._count?.items ?? 0}</TD>
                          <TD className="tabular">{t.versions.reduce((n, v) => n + (v._count?.assessments ?? 0), 0)}</TD>
                          <TD className="text-[13px] text-muted">{formatDate(t.updatedAt)}</TD>
                        </TR>
                      );
                    })}
                  </tbody>
                </Table>
                <Pagination {...q.data.meta} onPage={(p) => set({ page: p })} />
              </>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="imports">
          <ImportHistory />
        </TabsContent>
      </Tabs>
      <NewChecklistDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
