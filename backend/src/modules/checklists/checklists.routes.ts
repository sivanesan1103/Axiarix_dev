import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { prisma } from '../../config/prisma.js';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { recordAudit } from '../../services/audit.service.js';
import { created, ok, pageArgs, pageMeta, paginationSchema, param } from '../../utils/http.js';
import { notFound } from '../../utils/errors.js';
import * as svc from './checklists.service.js';

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const mappingSchema = z.object({
  type: z.enum(['ISO_CLAUSE', 'ANNEX_A', 'INTERNAL_POLICY', 'RISK']),
  reference: z.string().trim().min(1).max(60),
  title: nullableText(200),
});
const itemSchema = z.object({
  question: z.string().trim().min(3).max(2000),
  description: nullableText(4000),
  guidance: nullableText(4000),
  internalPolicyRef: nullableText(200),
  riskRef: nullableText(200),
  evidenceRequirement: nullableText(2000),
  evidenceMandatory: z.boolean().optional(),
  responseMandatory: z.boolean().optional(),
  defaultOwnerId: z.string().uuid().nullable().optional(),
  priority: priority.optional(),
  category: nullableText(120),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

const listSchema = paginationSchema.extend({ search: z.string().trim().max(100).optional(), status: z.enum(['DRAFT', 'UNDER_REVIEW', 'PUBLISHED', 'ARCHIVED']).optional() });
const itemQuery = z.object({
  search: z.string().trim().max(100).optional(),
  priority: priority.optional(),
  category: z.string().max(120).optional(),
  clause: z.string().max(20).optional(),
  control: z.string().max(20).optional(),
  needsReview: z.enum(['true', 'false']).optional(),
});

export const checklistsRouter = Router();

checklistsRouter.get('/iso-references', async (req, res) => {
  const type = req.query.type === 'CLAUSE' || req.query.type === 'ANNEX_A' ? req.query.type : undefined;
  ok(res, await prisma.isoReference.findMany({ where: { type }, orderBy: [{ type: 'asc' }, { sortKey: 'asc' }] }));
});

checklistsRouter.get('/', requirePermission('checklist:read'), validate(listSchema, 'query'), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof listSchema>;
  // The status filter matches each checklist's LATEST version, which is what the list shows.
  let latestIds: string[] | undefined;
  if (q.status) {
    const rows = await prisma.$queryRaw<Array<{ templateId: string }>>`
      SELECT "templateId" FROM (
        SELECT DISTINCT ON (v."templateId") v."templateId", v.status::text AS status
        FROM "ChecklistVersion" v JOIN "ChecklistTemplate" t ON t.id = v."templateId"
        WHERE t."organisationId" = ${req.user!.organisationId}
        ORDER BY v."templateId", v."versionNumber" DESC
      ) latest WHERE status = ${q.status}`;
    latestIds = rows.map((r) => r.templateId);
  }
  const where: Prisma.ChecklistTemplateWhereInput = {
    organisationId: req.user!.organisationId,
    ...(q.search ? { OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }] } : {}),
    ...(latestIds ? { id: { in: latestIds } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.checklistTemplate.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { versions: { orderBy: { versionNumber: 'desc' }, include: { _count: { select: { items: true, assessments: true } } } } },
      ...pageArgs(q),
    }),
    prisma.checklistTemplate.count({ where }),
  ]);
  ok(res, rows, pageMeta(q, total));
});

/** Published versions available for new assessments. */
checklistsRouter.get('/published-versions', requirePermission('checklist:read', 'assessment:create'), async (req, res) => {
  ok(
    res,
    await prisma.checklistVersion.findMany({
      where: { status: 'PUBLISHED', template: { organisationId: req.user!.organisationId } },
      include: { template: { select: { id: true, title: true } }, _count: { select: { items: true } } },
      orderBy: { publishedAt: 'desc' },
    }),
  );
});

