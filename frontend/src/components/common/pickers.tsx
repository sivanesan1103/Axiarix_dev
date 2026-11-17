import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileUp, Loader2, UploadCloud } from 'lucide-react';
import { NativeSelect } from '@/components/ui/form-controls';
import { Progress } from '@/components/ui/display';
import { usersService } from '@/services/users.service';
import { cn, formatBytes } from '@/lib/utils';
import { ROLE_LABEL } from '@/constants/status';

/** Active-user picker backed by the directory endpoint, optionally filtered by role keys. */
/**
 * Person picker. With siteId (and departmentId) it lists only people whose role covers that branch and
 * department, the same rule the server applies, so a task never goes to someone who cannot open it.
 */
export function UserSelect({ value, onChange, roles, placeholder = 'Select a person', id, allowEmpty = true, siteId, departmentId }: { value: string; onChange: (v: string) => void; roles?: string[]; placeholder?: string; id?: string; allowEmpty?: boolean; siteId?: string; departmentId?: string }) {
  const q = useQuery({ queryKey: ['directory', roles?.join(',') ?? ''], queryFn: () => usersService.directory(roles?.join(',')) });
  const users = (q.data ?? []).filter(
    (u) => !siteId || u.roles.some((r) => (!roles || roles.includes(r.role.key)) && (r.siteId === null || r.siteId === siteId) && (!departmentId || r.departmentId === null || r.departmentId === departmentId)),
  );
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={q.isLoading}>
      {allowEmpty && <option value="">{q.isLoading ? 'Loading…' : placeholder}</option>}
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name} — {u.roles.map((r) => ROLE_LABEL[r.role.key] ?? r.role.key).join(', ')}
        </option>
      ))}
    </NativeSelect>
  );
}

export const EVIDENCE_ACCEPT = '.pdf,.docx,.xlsx,.csv,.png,.jpg,.jpeg';

/** Drag-and-drop file picker with client-side pre-checks (the server re-validates everything). */
export function FileDrop({ onFile, accept = EVIDENCE_ACCEPT, maxMb = 25, busy, progress, file, hint }: { onFile: (f: File | null) => void; accept?: string; maxMb?: number; busy?: boolean; progress?: number; file?: File | null; hint?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = (f?: File | null) => {
    setError(null);
    if (!f) return onFile(null);
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!accept.split(',').map((a) => a.replace('.', '')).includes(ext)) return setError(`.${ext} files are not allowed`);
    if (f.size > maxMb * 1024 * 1024) return setError(`File is larger than ${maxMb} MB`);
    onFile(f);
  };
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && ref.current?.click()}
        onClick={() => !busy && ref.current?.click()}
        onDragOver={(e: DragEvent) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setDrag(false);
          pick(e.dataTransfer.files?.[0]);
        }}
        className={cn('flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center transition-colors', drag ? 'border-brand bg-brand-soft' : 'border-line-strong hover:bg-subtle', busy && 'pointer-events-none opacity-70')}
      >
        {busy ? <Loader2 className="mb-2 size-6 animate-spin text-brand" /> : file ? <FileUp className="mb-2 size-6 text-brand" /> : <UploadCloud className="mb-2 size-6 text-muted" />}
        {file ? (
          <p className="text-sm font-medium">
            {file.name} <span className="font-normal text-muted">· {formatBytes(file.size)}</span>
          </p>
        ) : (
          <p className="text-sm">
            <span className="font-medium text-brand">Choose a file</span> or drag it here
          </p>
        )}
        <p className="mt-1 text-xs text-muted">{hint ?? `PDF, DOCX, XLSX, CSV, PNG or JPG · up to ${maxMb} MB · scanned for malware`}</p>
        <input ref={ref} type="file" className="hidden" accept={accept} data-testid="file-input" onChange={(e: ChangeEvent<HTMLInputElement>) => pick(e.target.files?.[0])} />
      </div>
      {busy && progress !== undefined && <Progress value={progress} className="mt-2" />}
      {error && <p className="mt-1.5 text-xs text-bad">{error}</p>}
    </div>
  );
}
