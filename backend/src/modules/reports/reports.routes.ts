import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { authenticate, loadAuthUser, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { recordAudit, recordAuditSafe } from '../../services/audit.service.js';
import { DOWNLOAD_TTL_SECONDS, signDownloadToken, verifyDownloadToken } from '../../services/download-token.service.js';
import { assertUnitAccess, canAccessUnit, unitWhere } from '../../services/scope.service.js';
import { storage } from '../../services/storage/index.js';
import { forbidden, notFound, unauthorized } from '../../utils/errors.js';
import { created, ok, pageArgs, pageMeta, paginationSchema, param } from '../../utils/http.js';
import { loadAssessment } from '../assessments/assessments.service.js';
import { generateFinalReport } from './reports.service.js';

export const reportsDownloadRouter = Router();
reportsDownloadRouter.get('/download/:token', async (req, res) => {
  const claims = verifyDownloadToken(param(req, 'token'));
  if (claims.kind !== 'report') throw unauthorized('Wrong download token');
  const user = await loadAuthUser(claims.sub);
  if (!user) throw unauthorized('Account is inactive');
  (req as Request).user = user;
  const r = await prisma.report.findUnique({ where: { id: claims.ref } });
  if (!r || r.archivedAt) throw notFound('Report');
  if (!canAccessUnit(user, r) || !user.permissions.has('report:read')) {
    await recordAuditSafe({ req, action: 'ACCESS_DENIED', entityType: 'Report', entityId: r.id, outcome: 'DENIED', siteId: r.siteId });
    throw forbidden();
  }
  const buf = await storage.get(r.storageKey);
  await recordAudit({ req, action: claims.inline ? 'REPORT_VIEWED' : 'REPORT_DOWNLOADED', entityType: 'Report', entityId: r.id, siteId: r.siteId, metadata: { code: r.code } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${claims.inline ? 'inline' : 'attachment'}; filename="${r.code}.pdf"`);
  res.send(buf);
});

const listSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  siteId: z.string().uuid().optional(),
  assessmentId: z.string().uuid().optional(),
  periodLabel: z.string().max(60).optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
});

export const reportsRouter = Router();
reportsRouter.use(authenticate);

reportsRouter.get('/', requirePermission('report:read'), validate(listSchema, 'query'), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof listSchema>;
  const where: Prisma.ReportWhereInput = {
    ...unitWhere(req.user!),
    siteId: q.siteId,
    assessmentId: q.assessmentId,
    ...(q.includeArchived === 'true' ? {} : { archivedAt: null }),
    ...(q.periodLabel ? { assessment: { periodLabel: q.periodLabel } } : {}),
    ...(q.search ? { AND: [{ OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { title: { contains: q.search, mode: 'insensitive' } }] }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.report.findMany({
      where,
      include: {
        site: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        assessment: { select: { id: true, code: true, periodLabel: true, status: true } },
        generatedBy: { select: { id: true, name: true } },
      },
      orderBy: { generatedAt: 'desc' },
      ...pageArgs(q),
    }),
    prisma.report.count({ where }),
  ]);
  ok(res, rows, pageMeta(q, total));
});

reportsRouter.get('/:id', requirePermission('report:read'), async (req, res) => {
  const r = await prisma.report.findFirst({
    where: { id: param(req, 'id'), organisationId: req.user!.organisationId },
    include: { site: true, department: true, assessment: { select: { id: true, code: true, title: true, periodLabel: true, status: true } }, generatedBy: { select: { id: true, name: true } } },
  });
  if (!r) throw notFound('Report');
  await assertUnitAccess(req, r, 'Report', r.id);
  const versions = await prisma.report.findMany({ where: { assessmentId: r.assessmentId }, select: { id: true, code: true, version: true, generatedAt: true, archivedAt: true }, orderBy: { version: 'desc' } });
  ok(res, { ...r, versions });
});

reportsRouter.post('/:id/download-url', requirePermission('report:read'), validate(z.object({ inline: z.boolean().optional() })), async (req, res) => {
  const r = await prisma.report.findFirst({ where: { id: param(req, 'id'), organisationId: req.user!.organisationId, archivedAt: null } });
  if (!r) throw notFound('Report');
  await assertUnitAccess(req, r, 'Report', r.id);
  const token = signDownloadToken({ sub: req.user!.id, kind: 'report', ref: r.id, inline: req.body.inline });
  ok(res, { url: `/api/v1/reports/download/${token}`, expiresIn: DOWNLOAD_TTL_SECONDS });
});

/** Manually generate a new report version for an approved assessment (prior versions are kept unchanged). */
reportsRouter.post('/generate', requirePermission('report:create'), validate(z.object({ assessmentId: z.string().uuid() })), async (req, res) => {
  const a = await loadAssessment(req, req.body.assessmentId);
  created(res, await generateFinalReport(req, a.id));
});
