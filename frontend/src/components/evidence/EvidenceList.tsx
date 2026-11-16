import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, FileText, History, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { evidenceService, type UploadMeta } from '@/services/evidence.service';
import { errorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/display';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/overlays';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/form-controls';
import { FileDrop } from '@/components/common/pickers';
import { StatusBadge } from '@/components/common';
import { CLASSIFICATION, EVIDENCE_STATUS, SCAN_STATUS } from '@/constants/status';
import { formatBytes, formatDateTime } from '@/lib/utils';
import type { EvidenceRow, EvidenceVersion } from '@/types/api';

type Ev = Pick<EvidenceRow, 'id' | 'code' | 'title' | 'verificationStatus' | 'currentVersion'> & { verificationNote?: string | null; versions: Pick<EvidenceVersion, 'originalFilename' | 'scanStatus' | 'size'>[] & Partial<EvidenceVersion>[]; uploader?: { name: string }; createdAt?: string };

/** Upload dialog used for question evidence, finding evidence and corrective-action closure evidence. */
export function UploadEvidenceDialog({ open, onOpenChange, link, evidenceId, onUploaded }: { open: boolean; onOpenChange: (o: boolean) => void; link?: UploadMeta; evidenceId?: string; onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [classification, setClassification] = useState('INTERNAL');
  const [progress, setProgress] = useState(0);
  const m = useMutation({
    mutationFn: async () => {
      if (evidenceId) await evidenceService.uploadVersion(evidenceId, file!, description, setProgress);
      else await evidenceService.upload(file!, { ...link, title, description, classification }, setProgress);
    },
    onSuccess: () => {
      toast.success(evidenceId ? 'New version uploaded' : 'Evidence uploaded and scanned');
      setFile(null);
      setTitle('');
      setDescription('');
      setProgress(0);
      onUploaded();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !m.isPending && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader title={evidenceId ? 'Upload new version' : 'Upload evidence'} description="Files are stored privately with a SHA-256 checksum and malware-scanned before anyone can access them. Do not upload patient-identifiable data." />
        <DialogBody className="space-y-4">
          <FileDrop file={file} onFile={setFile} busy={m.isPending} progress={progress} />
          {!evidenceId && (
            <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
              <Field label="Title" hint="Defaults to the file name" htmlFor="ev-title">
                <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Classification" htmlFor="ev-class">
                <NativeSelect id="ev-class" value={classification} onChange={(e) => setClassification(e.target.value)}>
                  {Object.entries(CLASSIFICATION).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          )}
          <Field label={evidenceId ? 'What changed?' : 'Description'} htmlFor="ev-desc">
            <Textarea id="ev-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} disabled={m.isPending}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!file} loading={m.isPending} onClick={() => m.mutate()}>
            <Upload /> Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Evidence rows with preview/download through short-lived signed URLs. */
export function EvidenceList({ items, canVersion, onChanged, renderActions }: { items: Ev[]; canVersion?: boolean; onChanged?: () => void; renderActions?: (e: Ev) => React.ReactNode }) {
  const qc = useQueryClient();
  const [versionFor, setVersionFor] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const open = async (id: string, inline: boolean, version?: number) => {
    try {
      await evidenceService.open(id, { inline, version });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  if (!items.length) return <p className="rounded-md border border-dashed border-line px-4 py-5 text-center text-sm text-muted">No evidence attached yet.</p>;
  return (
    <>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {items.map((e) => {
          const v = e.versions[0];
          const clean = v?.scanStatus === 'CLEAN';
          const previewable = /\.(pdf|png|jpe?g)$/i.test(v?.originalFilename ?? '');
          return (
            <li key={e.id} className="p-3.5">
              <div className="flex flex-wrap items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
                  <FileText className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.title}</p>
                  <p className="truncate text-xs text-muted">
                    {e.code} · {v?.originalFilename} · {formatBytes(v?.size)} · v{e.currentVersion}
                    {e.uploader && ` · ${e.uploader.name}`}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <StatusBadge map={EVIDENCE_STATUS} value={e.verificationStatus} />
                    {v && v.scanStatus !== 'CLEAN' && <StatusBadge map={SCAN_STATUS} value={v.scanStatus} />}
                  </div>
                  {e.verificationNote && e.verificationStatus !== 'ACCEPTED' && <p className="mt-1.5 rounded bg-bad-soft px-2 py-1 text-xs text-bad">Auditor: {e.verificationNote}</p>}
                </div>
                <div className="flex items-center gap-1">
                  {previewable && (
                    <Button size="icon-sm" variant="ghost" aria-label="Preview" disabled={!clean} onClick={() => open(e.id, true)}>
                      <Eye />
                    </Button>
                  )}
                  <Button size="icon-sm" variant="ghost" aria-label="Download" disabled={!clean} onClick={() => open(e.id, false)}>
                    <Download />
                  </Button>
                  {e.currentVersion > 1 && (
                    <Button size="icon-sm" variant="ghost" aria-label="Version history" onClick={() => setHistoryFor(historyFor === e.id ? null : e.id)}>
                      <History />
                    </Button>
                  )}
                  {canVersion && (
                    <Button size="sm" variant="ghost" onClick={() => setVersionFor(e.id)}>
                      <Upload /> New version
                    </Button>
                  )}
                </div>
              </div>
              {renderActions && <div className="mt-2.5 pl-12">{renderActions(e)}</div>}
              {historyFor === e.id && (
                <ul className="mt-2.5 space-y-1 pl-12 text-xs">
                  {(e.versions as Partial<EvidenceVersion>[]).map((ver) => (
                    <li key={ver.version ?? ver.originalFilename} className="flex items-center gap-2">
                      <Badge>v{ver.version}</Badge> {ver.originalFilename} · {formatDateTime(ver.uploadedAt)}
                      {ver.version && ver.scanStatus === 'CLEAN' && (
                        <button className="text-brand hover:underline" onClick={() => open(e.id, false, ver.version)}>
                          download
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <UploadEvidenceDialog
        open={!!versionFor}
        onOpenChange={(o) => !o && setVersionFor(null)}
        evidenceId={versionFor ?? undefined}
        onUploaded={() => {
          onChanged?.();
          qc.invalidateQueries({ queryKey: ['evidence'] });
        }}
      />
    </>
  );
}
