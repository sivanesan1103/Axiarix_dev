import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, FileText, FolderLock, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { evidenceService } from '@/services/evidence.service';
import { adminService } from '@/services/admin.service';
import { useAuth } from '@/contexts/AuthContext';
import { pageChips, useScope } from '@/hooks/useScope';
import { errorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge, Card, Table, TD, TH, THead, TR } from '@/components/ui/display';
import { Dialog, SheetContent } from '@/components/ui/overlays';
import { NativeSelect } from '@/components/ui/form-controls';
import { ActiveFilters, ConfirmDialog, EmptyState, ErrorState, KeyValue, LoadingRows, PageHeader, Pagination, SearchInput, StatusBadge, usePaged } from '@/components/common';
import { CLASSIFICATION, EVIDENCE_STATUS, SCAN_STATUS } from '@/constants/status';
import { formatBytes, formatDateTime, humanize } from '@/lib/utils';

function EvidenceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['evidence', id], queryFn: () => evidenceService.get(id) });
  const [preview, setPreview] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  const rescan = useMutation({
    mutationFn: (versionId: string) => evidenceService.rescan(versionId),
    onSuccess: () => (toast.success('Rescanned'), qc.invalidateQueries({ queryKey: ['evidence'] })),
  });
  const e = q.data;
  const v = e?.versions[0];
  const previewable = !!v && v.scanStatus === 'CLEAN' && /^(application\/pdf|image\/(png|jpeg))$/.test(v.mimeType);
  useEffect(() => setPreview(null), [id]);
  return (
    <SheetContent title={e ? `${e.code} · ${e.title}` : 'Evidence'} description={e?.item ? `${e.item.questionCode} – ${e.item.question}` : e?.finding ? `Finding ${e.finding.code}` : undefined} className="max-w-2xl">
      {q.isLoading ? (
        <LoadingRows />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        e && (
          <div className="space-y-6 p-6">
            <div className="flex flex-wrap gap-2">
              <StatusBadge map={EVIDENCE_STATUS} value={e.verificationStatus} />
              {v && <StatusBadge map={SCAN_STATUS} value={v.scanStatus} />}
              <Badge>{CLASSIFICATION[e.classification]}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {previewable && (
                <Button
                  onClick={async () => {
                    try {
                      setPreview(await evidenceService.previewUrl(e.id));
                    } catch (err) {
                      toast.error(errorMessage(err));
                    }
                  }}
                >
                  <Eye /> Preview
                </Button>
              )}
              <Button variant="primary" disabled={v?.scanStatus !== 'CLEAN'} onClick={() => evidenceService.open(e.id).catch((err) => toast.error(errorMessage(err)))}>
                <Download /> Download
              </Button>
              {can('evidence:update') && v && v.scanStatus !== 'CLEAN' && (
                <Button loading={rescan.isPending} onClick={() => rescan.mutate(v.id)}>
                  <RefreshCw /> Rescan
                </Button>
              )}
              {can('settings:update') && (
                <Button variant="danger-outline" onClick={() => setDel(true)}>
                  <Trash2 /> Request secure deletion
                </Button>
              )}
            </div>
            {preview && (
              <div className="overflow-hidden rounded-lg border border-line">
                {v?.mimeType === 'application/pdf' ? <iframe title="Evidence preview" src={preview} className="h-[520px] w-full" /> : <img src={preview} alt={e.title} className="max-h-[520px] w-full object-contain" />}
              </div>
            )}
            {v?.scanStatus !== 'CLEAN' && (
              <p className="flex items-center gap-2 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
                <ShieldAlert className="size-4" /> Access is blocked until the file passes malware scanning ({v?.scanDetail}).
              </p>
            )}
            <dl className="grid grid-cols-2 gap-4">
              <KeyValue label="Site / department">
                {e.site?.name} / {e.department.name}
              </KeyValue>
              <KeyValue label="Linked to">
                {e.assessment && (
                  <Link className="text-brand hover:underline" to={`/assessments/${e.assessment.id}`}>
                    {e.assessment.code}
                  </Link>
                )}
                {e.item && ` · ${e.item.questionCode}`}
                {e.finding && (
                  <Link className="block text-brand hover:underline" to={`/findings/${e.finding.id}`}>
                    Finding {e.finding.code}
                  </Link>
                )}
                {e.correctiveAction && (
                  <Link className="block text-brand hover:underline" to={`/corrective-actions/${e.correctiveAction.id}`}>
                    Action {e.correctiveAction.code}
                  </Link>
                )}
              </KeyValue>
              <KeyValue label="Uploaded by">{e.uploader?.name}</KeyValue>
              <KeyValue label="Uploaded at">{formatDateTime(e.createdAt)}</KeyValue>
              <KeyValue label="Current file">
                {v?.originalFilename} ({formatBytes(v?.size)})
              </KeyValue>
              <KeyValue label="MIME type">{v?.mimeType}</KeyValue>
              <KeyValue label="SHA-256 checksum" className="col-span-2">
                <code className="break-all text-xs">{v?.checksum}</code>
              </KeyValue>
              {e.description && (
                <KeyValue label="Description" className="col-span-2">
                  {e.description}
                </KeyValue>
              )}
              {e.verificationNote && (
                <KeyValue label="Verification note" className="col-span-2">
                  {e.verificationNote}
                </KeyValue>
              )}
            </dl>
            <section>
              <h3 className="mb-2 text-sm font-semibold">Version history</h3>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {e.versions.map((ver) => (
                  <li key={ver.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                    <Badge tone={ver.version === e.currentVersion ? 'brand' : 'neutral'}>v{ver.version}</Badge>
                    <span className="min-w-0 flex-1 truncate">{ver.originalFilename}</span>
                    <span className="text-xs text-muted">
                      {ver.uploader?.name} · {formatDateTime(ver.uploadedAt)}
                    </span>
                    <Button size="icon-sm" variant="ghost" aria-label={`Download v${ver.version}`} disabled={ver.scanStatus !== 'CLEAN'} onClick={() => evidenceService.open(e.id, { version: ver.version }).catch((err) => toast.error(errorMessage(err)))}>
                      <Download />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
            {e.reviews.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-semibold">Auditor decisions</h3>
                <ul className="space-y-2">
                  {e.reviews.map((r) => (
                    <li key={r.id} className="rounded-md border border-line px-3 py-2 text-[13px]">
                      <span className="font-medium">{r.auditor.name}</span> · {humanize(r.decision)} · {formatDateTime(r.createdAt)}
                      {(r.reason || r.comments) && <p className="text-muted">{r.reason || r.comments}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h3 className="mb-2 text-sm font-semibold">Access & change log</h3>
              <ul className="space-y-1 text-xs text-muted">
                {e.history.map((h) => (
                  <li key={h.id}>
                    {formatDateTime(h.createdAt)} · {h.actorEmail ?? 'system'} · {humanize(h.action)} {h.outcome !== 'SUCCESS' && <Badge tone="bad">{h.outcome}</Badge>}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )
      )}
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title="Request secure deletion"
        description="A second authorised person must approve before the file is destroyed. Metadata is kept as a tombstone for the audit trail."
        reasonLabel="Reason"
        reasonMin={10}
        tone="danger"
        confirmLabel="Submit request"
        onConfirm={async (reason) => {
          await adminService.requestDeletion('Evidence', id, reason);
          toast.success('Deletion request submitted for approval');
          onClose();
        }}
      />
    </SheetContent>
  );
}

export function EvidencePage() {
  const scope = useScope();
  const [sp, setSp] = useSearchParams();
  const [params, set, reset] = usePaged({ search: '', verificationStatus: '', classification: '', link: '' });
  const query = { ...params, ...scope.params };
  const q = useQuery({ queryKey: ['evidence', query], queryFn: () => evidenceService.list(query) });
  const LINK_LABEL: Record<string, string> = { response: 'Checklist responses', finding: 'Findings', action: 'Corrective actions' };
  const chips = [
    ...scope.chips,
    ...pageChips(
      params,
      {
        search: { label: 'Search' },
        verificationStatus: { label: 'Verification', format: (v) => EVIDENCE_STATUS[v]?.label ?? v },
        link: { label: 'Linked to', format: (v) => LINK_LABEL[v] ?? v },
        classification: { label: 'Classification', format: (v) => CLASSIFICATION[v] ?? v },
      },
      set,
    ),
  ];
  const openId = sp.get('open');
  return (
    <div>
      <PageHeader title="Evidence Repository" description="Centralised, private evidence store. Every file is checksummed, versioned and malware-scanned; downloads use 5-minute signed links and are logged." />
      <Card>
        <div className="flex flex-wrap gap-3 p-5">
          <SearchInput value={params.search as string} onChange={(v) => set({ search: v })} placeholder="Search title, ID or file name" className="w-full max-w-sm" />
          <NativeSelect aria-label="Verification" className="w-48" value={params.verificationStatus as string} onChange={(e) => set({ verificationStatus: e.target.value })}>
            <option value="">Any verification</option>
            {Object.entries(EVIDENCE_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Linked to" className="w-48" value={params.link as string} onChange={(e) => set({ link: e.target.value })}>
            <option value="">Any link</option>
            <option value="response">Checklist responses</option>
            <option value="finding">Findings</option>
            <option value="action">Corrective actions</option>
          </NativeSelect>
          <NativeSelect aria-label="Classification" className="w-44" value={params.classification as string} onChange={(e) => set({ classification: e.target.value })}>
            <option value="">Any classification</option>
            {Object.entries(CLASSIFICATION).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </div>
        <ActiveFilters chips={chips} total={q.data?.meta.total} onClearAll={() => (reset(), scope.clear())} />
        {q.isLoading ? (
          <LoadingRows />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.data.length ? (
          <EmptyState icon={FolderLock} title="No evidence found" description="Evidence is uploaded from an assessment question, a finding or a corrective action." />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Evidence</TH>
                  <TH>Linked to</TH>
                  <TH>Site</TH>
                  <TH>Uploaded</TH>
                  <TH>Verification</TH>
                  <TH>Scan</TH>
                </tr>
              </THead>
              <tbody>
                {q.data.data.map((e) => (
                  <TR key={e.id} className="cursor-pointer hover:bg-subtle" onClick={() => setSp({ open: e.id })}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-md bg-brand-soft text-brand">
                          <FileText className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{e.title}</p>
                          <p className="truncate text-xs text-muted">
                            {e.code} · {e.versions[0]?.originalFilename} · v{e.currentVersion} · {formatBytes(e.versions[0]?.size)}
                          </p>
                        </div>
                      </div>
                    </TD>
                    <TD className="text-[13px]">
                      {e.assessment?.code}
                      {e.item && <span className="text-muted"> · {e.item.questionCode}</span>}
                      {e.finding && <span className="block text-muted">Finding {e.finding.code}</span>}
                      {e.correctiveAction && <span className="block text-muted">Action {e.correctiveAction.code}</span>}
                    </TD>
                    <TD className="text-[13px]">{e.site?.name}</TD>
                    <TD className="text-[13px] text-muted">
                      {e.uploader?.name}
                      <br />
                      {formatDateTime(e.createdAt)}
                    </TD>
                    <TD>
                      <StatusBadge map={EVIDENCE_STATUS} value={e.verificationStatus} />
                    </TD>
                    <TD>
                      <StatusBadge map={SCAN_STATUS} value={e.versions[0]?.scanStatus ?? 'PENDING'} />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <Pagination {...q.data.meta} onPage={(p) => set({ page: p })} />
          </>
        )}
      </Card>
      <Dialog open={!!openId} onOpenChange={(o) => !o && setSp({})}>
        {openId && <EvidenceDrawer id={openId} onClose={() => setSp({})} />}
      </Dialog>
    </div>
  );
}
