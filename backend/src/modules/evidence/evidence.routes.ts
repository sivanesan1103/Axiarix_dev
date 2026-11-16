import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { authenticate, loadAuthUser, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { recordAudit, recordAuditSafe } from '../../services/audit.service.js';
import { DOWNLOAD_TTL_SECONDS, signDownloadToken, verifyDownloadToken } from '../../services/download-token.service.js';
import { canAccessUnit, unitWhere } from '../../services/scope.service.js';
import { storage } from '../../services/storage/index.js';
import { badRequest, forbidden, notFound, unauthorized } from '../../utils/errors.js';
import { created, ok, pageArgs, pageMeta, paginationSchema, param } from '../../utils/http.js';
import * as svc from './evidence.service.js';

// Hard ceiling; the configurable policy limit (≤200 MB) is enforced in the service.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024, files: 1, fields: 20 } });
const classification = z.enum(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']);
const optUuid = z.preprocess((v) => (v === '' || v === 'null' ? undefined : v), z.string().uuid().optional());

const uploadMeta = z.object({
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  classification: classification.optional(),
  assessmentId: optUuid,
  itemId: optUuid,
  findingId: optUuid,
  correctiveActionId: optUuid,
});

const listSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  siteId: z.string().uuid().optional(),
  periodLabel: z.string().max(60).optional(),
  assessmentId: z.string().uuid().optional(),
  findingId: z.string().uuid().optional(),
  verificationStatus: z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'CLARIFICATION_REQUESTED']).optional(),
  classification: classification.optional(),
  link: z.enum(['response', 'finding', 'action']).optional(),
  uploaderId: z.string().uuid().optional(),
});

export const evidenceRouter = Router();

/** Public (token-authenticated) download endpoint: the browser navigates here with a signed token. */
export const evidenceDownloadRouter = Router();
evidenceDownloadRouter.get('/download/:token', async (req, res) => {
  const claims = verifyDownloadToken(param(req, 'token'));
  if (claims.kind !== 'evidence') throw unauthorized('Wrong download token');
  const user = await loadAuthUser(claims.sub);
  if (!user) throw unauthorized('Account is inactive');
  (req as Request).user = user;
  const v = await prisma.evidenceVersion.findUnique({ where: { id: claims.ref }, include: { evidence: true } });
  if (!v || v.evidence.deletedAt) throw notFound('Evidence');
  if (!canAccessUnit(user, v.evidence)) {
    await recordAuditSafe({ req, action: 'ACCESS_DENIED', entityType: 'Evidence', entityId: v.evidenceId, outcome: 'DENIED', siteId: v.evidence.siteId });
    throw forbidden();
  }
  if (v.scanStatus !== 'CLEAN') throw forbidden('This file has not passed malware scanning and cannot be downloaded');
  const buf = await storage.get(v.storageKey);
  await recordAudit({ req, action: claims.inline ? 'EVIDENCE_PREVIEWED' : 'EVIDENCE_DOWNLOADED', entityType: 'Evidence', entityId: v.evidenceId, siteId: v.evidence.siteId, metadata: { version: v.version } });
  const inlineOk = claims.inline && /^(application\/pdf|image\/(png|jpeg))$/.test(v.mimeType);
  res.setHeader('Content-Type', v.mimeType);
  res.setHeader('Content-Length', String(buf.length));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Content-Disposition', `${inlineOk ? 'inline' : 'attachment'}; filename="${v.originalFilename.replace(/[^\w.\- ]/g, '_')}"`);
  res.send(buf);
});

evidenceRouter.use(authenticate);

evidenceRouter.get('/', requirePermission('evidence:read'), validate(listSchema, 'query'), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof listSchema>;
  const where: Prisma.EvidenceWhereInput = {
    ...unitWhere(req.user!),
    deletedAt: null,
    siteId: q.siteId,
    assessmentId: q.assessmentId,
    findingId: q.findingId,
    verificationStatus: q.verificationStatus,
    classification: q.classification,
    uploaderId: q.uploaderId,
    ...(q.periodLabel ? { assessment: { periodLabel: q.periodLabel } } : {}),
    ...(q.link === 'response' ? { itemId: { not: null } } : q.link === 'finding' ? { findingId: { not: null }, correctiveActionId: null } : q.link === 'action' ? { correctiveActionId: { not: null } } : {}),
    ...(q.search
      ? { AND: [{ OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } }, { versions: { some: { originalFilename: { contains: q.search, mode: 'insensitive' } } } }] }] }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.evidence.findMany({
      where,
      include: {
        versions: { orderBy: { version: 'desc' }, take: 1 },
        uploader: { select: { id: true, name: true } },
        site: { select: { id: true, name: true } },
        item: { select: { id: true, questionCode: true, question: true } },
        assessment: { select: { id: true, code: true } },
        finding: { select: { id: true, code: true } },
        correctiveAction: { select: { id: true, code: true } },
      },
      orderBy: { createdAt: 'desc' },
      ...pageArgs(q),
    }),
    prisma.evidence.count({ where }),
  ]);
  ok(res, rows, pageMeta(q, total));
});

