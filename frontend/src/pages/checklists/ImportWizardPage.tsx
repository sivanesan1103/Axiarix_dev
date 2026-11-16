import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, FileSpreadsheet, Trash2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { importsService } from '@/services/imports.service';
import { errorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, Table, TD, TH, THead, TR } from '@/components/ui/display';
import { Checkbox, Field, Input, NativeSelect } from '@/components/ui/form-controls';
import { ConfirmDialog, EmptyState, ErrorState, LoadingRows, PageHeader, Pagination, usePaged } from '@/components/common';
import { FileDrop } from '@/components/common/pickers';
import { cn, formatBytes } from '@/lib/utils';
import type { ImportRecord, ImportSheetSummary } from '@/types/api';

const FIELD_LABELS: Record<string, string> = {
  serialNo: 'Serial number',
  description: 'Reports / Evidence Description *',
  clauses: 'Clauses',
  controls: 'Controls (2022)',
  explanation: 'Explanation',
  evidenceAvailableStatus: 'Evidence Available Status',
  availableEvidences: 'Available Evidences',
  remarksObserved: 'Remarks observed on …',
  evidenceShownStatus: 'Evidence Shown Status',
  evidencesAvailability: 'Evidences Availability',
  strengths: 'Strengths',
  opportunitiesForImprovement: 'Opportunities For Improvement',
  observations: 'Observations',
  observationClosure: 'Observation Closure',
  remarks: 'Remarks',
};

function Steps({ step }: { step: number }) {
  const steps = ['Upload workbook', 'Worksheets & columns', 'Preview & validate', 'Confirm import'];
  return (
    <ol className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-4">
      {steps.map((s, i) => (
        <li key={s} className={cn('flex items-center gap-3 rounded-lg border px-4 py-3', i === step ? 'border-brand bg-brand-soft' : 'border-line bg-surface')}>
          <span className={cn('flex size-7 items-center justify-center rounded-full text-[13px] font-semibold', i < step ? 'bg-ok text-white' : i === step ? 'bg-brand text-white' : 'bg-muted-bg text-muted')}>{i < step ? '✓' : i + 1}</span>
          <span className={cn('text-sm', i === step ? 'font-semibold text-brand-ink' : 'text-ink-2')}>{s}</span>
        </li>
      ))}
    </ol>
  );
}

function UploadStep() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const m = useMutation({
    mutationFn: () => importsService.upload(file!, setProgress),
    onSuccess: (imp) => {
      toast.success(`Parsed ${imp.sheetSummary.length} worksheet(s)`);
      navigate(`/checklists/import/${imp.id}`, { replace: true });
    },
  });
  return (
    <Card>
      <CardHeader title="Upload the hospital checklist workbook" description="Each worksheet is detected automatically. Original cell values, worksheet names and row numbers are preserved for traceability." />
      <CardBody className="max-w-2xl space-y-4">
        <FileDrop file={file} onFile={setFile} accept=".xlsx" maxMb={10} busy={m.isPending} progress={progress} hint="Excel .xlsx · up to 10 MB" />
        <Button variant="primary" disabled={!file} loading={m.isPending} onClick={() => m.mutate()}>
          <FileSpreadsheet /> Upload & analyse
        </Button>
      </CardBody>
    </Card>
  );
}

function ColumnMapping({ imp, sheet, onDone }: { imp: ImportRecord; sheet: ImportSheetSummary; onDone: () => void }) {
  const qc = useQueryClient();
  const [map, setMap] = useState<Record<string, string>>(sheet.columnMap);
  useEffect(() => setMap(sheet.columnMap), [sheet.columnMap]);
  const m = useMutation({
    mutationFn: () => importsService.setMapping(imp.id, sheet.sheetName, map),
    onSuccess: () => {
      toast.success('Column mapping applied');
      qc.invalidateQueries({ queryKey: ['import', imp.id] });
      onDone();
    },
  });
  const editable = imp.status === 'PREVIEW';
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Object.entries(FIELD_LABELS).map(([field, label]) => (
          <Field key={field} label={label} htmlFor={`map-${sheet.sheetName}-${field}`}>
            <NativeSelect id={`map-${sheet.sheetName}-${field}`} disabled={!editable} value={map[field] ?? ''} onChange={(e) => setMap((m0) => ({ ...m0, [field]: e.target.value }))}>
              <option value="">— not mapped —</option>
              {sheet.columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.letter}: {c.header.slice(0, 60)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ))}
      </div>
      {editable && (
        <Button variant="soft" loading={m.isPending} onClick={() => m.mutate()} disabled={!map.description}>
          Re-apply mapping to rows
        </Button>
      )}
    </div>
  );
}

