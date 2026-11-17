import { Router } from 'express';
import { parsePeriod, PERIOD_FORMAT_HINT } from '../../utils/period.js';
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
import { notFound } from '../../utils/errors.js';
import * as svc from './assessments.service.js';
import * as reviews from '../reviews/reviews.service.js';

const statusEnum = z.enum(['DRAFT', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED_FOR_AUDIT', 'UNDER_REVIEW', 'CLARIFICATION_REQUIRED', 'REVIEWED', 'PENDING_APPROVAL', 'APPROVED']);
const responseStatus = z.enum(['COMPLIANT', 'PARTIALLY_COMPLIANT', 'NON_COMPLIANT', 'NOT_APPLICABLE', 'NOT_ASSESSED']);

const createSchema = z.object({
  title: z.string().trim().min(3).max(200),
  siteId: z.string().uuid(),
  departmentId: z.string().uuid(),
  checklistVersionId: z.string().uuid(),
  // The period label is a fixed format (see utils/period.ts); its start/end dates are derived from it.
  periodLabel: z.string().trim().max(30).refine((v) => parsePeriod(v) !== null, PERIOD_FORMAT_HINT),
  periodStart: z.coerce.date().optional(),
  periodEnd: z.coerce.date().optional(),
  startDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  ownerId: z.string().uuid(),
  scope: z.string().trim().max(2000).nullable().optional(),
  approvalRequired: z.boolean().optional(),
  assignDefaultOwners: z.boolean().optional(),
});

const listSchema = paginationSchema.extend({
  status: z.string().optional(), // comma-separated statuses
  siteId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  periodLabel: z.string().max(60).optional(),
  search: z.string().trim().max(100).optional(),
  mine: z.enum(['true', 'false']).optional(),
});

const assessmentInclude = {
  site: { select: { id: true, name: true, code: true } },
  department: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true, email: true } },
  checklistVersion: { select: { id: true, versionNumber: true, template: { select: { id: true, title: true } } } },
  _count: { select: { assignments: true, findings: true, evidence: true } },
} satisfies Prisma.AssessmentInclude;

export const assessmentsRouter = Router();

assessmentsRouter.get('/', requirePermission('assessment:read'), validate(listSchema, 'query'), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof listSchema>;
  const user = req.user!;
  const statuses = q.status?.split(',').filter((s) => statusEnum.safeParse(s).success) as z.infer<typeof statusEnum>[] | undefined;
  const where: Prisma.AssessmentWhereInput = {
    ...unitWhere(user),
    siteId: q.siteId,
    departmentId: q.departmentId,
    periodLabel: q.periodLabel,
    ...(statuses?.length ? { status: { in: statuses } } : {}),
    AND: [
      ...(q.search ? [{ OR: [{ title: { contains: q.search, mode: 'insensitive' as const } }, { code: { contains: q.search, mode: 'insensitive' as const } }] }] : []),
      ...(q.mine === 'true' ? [{ OR: [{ ownerId: user.id }, { assignments: { some: { assigneeId: user.id } } }] }] : []),
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.assessment.findMany({ where, include: assessmentInclude, orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }], ...pageArgs(q) }),
    prisma.assessment.count({ where }),
  ]);
  // Completion is computed per row from live responses.
  const progress = await prisma.assessmentResponse.groupBy({
    by: ['assessmentId'],
    where: { assessmentId: { in: rows.map((r) => r.id) }, status: { not: 'NOT_ASSESSED' } },
    _count: true,
  });
  const totals = await prisma.assessmentResponse.groupBy({ by: ['assessmentId'], where: { assessmentId: { in: rows.map((r) => r.id) } }, _count: true });
  ok(
    res,
    rows.map((r) => {
      const answered = progress.find((p) => p.assessmentId === r.id)?._count ?? 0;
      const all = totals.find((p) => p.assessmentId === r.id)?._count ?? 0;
      return { ...r, answered, totalItems: all, overdue: r.dueDate < startOfToday() && !['APPROVED'].includes(r.status) };
    }),
    pageMeta(q, total),
  );
});