evidenceRouter.get('/:id', requirePermission('evidence:read'), async (req, res) => {
  const ev = await svc.getEvidenceForUser(req, param(req, 'id'));
  const full = await prisma.evidence.findUniqueOrThrow({
    where: { id: ev.id },
    include: {
      versions: { orderBy: { version: 'desc' }, include: { uploader: { select: { id: true, name: true } } } },
      uploader: { select: { id: true, name: true, email: true } },
      site: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      item: { select: { id: true, questionCode: true, question: true } },
      assessment: { select: { id: true, code: true, title: true, status: true } },
      finding: { select: { id: true, code: true, title: true } },
      correctiveAction: { select: { id: true, code: true } },
      reviews: { orderBy: { createdAt: 'desc' }, include: { auditor: { select: { id: true, name: true } } } },
    },
  });
  const history = await prisma.auditEvent.findMany({ where: { entityType: 'Evidence', entityId: ev.id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, action: true, actorEmail: true, createdAt: true, outcome: true } });
  ok(res, { ...full, history });
});

evidenceRouter.post('/', requirePermission('evidence:create'), upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Attach a file in the "file" field');
  const meta = uploadMeta.parse(req.body);
  created(res, await svc.uploadEvidence(req, req.file, meta));
});

evidenceRouter.post('/:id/versions', requirePermission('evidence:create'), upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Attach a file in the "file" field');
  const note = typeof req.body.note === 'string' ? req.body.note.slice(0, 1000) : null;
  created(res, await svc.uploadNewVersion(req, param(req, 'id'), req.file, note));
});

evidenceRouter.patch(
  '/:id',
  requirePermission('evidence:update', 'evidence:create'),
  validate(z.object({ title: z.string().trim().min(1).max(200).optional(), description: z.string().trim().max(2000).nullable().optional(), classification: classification.optional() })),
  async (req, res) => {
    const ev = await svc.getEvidenceForUser(req, param(req, 'id'));
    if (ev.uploaderId !== req.user!.id && !req.user!.permissions.has('evidence:update')) throw forbidden();
    const updated = await prisma.evidence.update({ where: { id: ev.id }, data: req.body });
    await recordAudit({ req, action: 'EVIDENCE_METADATA_UPDATED', entityType: 'Evidence', entityId: ev.id, siteId: ev.siteId, metadata: { fields: Object.keys(req.body) } });
    ok(res, updated);
  },
);

evidenceRouter.post('/:id/remove', requirePermission('evidence:create'), validate(z.object({ reason: z.string().trim().min(3).max(500) })), async (req, res) => {
  await svc.softDelete(req, param(req, 'id'), req.body.reason);
  ok(res, { removed: true });
});

/** Issues a 5-minute signed URL for one version (defaults to current). */
evidenceRouter.post('/:id/download-url', requirePermission('evidence:read'), validate(z.object({ version: z.number().int().positive().optional(), inline: z.boolean().optional() })), async (req, res) => {
  const ev = await svc.getEvidenceForUser(req, param(req, 'id'));
  const v = await prisma.evidenceVersion.findUnique({ where: { evidenceId_version: { evidenceId: ev.id, version: req.body.version ?? ev.currentVersion } } });
  if (!v) throw notFound('Evidence version');
  if (v.scanStatus !== 'CLEAN') throw forbidden(`File is not available: malware scan status is ${v.scanStatus}`);
  const token = signDownloadToken({ sub: req.user!.id, kind: 'evidence', ref: v.id, inline: req.body.inline });
  ok(res, { url: `/api/v1/evidence/download/${token}`, expiresIn: DOWNLOAD_TTL_SECONDS });
});

evidenceRouter.post('/versions/:versionId/rescan', requirePermission('evidence:update'), async (req, res) => ok(res, await svc.rescan(req, param(req, 'versionId'))));
