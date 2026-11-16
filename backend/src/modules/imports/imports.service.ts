import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { prisma } from '../../config/prisma.js';
import { recordAudit } from '../../services/audit.service.js';
import { storage } from '../../services/storage/index.js';
import { recordTransition } from '../../services/workflow.service.js';
import { badRequest, invalidState, notFound, validationError } from '../../utils/errors.js';
import { sha256 } from '../../utils/crypto.js';
import { deriveCategory } from '../checklists/checklists.service.js';
import {
  IMPORT_FIELDS,
  mapRow,
  markDuplicates,
  parseWorkbook,
  type ColumnInfo,
  type ImportField,
  type ParsedRow,
  type ParsedSheet,
} from './excel-parser.js';

export interface SheetSummary {
  sheetName: string;
  headerRow: number | null;
  titleRows: string[];
  columns: ColumnInfo[];
  columnMap: Partial<Record<ImportField, string>>;
  detected: boolean;
  issues: string[];
  counts: { rows: number; errors: number; warnings: number; duplicates: number; mappingReview: number };
}

function summarise(sheet: Pick<ParsedSheet, 'sheetName' | 'headerRow' | 'titleRows' | 'columns' | 'columnMap' | 'detected' | 'issues'>, rows: Pick<ParsedRow, 'errors' | 'warnings' | 'isDuplicate' | 'mapped'>[]): SheetSummary {
  return {
    sheetName: sheet.sheetName,
    headerRow: sheet.headerRow,
    titleRows: sheet.titleRows,
    columns: sheet.columns,
    columnMap: sheet.columnMap,
    detected: sheet.detected,
    issues: sheet.issues,
    counts: {
      rows: rows.length,
      errors: rows.filter((r) => r.errors.length).length,
      warnings: rows.filter((r) => r.warnings.length).length,
      duplicates: rows.filter((r) => r.isDuplicate).length,
      mappingReview: rows.filter((r) => r.mapped.mappings.some((m) => m.needsReview)).length,
    },
  };
}

/**
 * Step 1 – upload: parses the workbook and stores a PREVIEW import with every row's
 * original cell values. Nothing becomes a checklist until the import is confirmed.
 */