/** Period labels in scope, for the global period selector. */
assessmentsRouter.get('/periods', requirePermission('assessment:read', 'dashboard:read'), async (req, res) => {
  const rows = await prisma.assessment.findMany({
    where: unitWhere(req.user!),
    select: { periodLabel: true, periodStart: true },
    distinct: ['periodLabel'],
    orderBy: { periodStart: 'desc' },
  });
  ok(res, rows);
});

/** Pending question assignments for the current user, with overdue flags. */
assessmentsRouter.get('/my-assignments', requirePermission('assessment:read'), async (req, res) => {
  const siteId = typeof req.query.siteId === 'string' && req.query.siteId ? req.query.siteId : undefined;
  const periodLabel = typeof req.query.periodLabel === 'string' && req.query.periodLabel ? req.query.periodLabel : undefined;
  const rows = await prisma.assessmentAssignment.findMany({
    where: { assigneeId: req.user!.id, assessment: { status: { in: svc.EDITABLE_STATUSES }, siteId, periodLabel } },
    include: {
      item: { select: { id: true, questionCode: true, question: true, priority: true } },
      assessment: { select: { id: true, code: true, title: true, dueDate: true, status: true } },
    },
    orderBy: { assignedAt: 'desc' },
  });
  const responses = await prisma.assessmentResponse.findMany({
    where: { OR: rows.map((r) => ({ assessmentId: r.assessmentId, itemId: r.itemId })) },
    select: { assessmentId: true, itemId: true, status: true },
  });
  const today = startOfToday();
  ok(
    res,
    rows.map((r) => {
      const status = responses.find((x) => x.assessmentId === r.assessmentId && x.itemId === r.itemId)?.status ?? 'NOT_ASSESSED';
      const due = r.dueDate ?? r.assessment.dueDate;
      return { ...r, responseStatus: status, completed: status !== 'NOT_ASSESSED', overdue: status === 'NOT_ASSESSED' && due < today };
    }),
  );
});

assessmentsRouter.post('/', requirePermission('assessment:create'), validate(createSchema), async (req, res) => created(res, await svc.createAssessment(req, req.body)));

assessmentsRouter.get('/:id', requirePermission('assessment:read'), async (req, res) => {
  const a = await svc.loadAssessment(req, param(req, 'id'));
  const full = await prisma.assessment.findUniqueOrThrow({
    where: { id: a.id },
    include: {
      ...assessmentInclude,
      createdBy: { select: { id: true, name: true } },
      scoringPolicy: true,
      approvals: { include: { approver: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } },
      reports: { select: { id: true, code: true, version: true, generatedAt: true }, orderBy: { version: 'desc' } },
      submissions: { select: { id: true, round: true, submittedById: true, createdAt: true }, orderBy: { round: 'desc' } },
    },
  });
  const [metrics, actions, openClarifications, assignmentStats, coverage] = await Promise.all([
    svc.assessmentMetrics(a.id),
    svc.allowedActions(req, a),
    svc.openClarificationItemIds(a.id, a.round),
    prisma.assessmentAssignment.groupBy({ by: ['assigneeId'], where: { assessmentId: a.id }, _count: true }),
    svc.reviewCoverage(a),
  ]);
  const assignees = await prisma.user.findMany({ where: { id: { in: assignmentStats.map((x) => x.assigneeId) } }, select: { id: true, name: true } });
  const overallReview = await prisma.auditorReview.findFirst({
    where: { assessmentId: a.id, decision: 'REVIEW_SUBMITTED' },
    orderBy: { createdAt: 'desc' },
    include: { auditor: { select: { id: true, name: true } } },
  });
  // Warn when the owner cannot open the assessment (e.g. created before owner checks existed).
  const ownerRoles = await prisma.userRole.findMany({ where: { userId: full.ownerId }, select: { siteId: true, departmentId: true } });
  const ownerHasAccess = ownerRoles.some((r) => (r.siteId === null || r.siteId === full.siteId) && (r.departmentId === null || r.departmentId === full.departmentId));
  ok(res, {
    ...full,
    ownerHasAccess,
    reviewProgress: { reviewable: coverage.reviewable, decided: coverage.decided, pending: coverage.pending.length },
    metrics,
    actions,
    openClarificationCount: openClarifications.size,
    overallReview,
    assignmentSummary: assignmentStats.map((s) => ({ assignee: assignees.find((u) => u.id === s.assigneeId), count: s._count })),
  });
});

