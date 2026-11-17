import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { prisma } from '../../config/prisma.js';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { recordAudit } from '../../services/audit.service.js';
import { unitWhere } from '../../services/scope.service.js';
import { startOfToday } from '../../services/workflow.service.js';
import { created, ok, pageArgs, pageMeta, paginationSchema, param } from '../../utils/http.js';
import * as svc from './findings.service.js';

const severity = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'OBSERVATION']);
const category = z.enum(['MAJOR_NONCONFORMITY', 'MINOR_NONCONFORMITY', 'OBSERVATION', 'OPPORTUNITY_FOR_IMPROVEMENT']);
const findingStatus = z.enum(['OPEN', 'ASSIGNED', 'ACTION_IN_PROGRESS', 'READY_FOR_VERIFICATION', 'CLOSED']);
const actionStatus = z.enum(['PLANNED', 'IN_PROGRESS', 'SUBMITTED_FOR_VERIFICATION', 'RETURNED', 'VERIFIED']);
const text = (max: number) => z.string().trim().max(max);

const findingSchema = z.object({
  assessmentId: z.string().uuid(),
  itemId: z.string().uuid().nullable().optional(),
  category,
  severity,
  title: text(200).min(3),
  description: text(4000).min(5),
  auditorComments: text(4000).nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  dueDate: z.coerce.date(),
});

const actionSchema = z.object({
  rootCause: text(4000).nullable().optional(),
  immediateCorrection: text(4000).nullable().optional(),
  correctiveAction: text(4000).min(5),
  ownerId: z.string().uuid(),
  targetDate: z.coerce.date(),
});

const findingList = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.string().optional(),
  severity: severity.optional(),
  siteId: z.string().uuid().optional(),
  periodLabel: z.string().max(60).optional(),
  assessmentId: z.string().uuid().optional(),
  ownerId: z.string().optional(),
  overdue: z.enum(['true', 'false']).optional(),
  format: z.enum(['json', 'csv', 'xlsx']).default('json'),
});

const findingInclude = {
  site: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
  raisedBy: { select: { id: true, name: true } },
  assessment: { select: { id: true, code: true, title: true, periodLabel: true } },
  item: { select: { id: true, questionCode: true, question: true } },
  _count: { select: { actions: true } },
} satisfies Prisma.FindingInclude;

export const findingsRouter = Router();

findingsRouter.get('/', requirePermission('finding:read'), validate(findingList, 'query'), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof findingList>;
  const statuses = q.status?.split(',').filter((s) => findingStatus.safeParse(s).success) as z.infer<typeof findingStatus>[] | undefined;
  const where: Prisma.FindingWhereInput = {
    ...unitWhere(req.user!),
    severity: q.severity,
    siteId: q.siteId,
    assessmentId: q.assessmentId,
    ...(q.periodLabel ? { assessment: { periodLabel: q.periodLabel } } : {}),
    ownerId: q.ownerId === 'me' ? req.user!.id : q.ownerId,
    ...(statuses?.length ? { status: { in: statuses } } : {}),
    ...(q.overdue === 'true' ? { dueDate: { lt: startOfToday() }, status: { not: 'CLOSED' } } : {}),
    ...(q.search ? { AND: [{ OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }] }] } : {}),
  };
  if (q.format !== 'json') {
    const rows = await prisma.finding.findMany({ where, include: findingInclude, orderBy: { createdAt: 'desc' } });
    const header = ['Finding ID', 'Assessment', 'Question', 'Category', 'Severity', 'Title', 'Description', 'Owner', 'Raised By', 'Created', 'Due', 'Status', 'Closure Recommendation'];
    const data = rows.map((f) => [f.code, f.assessment.code, f.item?.questionCode ?? '', f.category, f.severity, f.title, f.description, f.owner?.name ?? '', f.raisedBy.name, f.createdAt.toISOString().slice(0, 10), f.dueDate.toISOString().slice(0, 10), f.status, f.closureRecommendation ?? '']);
    await recordAudit({ req, action: 'EXPORT', entityType: 'Finding', metadata: { format: q.format, rows: rows.length } });
    return sendTable(res, q.format, 'findings', header, data);
  }
  const [rows, total] = await Promise.all([
    prisma.finding.findMany({ where, include: findingInclude, orderBy: [{ status: 'asc' }, { dueDate: 'asc' }], ...pageArgs(q) }),
    prisma.finding.count({ where }),
  ]);
  const today = startOfToday();
  ok(res, rows.map((f) => ({ ...f, overdue: f.status !== 'CLOSED' && f.dueDate < today })), pageMeta(q, total));
});

findingsRouter.post('/', requirePermission('finding:create'), validate(findingSchema), async (req, res) => created(res, await svc.createFinding(req, req.body)));