export async function createImport(req: Request, file: { originalname: string; buffer: Buffer; size: number }) {
  const user = req.user!;
  if (!/\.xlsx$/i.test(file.originalname)) throw badRequest('Only .xlsx workbooks can be imported');
  const checksum = sha256(file.buffer);
  let sheets: ParsedSheet[];
  try {
    sheets = await parseWorkbook(file.buffer);
  } catch {
    throw badRequest('The file could not be read as an Excel workbook');
  }
  if (!sheets.length) throw badRequest('The workbook contains no worksheets');

  const previous = await prisma.importedChecklist.findFirst({
    where: { organisationId: user.organisationId, checksum, status: 'CONFIRMED' },
    orderBy: { createdAt: 'desc' },
  });
  const storageKey = `imports/${user.organisationId}/${checksum.slice(0, 16)}-${Date.now()}.xlsx`;
  await storage.put(storageKey, file.buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  const imp = await prisma.$transaction(async (tx) => {
    const created = await tx.importedChecklist.create({
      data: {
        organisationId: user.organisationId,
        fileName: file.originalname.slice(0, 255),
        checksum,
        fileSize: file.size,
        storageKey,
        uploadedById: user.id,
        sheetSummary: sheets.map((s) => summarise(s, s.rows)) as unknown as Prisma.InputJsonValue,
        errorSummary: previous
          ? ({ duplicateFile: { importId: previous.id, confirmedAt: previous.confirmedAt?.toISOString() ?? null } } as Prisma.InputJsonValue)
          : undefined,
      },
    });
    for (const s of sheets) {
      await tx.importedChecklistRow.createMany({
        data: s.rows.map((r) => ({
          importId: created.id,
          sheetName: s.sheetName,
          rowNumber: r.rowNumber,
          serialNo: r.serialNo,
          rawData: r.rawData,
          mapped: r.mapped as unknown as Prisma.InputJsonValue,
          validationErrors: r.errors,
          warnings: r.warnings,
          isDuplicate: r.isDuplicate,
          included: r.errors.length === 0 && !r.isDuplicate,
        })),
      });
    }
    await recordAudit(
      { req, action: 'CHECKLIST_IMPORT_UPLOADED', entityType: 'ImportedChecklist', entityId: created.id, metadata: { fileName: file.originalname, checksum, sheets: sheets.map((s) => s.sheetName), duplicateOf: previous?.id ?? null } },
      tx,
    );
    return created;
  });
  return getImport(user.organisationId, imp.id);
}

export async function getImport(organisationId: string, id: string) {
  const imp = await prisma.importedChecklist.findFirst({
    where: { id, organisationId },
    include: { versions: { select: { id: true, versionNumber: true, status: true, template: { select: { id: true, title: true } } } } },
  });
  if (!imp) throw notFound('Import');
  return imp;
}

/**
 * Step 2 – column mapping: re-maps a worksheet's rows from their preserved raw data
 * using a user-adjusted field → column map. Source values are never modified.
 */
export async function updateColumnMap(req: Request, id: string, sheetName: string, columnMap: Partial<Record<ImportField, string | null>>) {
  const imp = await getImport(req.user!.organisationId, id);
  if (imp.status !== 'PREVIEW') throw invalidState('Only imports in preview can be re-mapped');
  const summaries = imp.sheetSummary as unknown as SheetSummary[];
  const sheet = summaries.find((s) => s.sheetName === sheetName);
  if (!sheet) throw notFound('Worksheet');
  const keys = new Set(sheet.columns.map((c) => c.key));
  const cleanMap: Partial<Record<ImportField, string>> = {};
  for (const [field, key] of Object.entries(columnMap) as [ImportField, string | null][]) {
    if (!(field in IMPORT_FIELDS)) throw badRequest(`Unknown field ${field}`);
    if (key == null || key === '') continue;
    if (!keys.has(key)) throw badRequest(`Column "${key}" does not exist in worksheet ${sheetName}`);
    cleanMap[field] = key;
  }
  if (!cleanMap.description) throw validationError('The "Reports / Evidence Description" field must be mapped to a column');

  const rows = await prisma.importedChecklistRow.findMany({ where: { importId: id, sheetName }, orderBy: { rowNumber: 'asc' } });
  const parsed: ParsedRow[] = rows.map((r) => {
    const raw = r.rawData as Record<string, string | null>;
    const { mapped, errors, warnings } = mapRow(raw, cleanMap);
    return { rowNumber: r.rowNumber, serialNo: cleanMap.serialNo ? raw[cleanMap.serialNo] : null, rawData: raw, mapped, errors, warnings, isDuplicate: false };
  });
  markDuplicates(parsed);
  await prisma.$transaction(async (tx) => {
    for (const [i, p] of parsed.entries()) {
      await tx.importedChecklistRow.update({
        where: { id: rows[i].id },
        data: {
          serialNo: p.serialNo,
          mapped: p.mapped as unknown as Prisma.InputJsonValue,
          validationErrors: p.errors,
          warnings: p.warnings,
          isDuplicate: p.isDuplicate,
          included: p.errors.length === 0 && !p.isDuplicate,
        },
      });
    }
    const updatedSummary = summaries.map((s) =>
      s.sheetName === sheetName
        ? summarise({ ...s, columnMap: cleanMap, columns: s.columns.map((c) => ({ ...c, field: (Object.entries(cleanMap).find(([, k]) => k === c.key)?.[0] as ImportField) ?? null })), detected: true, issues: [] }, parsed)
        : s,
    );
    await tx.importedChecklist.update({ where: { id }, data: { sheetSummary: updatedSummary as unknown as Prisma.InputJsonValue } });
  });
  return getImport(req.user!.organisationId, id);
}

export async function setRowIncluded(req: Request, id: string, rowId: string, included: boolean) {
  const imp = await getImport(req.user!.organisationId, id);
  if (imp.status !== 'PREVIEW') throw invalidState('Import is no longer in preview');
  const row = await prisma.importedChecklistRow.findFirst({ where: { id: rowId, importId: id } });
  if (!row) throw notFound('Import row');
  if (included && (row.validationErrors as string[]).length) throw validationError('Rows with validation errors cannot be imported');
  return prisma.importedChecklistRow.update({ where: { id: rowId }, data: { included } });
}

/**
 * Step 3 – confirmation: each selected worksheet becomes a new checklist template with a
 * DRAFT version 1. Items keep a link to their source row so the original worksheet,
 * row number and every original cell (including past auditor observations) stay traceable.
 */
export async function confirmImport(req: Request, id: string, sheets: { sheetName: string; templateTitle: string; description?: string | null }[], allowDuplicateFile: boolean) {
  const user = req.user!;
  const imp = await getImport(user.organisationId, id);
  if (imp.status !== 'PREVIEW') throw invalidState('This import has already been processed');
  const dup = (imp.errorSummary as { duplicateFile?: { importId: string } } | null)?.duplicateFile;
  if (dup && !allowDuplicateFile) {
    throw validationError('This exact workbook was already imported. Confirm again with "import anyway" to create another copy.', { duplicateFile: dup });
  }
  const summaries = imp.sheetSummary as unknown as SheetSummary[];
  if (!sheets.length) throw validationError('Select at least one worksheet to import');

  const result = await prisma.$transaction(
    async (tx) => {
      const created: { templateId: string; versionId: string; sheetName: string; items: number }[] = [];
      for (const s of sheets) {
        const summary = summaries.find((x) => x.sheetName === s.sheetName);
        if (!summary) throw notFound(`Worksheet ${s.sheetName}`);
        if (!summary.columnMap.description) throw validationError(`Worksheet ${s.sheetName} has no mapped description column`);
        const rows = await tx.importedChecklistRow.findMany({ where: { importId: id, sheetName: s.sheetName, included: true }, orderBy: { rowNumber: 'asc' } });
        if (!rows.length) throw validationError(`Worksheet ${s.sheetName} has no rows selected for import`);
        const template = await tx.checklistTemplate.create({
          data: {
            organisationId: user.organisationId,
            title: s.templateTitle,
            description: s.description ?? `Imported from "${imp.fileName}", worksheet "${s.sheetName}". ${summary.titleRows.join(' · ')}`,
            category: 'ISO/IEC 27001:2022 Internal Audit',
            createdById: user.id,
          },
        });
        const version = await tx.checklistVersion.create({
          data: { templateId: template.id, versionNumber: 1, sourceImportId: id, createdById: user.id, changeSummary: `Imported from ${imp.fileName} / ${s.sheetName}` },
        });
        let seq = 0;
        for (const r of rows) {
          const m = r.mapped as unknown as { question: string; isoClauseRaw: string | null; annexControlRaw: string | null; description: string | null; priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null; mappings: { type: 'ISO_CLAUSE' | 'ANNEX_A'; reference: string; needsReview: boolean }[] };
          seq++;
          const serial = r.serialNo && /^\d+$/.test(r.serialNo) ? r.serialNo.padStart(3, '0') : String(seq).padStart(3, '0');
          await tx.checklistItem.create({
            data: {
              versionId: version.id,
              questionCode: `IA-${serial}${rows.slice(0, seq - 1).some((x) => x.serialNo === r.serialNo) ? `-${r.rowNumber}` : ''}`,
              sequence: seq,
              question: m.question,
              description: m.description,
              isoClauseRaw: m.isoClauseRaw,
              annexControlRaw: m.annexControlRaw,
              priority: m.priority ?? 'MEDIUM',
              category: deriveCategory(m.mappings),
              evidenceMandatory: true,
              responseMandatory: true,
              sourceRowId: r.id,
              mappings: { createMany: { data: m.mappings.map((x) => ({ type: x.type, reference: x.reference, needsReview: x.needsReview })) } },
            },
          });
        }
        await recordTransition(tx, 'ChecklistVersion', version.id, null, 'DRAFT', user.id, 'Created by Excel import');
        created.push({ templateId: template.id, versionId: version.id, sheetName: s.sheetName, items: rows.length });
      }
      await tx.importedChecklist.update({ where: { id }, data: { status: 'CONFIRMED', confirmedById: user.id, confirmedAt: new Date() } });
      await recordAudit({ req, action: 'CHECKLIST_IMPORT_CONFIRMED', entityType: 'ImportedChecklist', entityId: id, metadata: { created } }, tx);
      return created;
    },
    { timeout: 60_000 },
  );
  return result;
}

export async function discardImport(req: Request, id: string) {
  const imp = await getImport(req.user!.organisationId, id);
  if (imp.status !== 'PREVIEW') throw invalidState('Only preview imports can be discarded');
  await prisma.importedChecklist.update({ where: { id }, data: { status: 'DISCARDED' } });
  await recordAudit({ req, action: 'CHECKLIST_IMPORT_DISCARDED', entityType: 'ImportedChecklist', entityId: id });
}

/** Excel report listing every row with errors, warnings or duplicate flags, with its original values. */
export async function errorReport(organisationId: string, id: string) {
  const imp = await getImport(organisationId, id);
  const rows = await prisma.importedChecklistRow.findMany({ where: { importId: id }, orderBy: [{ sheetName: 'asc' }, { rowNumber: 'asc' }] });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Import issues');
  ws.columns = [
    { header: 'Worksheet', key: 'sheet', width: 28 },
    { header: 'Row', key: 'row', width: 8 },
    { header: 'SL.NO', key: 'sl', width: 8 },
    { header: 'Description (source)', key: 'desc', width: 60 },
    { header: 'Errors', key: 'err', width: 50 },
    { header: 'Warnings', key: 'warn', width: 70 },
    { header: 'Duplicate', key: 'dup', width: 10 },
    { header: 'Included', key: 'inc', width: 10 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    const errs = r.validationErrors as string[];
    const warns = r.warnings as string[];
    if (!errs.length && !warns.length && !r.isDuplicate) continue;
    ws.addRow({
      sheet: r.sheetName,
      row: r.rowNumber,
      sl: r.serialNo,
      desc: (r.mapped as { question?: string }).question ?? '',
      err: errs.join('\n'),
      warn: warns.join('\n'),
      dup: r.isDuplicate ? 'Yes' : '',
      inc: r.included ? 'Yes' : 'No',
    });
  }
  return { fileName: `${imp.fileName.replace(/\.xlsx$/i, '')}-import-issues.xlsx`, buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
}