assessmentsRouter.post(
  '/:id/owner',
  requirePermission('assessment:update'),
  validate(z.object({ ownerId: z.string().uuid(), reason: z.string().trim().min(3).max(500) })),
  async (req, res) => ok(res, await svc.changeOwner(req, param(req, 'id'), req.body.ownerId, req.body.reason)),
);

assessmentsRouter.patch('/:id', requirePermission('assessment:update'), validate(createSchema.omit({ siteId: true, departmentId: true, checklistVersionId: true }).partial()), async (req, res) =>
  ok(res, await svc.updateAssessment(req, param(req, 'id'), req.body)),
);

const itemsQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: responseStatus.optional(),
  assignee: z.string().optional(), // "me" | user id | "unassigned"
  clause: z.string().max(10).optional(),
  flagged: z.enum(['true', 'false']).optional(),
});

/** Question workspace: items with response, assignment, evidence, latest review and source-row observations. */
assessmentsRouter.get('/:id/items', requirePermission('assessment:read'), validate(itemsQuery, 'query'), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof itemsQuery>;
  const a = await svc.loadAssessment(req, param(req, 'id'));
  const items = await prisma.checklistItem.findMany({
    where: {
      versionId: a.checklistVersionId,
      status: 'ACTIVE',
      ...(q.search ? { OR: [{ question: { contains: q.search, mode: 'insensitive' } }, { questionCode: { contains: q.search, mode: 'insensitive' } }] } : {}),
      ...(q.clause ? { mappings: { some: { OR: [{ reference: { startsWith: `${q.clause}.` } }, { reference: q.clause }] } } } : {}),
    },
    include: { mappings: true },
    orderBy: { sequence: 'asc' },
  });
  const [responses, assignments, evidence, latestReviews, commentCounts, open] = await Promise.all([
    prisma.assessmentResponse.findMany({ where: { assessmentId: a.id }, include: { responder: { select: { id: true, name: true } } } }),
    prisma.assessmentAssignment.findMany({ where: { assessmentId: a.id }, include: { assignee: { select: { id: true, name: true } } } }),
    prisma.evidence.findMany({
      where: { assessmentId: a.id, deletedAt: null },
      select: { id: true, itemId: true, code: true, title: true, verificationStatus: true, currentVersion: true, versions: { orderBy: { version: 'desc' }, take: 1, select: { originalFilename: true, scanStatus: true, size: true, mimeType: true } } },
    }),
    prisma.auditorReview.findMany({ where: { assessmentId: a.id, itemId: { not: null } }, orderBy: { createdAt: 'desc' }, include: { auditor: { select: { id: true, name: true } } } }),
    prisma.reviewComment.groupBy({ by: ['itemId'], where: { assessmentId: a.id }, _count: true }),
    svc.openClarificationItemIds(a.id, a.round),
  ]);
  const coverage = ['UNDER_REVIEW', 'SUBMITTED_FOR_AUDIT'].includes(a.status) ? await svc.reviewCoverage(a) : null;
  const me = req.user!.id;
  const rows = items
    .map((item) => {
      const response = responses.find((r) => r.itemId === item.id) ?? null;
      const assignment = assignments.find((x) => x.itemId === item.id) ?? null;
      return {
        ...item,
        response,
        assignment,
        evidence: evidence.filter((e) => e.itemId === item.id),
        // The answer-level decision (file decisions are shown on each file).
        latestReview: latestReviews.find((r) => r.itemId === item.id && !r.evidenceId && r.decision !== 'COMMENT') ?? null,
        commentCount: commentCounts.find((c) => c.itemId === item.id)?._count ?? 0,
        clarificationOpen: open.has(item.id),
        reviewPending: coverage ? (coverage.pending.find((p) => p.itemId === item.id)?.problems ?? []) : [],
      };
    })
    .filter((r) => !q.status || (r.response?.status ?? 'NOT_ASSESSED') === q.status)
    .filter((r) => !q.assignee || (q.assignee === 'me' ? r.assignment?.assigneeId === me : q.assignee === 'unassigned' ? !r.assignment : r.assignment?.assigneeId === q.assignee))
    .filter((r) => q.flagged !== 'true' || r.clarificationOpen);
  ok(res, rows);
});