findingsRouter.get('/:id', requirePermission('finding:read'), async (req, res) => {
  const f = await svc.loadFinding(req, param(req, 'id'));
  const full = await prisma.finding.findUniqueOrThrow({
    where: { id: f.id },
    include: {
      ...findingInclude,
      actions: { include: { owner: { select: { id: true, name: true } }, _count: { select: { evidence: true, updates: true } } }, orderBy: { createdAt: 'asc' } },
      evidence: { where: { deletedAt: null, correctiveActionId: null }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } },
      comments: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
    },
  });
  const history = await prisma.statusHistory.findMany({ where: { entityType: 'Finding', entityId: f.id }, orderBy: { createdAt: 'asc' } });
  const actors = await prisma.user.findMany({ where: { id: { in: history.map((h) => h.actorId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const u = req.user!;
  ok(res, {
    ...full,
    overdue: full.status !== 'CLOSED' && full.dueDate < startOfToday(),
    history: history.map((h) => ({ ...h, actor: actors.find((a) => a.id === h.actorId) ?? null })),
    actionsAllowed: {
      edit: full.status !== 'CLOSED' && (u.permissions.has('finding:review') || full.raisedById === u.id),
      assign: full.status !== 'CLOSED' && u.permissions.has('finding:assign'),
      planAction: full.status !== 'CLOSED' && (u.permissions.has('corrective_action:create') || full.ownerId === u.id),
      close: full.status !== 'CLOSED' && u.permissions.has('finding:review'),
    },
  });
});

findingsRouter.patch('/:id', requirePermission('finding:update'), validate(findingSchema.omit({ assessmentId: true, itemId: true, ownerId: true }).partial()), async (req, res) =>
  ok(res, await svc.updateFinding(req, param(req, 'id'), req.body)),
);
findingsRouter.post('/:id/assign', requirePermission('finding:assign'), validate(z.object({ ownerId: z.string().uuid(), dueDate: z.coerce.date().nullable().optional() })), async (req, res) =>
  ok(res, await svc.assignFinding(req, param(req, 'id'), req.body.ownerId, req.body.dueDate)),
);
findingsRouter.post('/:id/actions', requirePermission('corrective_action:create', 'finding:update', 'corrective_action:update') /* finding owners plan their own actions; the service checks ownership */, validate(actionSchema), async (req, res) =>
  created(res, await svc.createAction(req, param(req, 'id'), req.body)),
);
findingsRouter.post(
  '/:id/close',
  requirePermission('finding:review'),
  validate(z.object({ closureRecommendation: text(4000).min(5), overrideReason: text(2000).nullable().optional() })),
  async (req, res) => ok(res, await svc.closeFinding(req, param(req, 'id'), req.body.closureRecommendation, req.body.overrideReason)),
);
findingsRouter.post('/:id/comments', requirePermission('finding:read'), validate(z.object({ body: text(4000).min(1) })), async (req, res) =>
  created(res, await svc.commentOnFinding(req, param(req, 'id'), req.body.body)),
);

// ───────────── Corrective actions ─────────────

const actionList = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.string().optional(),
  ownerId: z.string().optional(),
  siteId: z.string().uuid().optional(),
  periodLabel: z.string().max(60).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  format: z.enum(['json', 'csv', 'xlsx']).default('json'),
});

export const actionsRouter = Router();

actionsRouter.get('/', requirePermission('corrective_action:read'), validate(actionList, 'query'), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof actionList>;
  const statuses = q.status?.split(',').filter((s) => actionStatus.safeParse(s).success) as z.infer<typeof actionStatus>[] | undefined;
  const where: Prisma.CorrectiveActionWhereInput = {
    finding: { ...unitWhere(req.user!), siteId: q.siteId, ...(q.periodLabel ? { assessment: { periodLabel: q.periodLabel } } : {}) },
    ownerId: q.ownerId === 'me' ? req.user!.id : q.ownerId,
    ...(statuses?.length ? { status: { in: statuses } } : {}),
    ...(q.overdue === 'true' ? { targetDate: { lt: startOfToday() }, status: { not: 'VERIFIED' } } : {}),
    ...(q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { correctiveAction: { contains: q.search, mode: 'insensitive' } }, { finding: { code: { contains: q.search, mode: 'insensitive' } } }] } : {}),
  };
  const include = {
    owner: { select: { id: true, name: true } },
    finding: { select: { id: true, code: true, title: true, severity: true, status: true, site: { select: { id: true, name: true } } } },
    _count: { select: { evidence: true, updates: true } },
  } satisfies Prisma.CorrectiveActionInclude;
  if (q.format !== 'json') {
    const rows = await prisma.correctiveAction.findMany({ where, include, orderBy: { targetDate: 'asc' } });
    const header = ['Action ID', 'Finding', 'Severity', 'Root Cause', 'Immediate Correction', 'Corrective Action', 'Owner', 'Target Date', 'Progress %', 'Status', 'Verified At'];
    const data = rows.map((a) => [a.code, a.finding.code, a.finding.severity, a.rootCause ?? '', a.immediateCorrection ?? '', a.correctiveAction, a.owner.name, a.targetDate.toISOString().slice(0, 10), a.progressPercent, a.status, a.verifiedAt?.toISOString().slice(0, 10) ?? '']);
    await recordAudit({ req, action: 'EXPORT', entityType: 'CorrectiveAction', metadata: { format: q.format, rows: rows.length } });
    return sendTable(res, q.format, 'corrective-actions', header, data);
  }
  const [rows, total] = await Promise.all([
    prisma.correctiveAction.findMany({ where, include, orderBy: [{ targetDate: 'asc' }], ...pageArgs(q) }),
    prisma.correctiveAction.count({ where }),
  ]);
  const today = startOfToday();
  ok(res, rows.map((a) => ({ ...a, overdue: a.status !== 'VERIFIED' && a.targetDate < today })), pageMeta(q, total));
});

