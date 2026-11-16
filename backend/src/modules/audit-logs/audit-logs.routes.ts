import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { recordAudit, verifyAuditChain } from '../../services/audit.service.js';
import { ok, pageArgs, pageMeta, paginationSchema } from '../../utils/http.js';
import { sendTable } from '../findings/findings.routes.js';

const listSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  action: z.string().max(80).optional(),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(80).optional(),
  outcome: z.enum(['SUCCESS', 'FAILURE', 'DENIED']).optional(),
  actorId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  format: z.enum(['json', 'csv', 'xlsx']).default('json'),
});

export const auditLogsRouter = Router();

/** Read-only view of the append-only audit trail. There are intentionally no update/delete routes. */
auditLogsRouter.get('/', requirePermission('audit_log:read'), validate(listSchema, 'query'), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof listSchema>;
  const where: Prisma.AuditEventWhereInput = {
    OR: [{ organisationId: req.user!.organisationId }, { organisationId: null }],
    action: q.action,
    entityType: q.entityType,
    entityId: q.entityId,
    outcome: q.outcome,
    actorId: q.actorId,
    ...(q.from || q.to ? { createdAt: { gte: q.from, lte: q.to } } : {}),
    ...(q.search ? { AND: [{ OR: [{ actorEmail: { contains: q.search, mode: 'insensitive' } }, { action: { contains: q.search, mode: 'insensitive' } }, { entityId: { contains: q.search } }] }] } : {}),
  };
  if (q.format !== 'json') {
    if (!req.user!.permissions.has('audit_log:export')) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Export permission required' } });
    const rows = await prisma.auditEvent.findMany({ where, orderBy: { seq: 'desc' }, take: 50_000 });
    await recordAudit({ req, action: 'EXPORT', entityType: 'AuditEvent', metadata: { format: q.format, rows: rows.length } });
    return sendTable(
      res,
      q.format,
      'audit-trail',
      ['Seq', 'Event ID', 'Timestamp (UTC)', 'Actor', 'Action', 'Entity Type', 'Entity ID', 'Outcome', 'IP', 'Metadata', 'Hash'],
      rows.map((e) => [e.seq, e.id, e.createdAt.toISOString(), e.actorEmail ?? '', e.action, e.entityType, e.entityId ?? '', e.outcome, e.ip ?? '', JSON.stringify(e.metadata ?? {}), e.hash]),
    );
  }
  const [rows, total] = await Promise.all([
    prisma.auditEvent.findMany({ where, orderBy: { seq: 'desc' }, include: { actor: { select: { id: true, name: true } } }, ...pageArgs(q) }),
    prisma.auditEvent.count({ where }),
  ]);
  ok(res, rows, pageMeta(q, total));
});

auditLogsRouter.get('/actions', requirePermission('audit_log:read'), async (_req, res) => {
  const rows = await prisma.auditEvent.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } });
  ok(res, rows.map((r) => r.action));
});

auditLogsRouter.get('/verify', requirePermission('audit_log:read'), async (req, res) => {
  const result = await verifyAuditChain();
  await recordAudit({ req, action: 'AUDIT_CHAIN_VERIFIED', entityType: 'AuditEvent', metadata: result });
  ok(res, result);
});