assessmentsRouter.get('/:id/items/:itemId', requirePermission('assessment:read'), async (req, res) => {
  const a = await svc.loadAssessment(req, param(req, 'id'));
  const item = await prisma.checklistItem.findFirst({
    where: { id: param(req, 'itemId'), versionId: a.checklistVersionId },
    include: { mappings: true, sourceRow: true, defaultOwner: { select: { id: true, name: true } } },
  });
  if (!item) throw notFound('Question');
  // Previous observations: the item's own source row, or the source row of the same question in an earlier version.
  let sourceRow = item.sourceRow;
  if (!sourceRow) {
    const earlier = await prisma.checklistItem.findFirst({
      where: { questionCode: item.questionCode, sourceRowId: { not: null }, version: { templateId: (await prisma.checklistVersion.findUniqueOrThrow({ where: { id: a.checklistVersionId } })).templateId } },
      include: { sourceRow: true },
      orderBy: { createdAt: 'asc' },
    });
    sourceRow = earlier?.sourceRow ?? null;
  }
  const [response, assignment, evidence, reviewsList, comments, findings, history] = await Promise.all([
    prisma.assessmentResponse.findUnique({ where: { assessmentId_itemId: { assessmentId: a.id, itemId: item.id } }, include: { responder: { select: { id: true, name: true } } } }),
    prisma.assessmentAssignment.findUnique({ where: { assessmentId_itemId: { assessmentId: a.id, itemId: item.id } }, include: { assignee: { select: { id: true, name: true } } } }),
    prisma.evidence.findMany({
      where: { assessmentId: a.id, itemId: item.id, deletedAt: null },
      include: { versions: { orderBy: { version: 'desc' } }, uploader: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.auditorReview.findMany({ where: { assessmentId: a.id, itemId: item.id }, orderBy: { createdAt: 'desc' }, include: { auditor: { select: { id: true, name: true } } } }),
    prisma.reviewComment.findMany({ where: { assessmentId: a.id, itemId: item.id }, orderBy: { createdAt: 'asc' }, include: { author: { select: { id: true, name: true } } } }),
    prisma.finding.findMany({ where: { assessmentId: a.id, itemId: item.id }, select: { id: true, code: true, title: true, severity: true, status: true } }),
    prisma.auditEvent.findMany({
      where: { entityType: 'AssessmentResponse', metadata: { path: ['itemId'], equals: item.id }, AND: { metadata: { path: ['assessmentId'], equals: a.id } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, actorEmail: true, createdAt: true, metadata: true },
    }),
  ]);
  const open = await svc.openClarificationItemIds(a.id, a.round);
  ok(res, { ...item, sourceRow, response, assignment, evidence, reviews: reviewsList, comments, findings, responseHistory: history, clarificationOpen: open.has(item.id) });
});

assessmentsRouter.put(
  '/:id/responses/:itemId',
  requirePermission('response:update'),
  validate(z.object({ status: responseStatus, comment: z.string().trim().max(4000).nullable().optional(), justification: z.string().trim().max(4000).nullable().optional() })),
  async (req, res) => ok(res, await svc.saveResponse(req, param(req, 'id'), param(req, 'itemId'), req.body)),
);

assessmentsRouter.post('/:id/release', requirePermission('assessment:update'), async (req, res) => ok(res, await svc.releaseAssessment(req, param(req, 'id'))));

assessmentsRouter.post(
  '/:id/assign',
  requirePermission('assessment:assign'),
  validate(z.object({ itemIds: z.array(z.string().uuid()).min(1).max(1000), assigneeId: z.string().uuid(), dueDate: z.coerce.date().nullable().optional() })),
  async (req, res) => {
    await svc.assignItems(req, param(req, 'id'), req.body.itemIds, req.body.assigneeId, req.body.dueDate);
    ok(res, { assigned: req.body.itemIds.length });
  },
);

assessmentsRouter.post('/:id/unassign', requirePermission('assessment:assign'), validate(z.object({ itemIds: z.array(z.string().uuid()).min(1) })), async (req, res) => {
  await svc.unassignItems(req, param(req, 'id'), req.body.itemIds);
  ok(res, { unassigned: req.body.itemIds.length });
});

assessmentsRouter.get('/:id/validation', requirePermission('assessment:read'), async (req, res) => {
  const a = await svc.loadAssessment(req, param(req, 'id'));
  const missing = await svc.validateForSubmission(a.id);
  ok(res, { ready: missing.length === 0, missing });
});

assessmentsRouter.post('/:id/submit', requirePermission('assessment:submit'), async (req, res) => ok(res, await svc.submitAssessment(req, param(req, 'id'))));
assessmentsRouter.post('/:id/start-review', requirePermission('assessment:review'), async (req, res) => ok(res, await svc.startReview(req, param(req, 'id'))));
assessmentsRouter.post('/:id/review/submit', requirePermission('assessment:review'), validate(z.object({ opinion: z.string().trim().min(20, 'Write at least 20 characters: your overall conclusion is printed in the final report').max(5000) })), async (req, res) =>
  ok(res, await svc.submitReview(req, param(req, 'id'), req.body.opinion)),
);
assessmentsRouter.post(
  '/:id/items/:itemId/review',
  requirePermission('assessment:review'),
  validate(
    z.object({
      decision: z.enum(['ACCEPTED', 'REJECTED', 'CLARIFICATION_REQUESTED', 'COMMENT']),
      evidenceId: z.string().uuid().nullable().optional(),
      reason: z.string().trim().max(2000).nullable().optional(),
      comments: z.string().trim().max(4000).nullable().optional(),
    }),
  ),
  async (req, res) => created(res, await reviews.reviewItem(req, param(req, 'id'), param(req, 'itemId'), req.body)),
);
assessmentsRouter.post(
  '/:id/comments',
  requirePermission('assessment:read'),
  validate(z.object({ itemId: z.string().uuid().nullable().optional(), body: z.string().trim().min(1).max(4000) })),
  async (req, res) => created(res, await reviews.addComment(req, param(req, 'id'), req.body.itemId ?? null, req.body.body)),
);
assessmentsRouter.post(
  '/:id/approval',
  requirePermission('assessment:approve'),
  validate(z.object({ decision: z.enum(['APPROVED', 'REJECTED']), comments: z.string().trim().max(4000).nullable().optional() })),
  async (req, res) => ok(res, await svc.decideApproval(req, param(req, 'id'), req.body.decision, req.body.comments)),
);
assessmentsRouter.post('/:id/finalise', requirePermission('assessment:approve', 'assessment:review'), async (req, res) => ok(res, await svc.finalise(req, param(req, 'id'))));
assessmentsRouter.post('/:id/reopen', requirePermission('assessment:reopen'), validate(z.object({ reason: z.string().trim().min(10, 'Give a meaningful reason (10+ characters)').max(2000) })), async (req, res) =>
  ok(res, await svc.reopen(req, param(req, 'id'), req.body.reason)),
);

assessmentsRouter.get('/:id/history', requirePermission('assessment:read'), async (req, res) => {
  const a = await svc.loadAssessment(req, param(req, 'id'));
  const history = await prisma.statusHistory.findMany({ where: { entityType: 'Assessment', entityId: a.id }, orderBy: { createdAt: 'desc' } });
  const actors = await prisma.user.findMany({ where: { id: { in: history.map((h) => h.actorId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  ok(res, history.map((h) => ({ ...h, actor: actors.find((x) => x.id === h.actorId) ?? null })));
});

assessmentsRouter.get('/:id/submissions/:round', requirePermission('assessment:read'), async (req, res) => {
  const a = await svc.loadAssessment(req, param(req, 'id'));
  const s = await prisma.assessmentSubmission.findUnique({ where: { assessmentId_round: { assessmentId: a.id, round: Number(param(req, 'round')) } } });
  if (!s) throw notFound('Submission');
  ok(res, s);
});

/** Authorised CSV / XLSX export of responses (FR-024). */
assessmentsRouter.get('/:id/export', requirePermission('assessment:export', 'response:export'), async (req, res) => {
  const a = await svc.loadAssessment(req, param(req, 'id'));
  const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
  const items = await prisma.checklistItem.findMany({ where: { versionId: a.checklistVersionId, status: 'ACTIVE' }, include: { mappings: true }, orderBy: { sequence: 'asc' } });
  const [responses, assignments, evidence] = await Promise.all([
    prisma.assessmentResponse.findMany({ where: { assessmentId: a.id }, include: { responder: { select: { name: true } } } }),
    prisma.assessmentAssignment.findMany({ where: { assessmentId: a.id }, include: { assignee: { select: { name: true } } } }),
    prisma.evidence.findMany({ where: { assessmentId: a.id, deletedAt: null }, select: { itemId: true, code: true, verificationStatus: true } }),
  ]);
  const header = ['Question ID', 'Question', 'ISO Clauses', 'Annex A', 'Status', 'Comment', 'Justification', 'Assigned To', 'Responder', 'Last Updated', 'Evidence', 'Evidence Verification'];
  const data = items.map((i) => {
    const r = responses.find((x) => x.itemId === i.id);
    const ev = evidence.filter((e) => e.itemId === i.id);
    return [
      i.questionCode,
      i.question,
      i.mappings.filter((m) => m.type === 'ISO_CLAUSE').map((m) => m.reference).join(', '),
      i.mappings.filter((m) => m.type === 'ANNEX_A').map((m) => m.reference).join(', '),
      r?.status ?? 'NOT_ASSESSED',
      r?.comment ?? '',
      r?.justification ?? '',
      assignments.find((x) => x.itemId === i.id)?.assignee.name ?? '',
      r?.responder?.name ?? '',
      r?.updatedAt.toISOString() ?? '',
      ev.map((e) => e.code).join(', '),
      ev.map((e) => e.verificationStatus).join(', '),
    ];
  });
  await recordAudit({ req, action: 'EXPORT', entityType: 'Assessment', entityId: a.id, siteId: a.siteId, metadata: { format } });
  if (format === 'csv') {
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      // Neutralise spreadsheet formula injection and quote per RFC 4180.
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${a.code}-responses.csv"`);
    return res.send('﻿' + [header, ...data].map((row) => row.map(esc).join(',')).join('\r\n'));
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(a.code);
  ws.addRow(header).font = { bold: true };
  data.forEach((row) => ws.addRow(row));
  ws.columns.forEach((c, i) => (c.width = [12, 60, 14, 18, 20, 40, 40, 20, 20, 22, 20, 22][i]));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${a.code}-responses.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});