function SheetsStep({ imp, onNext }: { imp: ImportRecord; onNext: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {imp.errorSummary?.duplicateFile && (
        <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> This exact file (same SHA-256 checksum) was already imported. Confirming will create another copy unless you discard this import.
        </div>
      )}
      {imp.sheetSummary.map((s) => (
        <Card key={s.sheetName}>
          <div className="flex flex-wrap items-center gap-3 p-5">
            <FileSpreadsheet className="size-5 text-brand" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{s.sheetName}</p>
              <p className="text-xs text-muted">
                Header row {s.headerRow ?? '—'} · {s.columns.length} columns · {s.titleRows.join(' · ')}
              </p>
            </div>
            <Badge tone="neutral">{s.counts.rows} rows</Badge>
            {s.counts.errors > 0 && <Badge tone="bad">{s.counts.errors} errors</Badge>}
            {s.counts.mappingReview > 0 && <Badge tone="warn">{s.counts.mappingReview} mapping reviews</Badge>}
            {s.counts.duplicates > 0 && <Badge tone="warn">{s.counts.duplicates} duplicates</Badge>}
            {s.detected ? <Badge tone="ok" dot>Layout detected</Badge> : <Badge tone="bad" dot>Needs mapping</Badge>}
            <Button size="sm" variant="ghost" onClick={() => setOpen(open === s.sheetName ? null : s.sheetName)}>
              {open === s.sheetName ? <ChevronDown /> : <ChevronRight />} Columns
            </Button>
          </div>
          {s.issues.length > 0 && <p className="mx-5 mb-4 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{s.issues.join(' ')}</p>}
          {open === s.sheetName && (
            <div className="border-t border-line p-5">
              <ColumnMapping imp={imp} sheet={s} onDone={() => undefined} />
            </div>
          )}
        </Card>
      ))}
      <div className="flex justify-end">
        <Button variant="primary" onClick={onNext}>
          Continue to preview
        </Button>
      </div>
    </div>
  );
}

function PreviewStep({ imp, onBack, onNext }: { imp: ImportRecord; onBack: () => void; onNext: () => void }) {
  const qc = useQueryClient();
  const [sheetName, setSheetName] = useState(imp.sheetSummary[0]?.sheetName ?? '');
  const [params, set] = usePaged({ filter: 'all', pageSize: 25 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['import-rows', imp.id, sheetName, params], queryFn: () => importsService.rows(imp.id, { ...params, sheetName }), enabled: !!sheetName });
  const toggle = useMutation({
    mutationFn: ({ rowId, included }: { rowId: string; included: boolean }) => importsService.setRowIncluded(imp.id, rowId, included),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import-rows', imp.id] }),
  });
  const editable = imp.status === 'PREVIEW';
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 p-5">
        <NativeSelect aria-label="Worksheet" className="w-72" value={sheetName} onChange={(e) => (setSheetName(e.target.value), set({ page: 1 }))}>
          {imp.sheetSummary.map((s) => (
            <option key={s.sheetName} value={s.sheetName}>
              {s.sheetName}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Row filter" className="w-56" value={params.filter as string} onChange={(e) => set({ filter: e.target.value })}>
          <option value="all">All rows</option>
          <option value="errors">Rows with errors</option>
          <option value="warnings">Rows with warnings</option>
          <option value="review">Mapping review needed</option>
          <option value="duplicates">Duplicates</option>
          <option value="excluded">Excluded</option>
        </NativeSelect>
        <Button className="ml-auto" onClick={() => importsService.errorReport(imp.id)}>
          <Download /> Error report
        </Button>
      </div>
      {q.isLoading ? (
        <LoadingRows />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.data.length ? (
        <EmptyState title="No rows for this filter" />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH className="w-12">Use</TH>
                <TH className="w-16">Row</TH>
                <TH className="w-16">SL</TH>
                <TH>Description (question)</TH>
                <TH>Parsed mapping</TH>
                <TH>Validation</TH>
              </tr>
            </THead>
            <tbody>
              {q.data.data.map((r) => (
                <Fragment key={r.id}>
                  <TR className={cn(!r.included && 'bg-subtle/70')}>
                    <TD>
                      <Checkbox aria-label={`Include row ${r.rowNumber}`} checked={r.included} disabled={!editable || r.validationErrors.length > 0 || toggle.isPending} onCheckedChange={(c) => toggle.mutate({ rowId: r.id, included: !!c })} />
                    </TD>
                    <TD className="tabular text-muted">{r.rowNumber}</TD>
                    <TD className="tabular">{r.serialNo}</TD>
                    <TD className="max-w-md">
                      <button className="text-left" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        <p className="line-clamp-2 font-medium">{r.mapped.question ?? <span className="text-bad">— missing —</span>}</p>
                        <p className="text-xs text-brand">{expanded === r.id ? 'Hide original cells' : 'Show original cells'}</p>
                      </button>
                    </TD>
                    <TD className="max-w-[220px]">
                      <div className="flex flex-wrap gap-1">
                        {r.mapped.mappings.map((m) => (
                          <span key={m.type + m.reference} className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', m.type === 'ANNEX_A' ? 'bg-brand-soft text-brand-ink' : 'bg-info-soft text-info', m.needsReview && 'ring-1 ring-warn')}>
                            {m.type === 'ANNEX_A' ? 'A.' : 'Cl. '}
                            {m.reference}
                          </span>
                        ))}
                      </div>
                    </TD>
                    <TD className="max-w-sm text-xs">
                      {r.validationErrors.map((e) => (
                        <p key={e} className="flex gap-1 text-bad">
                          <XCircle className="mt-px size-3 shrink-0" /> {e}
                        </p>
                      ))}
                      {r.warnings.map((w) => (
                        <p key={w} className="flex gap-1 text-warn">
                          <AlertTriangle className="mt-px size-3 shrink-0" /> {w}
                        </p>
                      ))}
                      {!r.validationErrors.length && !r.warnings.length && (
                        <span className="flex items-center gap-1 text-ok">
                          <CheckCircle2 className="size-3" /> OK
                        </span>
                      )}
                    </TD>
                  </TR>
                  {expanded === r.id && (
                    <tr className="border-b border-line bg-subtle/60">
                      <td colSpan={6} className="px-5 py-4">
                        <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
                          {Object.entries(r.rawData).map(([k, v]) => (
                            <div key={k}>
                              <dt className="text-muted">{k}</dt>
                              <dd className="whitespace-pre-wrap text-ink">{v ?? '—'}</dd>
                            </div>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </Table>
          <Pagination {...q.data.meta} onPage={(p) => set({ page: p })} />
        </>
      )}
      <div className="flex justify-between border-t border-line p-5">
        <Button onClick={onBack}>Back</Button>
        <Button variant="primary" onClick={onNext} disabled={!editable}>
          Continue
        </Button>
      </div>
    </Card>
  );
}

function ConfirmStep({ imp, onBack }: { imp: ImportRecord; onBack: () => void }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Record<string, { on: boolean; title: string }>>(() =>
    Object.fromEntries(imp.sheetSummary.map((s) => [s.sheetName, { on: s.detected, title: `${imp.fileName.replace(/\.xlsx$/i, '')} – ${s.sheetName}`.slice(0, 200) }])),
  );
  const [allowDup, setAllowDup] = useState(false);
  const m = useMutation({
    mutationFn: () =>
      importsService.confirm(
        imp.id,
        Object.entries(selected)
          .filter(([, v]) => v.on)
          .map(([sheetName, v]) => ({ sheetName, templateTitle: v.title })),
        allowDup,
      ),
    onSuccess: (r) => {
      toast.success(`Created ${r.length} draft checklist(s)`);
      qc.invalidateQueries({ queryKey: ['import', imp.id] });
      qc.invalidateQueries({ queryKey: ['checklists'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader title="Create checklists" description="Each selected worksheet becomes a new checklist with Draft version 1. Review mappings, then submit for review and publish." />
      <CardBody className="space-y-4">
        {imp.sheetSummary.map((s) => (
          <div key={s.sheetName} className="grid items-center gap-3 rounded-md border border-line p-4 sm:grid-cols-[auto_220px_1fr]">
            <Checkbox aria-label={`Import ${s.sheetName}`} checked={selected[s.sheetName]?.on} onCheckedChange={(c) => setSelected((x) => ({ ...x, [s.sheetName]: { ...x[s.sheetName], on: !!c } }))} />
            <div>
              <p className="font-medium">{s.sheetName}</p>
              <p className="text-xs text-muted">{s.counts.rows} rows detected</p>
            </div>
            <Input aria-label={`Checklist title for ${s.sheetName}`} value={selected[s.sheetName]?.title} onChange={(e) => setSelected((x) => ({ ...x, [s.sheetName]: { ...x[s.sheetName], title: e.target.value } }))} />
          </div>
        ))}
        {imp.errorSummary?.duplicateFile && (
          <label className="flex items-center gap-2 text-sm text-warn">
            <Checkbox checked={allowDup} onCheckedChange={(c) => setAllowDup(!!c)} /> Import anyway (this file was imported before)
          </label>
        )}
      </CardBody>
      <div className="flex justify-between border-t border-line p-5">
        <Button onClick={onBack}>Back</Button>
        <Button variant="primary" loading={m.isPending} disabled={!Object.values(selected).some((s) => s.on && s.title.trim().length >= 3)} onClick={() => m.mutate()}>
          Confirm import
        </Button>
      </div>
    </Card>
  );
}

export function ImportWizardPage() {
  const { importId } = useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [discard, setDiscard] = useState(false);
  const q = useQuery({ queryKey: ['import', importId], queryFn: () => importsService.get(importId!), enabled: !!importId });
  const imp = q.data;
  return (
    <div>
      <PageHeader
        back={{ to: '/checklists', label: 'Checklist Library' }}
        title="Import checklist from Excel"
        description={imp ? `${imp.fileName} · ${formatBytes(imp.fileSize)}` : 'Supports the Kauvery IA workbook layouts (different column sets per worksheet).'}
        actions={
          imp?.status === 'PREVIEW' && (
            <Button variant="danger-outline" onClick={() => setDiscard(true)}>
              <Trash2 /> Discard import
            </Button>
          )
        }
      />
      <Steps step={!importId ? 0 : imp?.status === 'CONFIRMED' ? 4 : step} />
      {!importId ? (
        <UploadStep />
      ) : q.isLoading ? (
        <Card>
          <LoadingRows />
        </Card>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : imp!.status === 'CONFIRMED' ? (
        <Card>
          <EmptyState
            icon={CheckCircle2}
            title="Import confirmed"
            description="The following draft checklists were created from this workbook."
            action={
              <div className="space-y-1">
                {imp!.versions.map((v) => (
                  <Link key={v.id} to={`/checklists/${v.template.id}/versions/${v.id}`} className="block text-brand hover:underline">
                    {v.template.title} · v{v.versionNumber}
                  </Link>
                ))}
              </div>
            }
          />
        </Card>
      ) : imp!.status === 'DISCARDED' ? (
        <Card>
          <EmptyState icon={XCircle} title="This import was discarded" action={<Button onClick={() => navigate('/checklists/import')}>Start a new import</Button>} />
        </Card>
      ) : step === 1 ? (
        <SheetsStep imp={imp!} onNext={() => setStep(2)} />
      ) : step === 2 ? (
        <PreviewStep imp={imp!} onBack={() => setStep(1)} onNext={() => setStep(3)} />
      ) : (
        <ConfirmStep imp={imp!} onBack={() => setStep(2)} />
      )}
      <ConfirmDialog
        open={discard}
        onOpenChange={setDiscard}
        title="Discard this import?"
        description="No checklists will be created. The upload stays in import history as discarded."
        tone="danger"
        confirmLabel="Discard"
        onConfirm={async () => {
          await importsService.discard(imp!.id);
          toast.success('Import discarded');
          q.refetch();
        }}
      />
    </div>
  );
}
