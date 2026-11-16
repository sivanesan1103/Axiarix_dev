import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { recordAudit } from '../../services/audit.service.js';
import { badRequest } from '../../utils/errors.js';
import { created, ok, pageArgs, pageMeta, paginationSchema, param } from '../../utils/http.js';
import * as svc from './imports.service.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

export const importsRouter = Router();

importsRouter.get('/', requirePermission('checklist:create'), validate(paginationSchema, 'query'), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof paginationSchema>;
  const where = { organisationId: req.user!.organisationId };
  const [rows, total] = await Promise.all([
    prisma.importedChecklist.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fileName: true,
        checksum: true,
        fileSize: true,
        status: true,
        sheetSummary: true,
        errorSummary: true,
        createdAt: true,
        confirmedAt: true,
        uploadedById: true,
        versions: { select: { id: true, versionNumber: true, status: true, template: { select: { id: true, title: true } } } },
        _count: { select: { rows: true } },
      },
      ...pageArgs(q),
    }),
    prisma.importedChecklist.count({ where }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.uploadedById) } }, select: { id: true, name: true } });
  ok(res, rows.map((r) => ({ ...r, uploadedBy: users.find((u) => u.id === r.uploadedById) ?? null })), pageMeta(q, total));
});

importsRouter.post('/', requirePermission('checklist:create'), upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Attach an .xlsx file in the "file" field');
  created(res, await svc.createImport(req, req.file));
});

importsRouter.get('/:id', requirePermission('checklist:create'), async (req, res) => ok(res, await svc.getImport(req.user!.organisationId, param(req, 'id'))));

const rowQuery = paginationSchema.extend({
  sheetName: z.string().min(1),
  filter: z.enum(['all', 'errors', 'warnings', 'duplicates', 'review', 'excluded']).default('all'),
});

importsRouter.get('/:id/rows', requirePermission('checklist:create'), validate(rowQuery, 'query'), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof rowQuery>;
  const id = param(req, 'id');
  await svc.getImport(req.user!.organisationId, id);
  // Worksheets are small (tens to hundreds of rows), so JSON-array filters are applied in memory.
  const all = await prisma.importedChecklistRow.findMany({ where: { importId: id, sheetName: q.sheetName }, orderBy: { rowNumber: 'asc' } });
  const matches = all.filter((r) => {
    const errs = r.validationErrors as string[];
    const warns = r.warnings as string[];
    const mapped = r.mapped as { mappings?: { needsReview: boolean }[] };
    switch (q.filter) {
      case 'errors':
        return errs.length > 0;
      case 'warnings':
        return warns.length > 0;
      case 'duplicates':
        return r.isDuplicate;
      case 'excluded':
        return !r.included;
      case 'review':
        return (mapped.mappings ?? []).some((m) => m.needsReview);
      default:
        return true;
    }
  });
  const total = matches.length;
  const { skip, take } = pageArgs(q);
  const rows = matches.slice(skip, skip + take);
  ok(res, rows, pageMeta(q, total));
});

importsRouter.put(
  '/:id/mapping',
  requirePermission('checklist:create'),
  validate(z.object({ sheetName: z.string().min(1), columnMap: z.record(z.string().nullable()) })),
  async (req, res) => ok(res, await svc.updateColumnMap(req, param(req, 'id'), req.body.sheetName, req.body.columnMap)),
);

importsRouter.patch('/:id/rows/:rowId', requirePermission('checklist:create'), validate(z.object({ included: z.boolean() })), async (req, res) =>
  ok(res, await svc.setRowIncluded(req, param(req, 'id'), param(req, 'rowId'), req.body.included)),
);

importsRouter.post(
  '/:id/confirm',
  requirePermission('checklist:create'),
  validate(
    z.object({
      sheets: z.array(z.object({ sheetName: z.string().min(1), templateTitle: z.string().trim().min(3).max(200), description: z.string().max(2000).nullable().optional() })).min(1),
      allowDuplicateFile: z.boolean().default(false),
    }),
  ),
  async (req, res) => ok(res, await svc.confirmImport(req, param(req, 'id'), req.body.sheets, req.body.allowDuplicateFile)),
);

importsRouter.post('/:id/discard', requirePermission('checklist:create'), async (req, res) => {
  await svc.discardImport(req, param(req, 'id'));
  ok(res, { discarded: true });
});

importsRouter.get('/:id/error-report', requirePermission('checklist:create'), async (req, res) => {
  const { fileName, buffer } = await svc.errorReport(req.user!.organisationId, param(req, 'id'));
  await recordAudit({ req, action: 'EXPORT', entityType: 'ImportedChecklist', entityId: param(req, 'id'), metadata: { format: 'xlsx', kind: 'error-report' } });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`);
  res.send(buffer);
});
