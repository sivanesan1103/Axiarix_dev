import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { findingsService } from '@/services/findings.service';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/overlays';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/form-controls';
import { UserSelect } from '@/components/common/pickers';
import { FINDING_CATEGORY, SEVERITY } from '@/constants/status';

const schema = z.object({
  category: z.string().min(1),
  severity: z.string().min(1),
  title: z.string().trim().min(3, 'Title is required'),
  description: z.string().trim().min(5, 'Describe the gap (5+ characters)'),
  auditorComments: z.string().max(4000).optional(),
  ownerId: z.string().optional(),
  dueDate: z.string().min(1, 'Due date is required'),
});
type Form = z.infer<typeof schema>;

/** Auditor raises a finding against an assessment (optionally a specific question). */
export function FindingDialog({ open, onOpenChange, assessmentId, itemId, itemLabel, siteId, defaultOwnerId }: { open: boolean; onOpenChange: (o: boolean) => void; assessmentId: string; itemId?: string | null; itemLabel?: string; siteId?: string; defaultOwnerId?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const form = useForm<Form>({ resolver: zodResolver(schema), values: { category: 'MINOR_NONCONFORMITY', severity: 'MEDIUM', title: '', description: '', auditorComments: '', ownerId: defaultOwnerId ?? '', dueDate: due } });
  const m = useMutation({
    mutationFn: (v: Form) => findingsService.create({ ...v, assessmentId, itemId: itemId ?? null, ownerId: v.ownerId || null, auditorComments: v.auditorComments || null }),
    onSuccess: (f) => {
      toast.success(`Finding ${f.code} raised`, { action: { label: 'Open', onClick: () => navigate(`/findings/${f.id}`) } });
      qc.invalidateQueries({ queryKey: ['findings'] });
      qc.invalidateQueries({ queryKey: ['assessment-item'] });
      qc.invalidateQueries({ queryKey: ['assessment', assessmentId] });
      form.reset();
      onOpenChange(false);
    },
  });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader title="Raise finding" description={itemLabel ? `Against ${itemLabel}` : 'Assessment-level finding'} />
        <form onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" required htmlFor="f-cat">
              <NativeSelect id="f-cat" {...form.register('category')}>
                {Object.entries(FINDING_CATEGORY).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Severity" required htmlFor="f-sev">
              <NativeSelect id="f-sev" {...form.register('severity')}>
                {Object.entries(SEVERITY).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Title" required className="sm:col-span-2" error={e.title?.message} htmlFor="f-title">
              <Input id="f-title" {...form.register('title')} />
            </Field>
            <Field label="Description" required className="sm:col-span-2" error={e.description?.message} htmlFor="f-desc">
              <Textarea id="f-desc" rows={3} {...form.register('description')} />
            </Field>
            <Field label="Auditor comments" className="sm:col-span-2" htmlFor="f-com">
              <Textarea id="f-com" rows={2} {...form.register('auditorComments')} />
            </Field>
            <Field label="Owner" htmlFor="f-owner" hint="Leave empty to route to the department owner.">
              <UserSelect id="f-owner" value={form.watch('ownerId') ?? ''} onChange={(v) => form.setValue('ownerId', v)} roles={['IT_OWNER', 'CONTRIBUTOR']} siteId={siteId} placeholder="Department owner" />
            </Field>
            <Field label="Due date" required error={e.dueDate?.message} htmlFor="f-due">
              <Input id="f-due" type="date" {...form.register('dueDate')} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={m.isPending}>
              Raise finding
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