actionsRouter.get('/:id', requirePermission('corrective_action:read'), async (req, res) => {
  const ca = await svc.loadAction(req, param(req, 'id'));
  const full = await prisma.correctiveAction.findUniqueOrThrow({
    where: { id: ca.id },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      finding: { include: { site: { select: { id: true, name: true } }, assessment: { select: { id: true, code: true } }, raisedBy: { select: { id: true, name: true } } } },
      updates: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } },
      evidence: { where: { deletedAt: null }, include: { versions: { orderBy: { version: 'desc' }, take: 1 }, uploader: { select: { id: true, name: true } } } },
    },
  });
  const history = await prisma.statusHistory.findMany({ where: { entityType: 'CorrectiveAction', entityId: ca.id }, orderBy: { createdAt: 'asc' } });
  const actors = await prisma.user.findMany({ where: { id: { in: history.map((h) => h.actorId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const u = req.user!;
  const editable = ['PLANNED', 'IN_PROGRESS', 'RETURNED'].includes(full.status) && (full.ownerId === u.id || u.permissions.has('corrective_action:create'));
  const canReview = full.status === 'SUBMITTED_FOR_VERIFICATION' && u.permissions.has('corrective_action:review');
  const verifyBlocked = canReview && (await svc.isActionPreparer(u.id, full)) ? 'You own or submitted this corrective action, so someone else must verify it.' : null;
  ok(res, {
    ...full,
    overdue: full.status !== 'VERIFIED' && full.targetDate < startOfToday(),
    history: history.map((h) => ({ ...h, actor: actors.find((a) => a.id === h.actorId) ?? null })),
    actionsAllowed: { edit: editable, submit: editable, verify: canReview && !verifyBlocked },
    blocked: verifyBlocked ? { verify: verifyBlocked } : {},
  });
});

actionsRouter.patch('/:id', requirePermission('corrective_action:update'), validate(actionSchema.partial()), async (req, res) => ok(res, await svc.updateAction(req, param(req, 'id'), req.body)));
actionsRouter.post('/:id/updates', requirePermission('corrective_action:update'), validate(z.object({ note: text(4000).min(3), progressPercent: z.number().int().min(0).max(100).nullable().optional() })), async (req, res) =>
  created(res, await svc.addProgress(req, param(req, 'id'), req.body.note, req.body.progressPercent)),
);
actionsRouter.post('/:id/submit', requirePermission('corrective_action:submit', 'corrective_action:update'), validate(z.object({ closureNotes: text(4000).min(5) })), async (req, res) => {
  await svc.submitAction(req, param(req, 'id'), req.body.closureNotes);
  ok(res, { submitted: true });
});
actionsRouter.post('/:id/verify', requirePermission('corrective_action:review'), validate(z.object({ decision: z.enum(['VERIFIED', 'RETURNED']), comment: text(4000).nullable().optional() })), async (req, res) => {
  await svc.verifyAction(req, param(req, 'id'), req.body.decision, req.body.comment);
  ok(res, { decision: req.body.decision });
});

/** Shared CSV/XLSX table writer with spreadsheet formula-injection protection. */
export async function sendTable(res: import('express').Response, format: 'csv' | 'xlsx', name: string, header: string[], data: unknown[][]) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv') {
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${stamp}.csv"`);
    return res.send('﻿' + [header, ...data].map((r) => r.map(esc).join(',')).join('\r\n'));
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(name.slice(0, 31));
  ws.addRow(header).font = { bold: true };
  data.forEach((r) => ws.addRow(r));
  ws.columns.forEach((c) => (c.width = 22));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${stamp}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}