checklistsRouter.post(
  '/',
  requirePermission('checklist:create'),
  validate(z.object({ title: z.string().trim().min(3).max(200), description: nullableText(2000), category: nullableText(120), ownerId: z.string().uuid().nullable().optional() })),
  async (req, res) => created(res, await svc.createTemplate(req, req.body)),
);

checklistsRouter.get('/:id', requirePermission('checklist:read'), async (req, res) => {
  const t = await prisma.checklistTemplate.findFirst({
    where: { id: param(req, 'id'), organisationId: req.user!.organisationId },
    include: { versions: { orderBy: { versionNumber: 'desc' }, include: { _count: { select: { items: true, assessments: true } }, sourceImport: { select: { id: true, fileName: true } } } } },
  });
  if (!t) throw notFound('Checklist');
  const history = await prisma.statusHistory.findMany({ where: { entityType: 'ChecklistVersion', entityId: { in: t.versions.map((v) => v.id) } }, orderBy: { createdAt: 'desc' } });
  const actors = await prisma.user.findMany({ where: { id: { in: history.map((h) => h.actorId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  ok(res, { ...t, history: history.map((h) => ({ ...h, actor: actors.find((a) => a.id === h.actorId) ?? null })) });
});

checklistsRouter.patch(
  '/:id',
  requirePermission('checklist:update'),
  validate(z.object({ title: z.string().trim().min(3).max(200).optional(), description: nullableText(2000), category: nullableText(120), ownerId: z.string().uuid().nullable().optional() })),
  async (req, res) => {
    const id = param(req, 'id');
    const t = await prisma.checklistTemplate.findFirst({ where: { id, organisationId: req.user!.organisationId } });
    if (!t) throw notFound('Checklist');
    const updated = await prisma.checklistTemplate.update({ where: { id }, data: req.body });
    await recordAudit({ req, action: 'CHECKLIST_UPDATED', entityType: 'ChecklistTemplate', entityId: id, metadata: { fields: Object.keys(req.body) } });
    ok(res, updated);
  },
);

checklistsRouter.post(
  '/:id/versions',
  requirePermission('checklist:create', 'checklist:update'),
  validate(z.object({ fromVersionId: z.string().uuid().optional(), changeSummary: z.string().trim().min(3).max(1000) })),
  async (req, res) => created(res, await svc.createNewVersion(req, param(req, 'id'), req.body.fromVersionId, req.body.changeSummary)),
);

checklistsRouter.get('/versions/:versionId', requirePermission('checklist:read'), validate(itemQuery, 'query'), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof itemQuery>;
  const version = await prisma.checklistVersion.findFirst({
    where: { id: param(req, 'versionId'), template: { organisationId: req.user!.organisationId } },
    include: { template: true, sourceImport: { select: { id: true, fileName: true, createdAt: true } }, _count: { select: { items: true, assessments: true } } },
  });
  if (!version) throw notFound('Checklist version');
  const where: Prisma.ChecklistItemWhereInput = {
    versionId: version.id,
    priority: q.priority,
    category: q.category,
    ...(q.search
      ? { OR: [{ question: { contains: q.search, mode: 'insensitive' } }, { questionCode: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }] }
      : {}),
    AND: [
      ...(q.clause ? [{ mappings: { some: { type: 'ISO_CLAUSE' as const, reference: { startsWith: q.clause } } } }] : []),
      ...(q.control ? [{ mappings: { some: { type: 'ANNEX_A' as const, reference: q.control } } }] : []),
      ...(q.needsReview === 'true' ? [{ mappings: { some: { needsReview: true } } }] : []),
    ],
  };
  const items = await prisma.checklistItem.findMany({ where, include: svc.itemInclude, orderBy: { sequence: 'asc' } });
  const [flaggedCount, openComments, people] = await Promise.all([
    prisma.checklistItem.count({ where: { versionId: version.id, mappings: { some: { needsReview: true } } } }),
    prisma.checklistReviewComment.count({ where: { versionId: version.id, resolvedAt: null } }),
    prisma.user.findMany({ where: { id: { in: [version.createdById, version.submittedById, version.reviewerId, version.publishedById].filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
  ]);
  const person = (id: string | null) => (id ? (people.find((p) => p.id === id) ?? null) : null);
  const u = req.user!;
  const isAuthor = version.createdById === u.id;
  const isReviewer = version.reviewerId === u.id;
  const review = {
    author: person(version.createdById),
    submittedBy: person(version.submittedById),
    reviewer: person(version.reviewerId),
    publishedBy: person(version.publishedById),
    openComments,
    canPublish: version.status === 'UNDER_REVIEW' && u.permissions.has('checklist:approve') && !isAuthor && (!version.reviewerId || isReviewer),
    canReturn: version.status === 'UNDER_REVIEW' && (u.permissions.has('checklist:review') || u.permissions.has('checklist:approve')) && !isAuthor && (!version.reviewerId || isReviewer),
    canConfirmMappings: (version.status === 'DRAFT' && u.permissions.has('checklist:update')) || (version.status === 'UNDER_REVIEW' && isReviewer),
    blocked:
      version.status === 'UNDER_REVIEW' && u.permissions.has('checklist:approve') && (isAuthor || (version.reviewerId && !isReviewer))
        ? isAuthor
          ? 'You wrote this version, so the named reviewer must publish or return it.'
          : 'Only the named reviewer can publish or return this version.'
        : null,
  };
  ok(res, { ...version, items, flaggedCount, review });
});

checklistsRouter.get('/versions/:versionId/export', requirePermission('checklist:export', 'checklist:read'), async (req, res) => {
  const version = await prisma.checklistVersion.findFirst({
    where: { id: param(req, 'versionId'), template: { organisationId: req.user!.organisationId } },
    include: { template: true, items: { include: svc.itemInclude, orderBy: { sequence: 'asc' } } },
  });
  if (!version) throw notFound('Checklist version');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`v${version.versionNumber}`);
  ws.columns = [
    { header: 'Question ID', key: 'code', width: 12 },
    { header: 'Question', key: 'q', width: 60 },
    { header: 'Description', key: 'd', width: 40 },
    { header: 'Guidance', key: 'g', width: 40 },
    { header: 'ISO Clauses', key: 'cl', width: 18 },
    { header: 'Annex A Controls', key: 'an', width: 24 },
    { header: 'Internal Policy', key: 'pol', width: 18 },
    { header: 'Evidence Requirement', key: 'ev', width: 40 },
    { header: 'Evidence Mandatory', key: 'em', width: 12 },
    { header: 'Owner', key: 'owner', width: 22 },
    { header: 'Priority', key: 'p', width: 10 },
    { header: 'Category', key: 'cat', width: 22 },
    { header: 'Status', key: 's', width: 10 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const i of version.items) {
    ws.addRow({
      code: i.questionCode,
      q: i.question,
      d: i.description,
      g: i.guidance,
      cl: i.mappings.filter((m) => m.type === 'ISO_CLAUSE').map((m) => m.reference).join(', '),
      an: i.mappings.filter((m) => m.type === 'ANNEX_A').map((m) => m.reference).join(', '),
      pol: i.internalPolicyRef,
      ev: i.evidenceRequirement,
      em: i.evidenceMandatory ? 'Yes' : 'No',
      owner: i.defaultOwner?.name,
      p: i.priority,
      cat: i.category,
      s: i.status,
    });
  }
  await recordAudit({ req, action: 'EXPORT', entityType: 'ChecklistVersion', entityId: version.id, metadata: { format: 'xlsx' } });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="checklist-v${version.versionNumber}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});

checklistsRouter.post(
  '/versions/:versionId/items',
  requirePermission('checklist:update'),
  validate(itemSchema.extend({ mappings: z.array(mappingSchema).max(40).default([]) })),
  async (req, res) => {
    const { mappings, ...item } = req.body;
    created(res, await svc.addItem(req, param(req, 'versionId'), item, mappings));
  },
);

checklistsRouter.post(
  '/versions/:versionId/reorder',
  requirePermission('checklist:update'),
  validate(z.object({ itemIds: z.array(z.string().uuid()).min(1).max(2000) })),
  async (req, res) => {
    await svc.reorderItems(req, param(req, 'versionId'), req.body.itemIds);
    ok(res, { reordered: true });
  },
);

checklistsRouter.patch('/items/:itemId', requirePermission('checklist:update'), validate(itemSchema.partial()), async (req, res) =>
  ok(res, await svc.updateItem(req, param(req, 'itemId'), req.body)),
);

checklistsRouter.delete('/items/:itemId', requirePermission('checklist:delete', 'checklist:update'), async (req, res) => {
  await svc.deleteItem(req, param(req, 'itemId'));
  ok(res, { deleted: true });
});

checklistsRouter.put('/items/:itemId/mappings', requirePermission('checklist:update'), validate(z.object({ mappings: z.array(mappingSchema).max(40) })), async (req, res) =>
  ok(res, await svc.setMappings(req, param(req, 'itemId'), req.body.mappings)),
);

const transitionBody = z.object({
  reason: z.string().trim().min(3).max(1000).optional(),
  reviewerId: z.string().uuid().optional(),
  effectiveDate: z.coerce.date().optional(),
});

checklistsRouter.post('/versions/:versionId/submit-review', requirePermission('checklist:update'), validate(transitionBody), async (req, res) =>
  ok(res, await svc.transitionVersion(req, param(req, 'versionId'), 'submit', req.body)),
);
checklistsRouter.post('/versions/:versionId/return-to-draft', requirePermission('checklist:review', 'checklist:approve'), validate(transitionBody), async (req, res) =>
  ok(res, await svc.transitionVersion(req, param(req, 'versionId'), 'return', req.body)),
);
checklistsRouter.post('/versions/:versionId/publish', requirePermission('checklist:approve'), validate(transitionBody), async (req, res) =>
  ok(res, await svc.transitionVersion(req, param(req, 'versionId'), 'publish', req.body)),
);
checklistsRouter.get('/versions/:versionId/eligible-reviewers', requirePermission('checklist:update'), async (req, res) =>
  ok(res, await svc.eligibleReviewers(req, param(req, 'versionId'))),
);
checklistsRouter.get('/versions/:versionId/review-comments', requirePermission('checklist:read'), async (req, res) =>
  ok(res, await svc.listReviewComments(req, param(req, 'versionId'))),
);
checklistsRouter.post(
  '/versions/:versionId/review-comments',
  requirePermission('checklist:update', 'checklist:review', 'checklist:approve'),
  validate(z.object({ itemId: z.string().uuid().nullable().optional(), body: z.string().trim().min(2).max(2000) })),
  async (req, res) => created(res, await svc.addReviewComment(req, param(req, 'versionId'), req.body)),
);
checklistsRouter.post('/review-comments/:id/resolve', requirePermission('checklist:update', 'checklist:review', 'checklist:approve'), async (req, res) =>
  ok(res, await svc.resolveReviewComment(req, param(req, 'id'))),
);
checklistsRouter.post(
  '/items/:itemId/mappings/confirm',
  requirePermission('checklist:update', 'checklist:review', 'checklist:approve'),
  validate(z.object({ note: z.string().trim().max(500).nullable().optional() })),
  async (req, res) => ok(res, await svc.confirmMappings(req, param(req, 'itemId'), req.body.note)),
);
checklistsRouter.post('/versions/:versionId/archive', requirePermission('checklist:approve'), validate(transitionBody), async (req, res) =>
  ok(res, await svc.transitionVersion(req, param(req, 'versionId'), 'archive', req.body)),
);
