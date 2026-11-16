import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { recordAudit } from '../../services/audit.service.js';
import { accessibleSiteIds } from '../../services/scope.service.js';
import { assertCanAdministerUnits } from '../../services/admin-scope.service.js';
import { created, ok, param } from '../../utils/http.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { prismaUniqueGuard } from '../../utils/prisma-errors.js';

const status = z.enum(['ACTIVE', 'INACTIVE']);
const orgSchema = z.object({ name: z.string().trim().min(2).max(200), legalEntity: z.string().trim().max(200).optional().nullable(), status: status.optional() });
const siteSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(20).regex(/^[A-Z0-9-]+$/, 'Use upper-case letters, digits and dashes'),
  address: z.string().trim().max(500).optional().nullable(),
  status: status.optional(),
});
const deptSchema = z.object({
  siteId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  ownerId: z.string().uuid().optional().nullable(),
  status: status.optional(),
});

export const organisationsRouter = Router();

/** Organisation hierarchy visible to the current user (sites filtered by scope). */
organisationsRouter.get('/current', requirePermission('organisation:read', 'dashboard:read'), async (req, res) => {
  const user = req.user!;
  const siteIds = accessibleSiteIds(user);
  const org = await prisma.organisation.findUniqueOrThrow({
    where: { id: user.organisationId },
    include: {
      sites: {
        where: siteIds ? { id: { in: siteIds } } : undefined,
        orderBy: { name: 'asc' },
        include: {
          departments: { orderBy: { name: 'asc' }, include: { owner: { select: { id: true, name: true, email: true } } } },
          _count: { select: { assessments: true } },
        },
      },
    },
  });
  ok(res, org);
});

organisationsRouter.get('/', requirePermission('organisation:read'), async (req, res) => {
  ok(res, await prisma.organisation.findMany({ where: { id: req.user!.organisationId }, include: { _count: { select: { sites: true, users: true } } } }));
});

organisationsRouter.post('/', requirePermission('organisation:create'), async () => {
  // New organisations are created by a platform owner (Platform → New organisation), never from inside another organisation.
  throw badRequest('Organisations are created by a platform owner. Ask your platform owner to add a new organisation.');
});

organisationsRouter.patch('/:id', requirePermission('organisation:update'), validate(orgSchema.partial()), async (req, res) => {
  const id = param(req, 'id');
  if (id !== req.user!.organisationId) throw notFound('Organisation');
  assertCanAdministerUnits(req.user!, 'organisation:update', [{ siteId: null, departmentId: null }], 'edit the organisation');
  const org = await prisma.organisation.update({ where: { id }, data: req.body });
  await recordAudit({ req, action: 'ORGANISATION_UPDATED', entityType: 'Organisation', entityId: id, metadata: { fields: Object.keys(req.body) } });
  ok(res, org);
});

// ───────────── Sites / branches ─────────────

organisationsRouter.post('/sites', requirePermission('organisation:create'), validate(siteSchema), async (req, res) => {
  assertCanAdministerUnits(req.user!, 'organisation:create', [{ siteId: null, departmentId: null }], 'add branches');
  const site = await prismaUniqueGuard(() => prisma.site.create({ data: { ...req.body, organisationId: req.user!.organisationId } }), 'A branch with this name or code already exists');
  await recordAudit({ req, action: 'SITE_CREATED', entityType: 'Site', entityId: site.id, siteId: site.id, metadata: { name: site.name } });
  created(res, site);
});

organisationsRouter.patch('/sites/:id', requirePermission('organisation:update'), validate(siteSchema.partial()), async (req, res) => {
  const id = param(req, 'id');
  const site = await prisma.site.findFirst({ where: { id, organisationId: req.user!.organisationId } });
  if (!site) throw notFound('Site');
  assertCanAdministerUnits(req.user!, 'organisation:update', [{ siteId: id, departmentId: null }], 'edit branches');
  const updated = await prismaUniqueGuard(() => prisma.site.update({ where: { id }, data: req.body }), 'A branch with this name or code already exists');
  await recordAudit({ req, action: 'SITE_UPDATED', entityType: 'Site', entityId: id, siteId: id, metadata: { fields: Object.keys(req.body) } });
  ok(res, updated);
});

// ───────────── Departments ─────────────

organisationsRouter.post('/departments', requirePermission('organisation:create'), validate(deptSchema), async (req, res) => {
  const site = await prisma.site.findFirst({ where: { id: req.body.siteId, organisationId: req.user!.organisationId } });
  if (!site) throw notFound('Site');
  assertCanAdministerUnits(req.user!, 'organisation:create', [{ siteId: site.id, departmentId: null }], 'add departments');
  const dept = await prismaUniqueGuard(() => prisma.department.create({ data: { ...req.body, organisationId: req.user!.organisationId } }), 'This branch already has a department with that name');
  await recordAudit({ req, action: 'DEPARTMENT_CREATED', entityType: 'Department', entityId: dept.id, siteId: site.id, metadata: { name: dept.name } });
  created(res, dept);
});

organisationsRouter.patch(
  '/departments/:id',
  requirePermission('organisation:update'),
  validate(deptSchema.omit({ siteId: true }).partial()),
  async (req, res) => {
    const id = param(req, 'id');
    const dept = await prisma.department.findFirst({ where: { id, organisationId: req.user!.organisationId } });
    if (!dept) throw notFound('Department');
    assertCanAdministerUnits(req.user!, 'organisation:update', [{ siteId: dept.siteId, departmentId: id }], 'edit departments');
    const updated = await prismaUniqueGuard(() => prisma.department.update({ where: { id }, data: req.body }), 'This branch already has a department with that name');
    await recordAudit({ req, action: 'DEPARTMENT_UPDATED', entityType: 'Department', entityId: id, siteId: dept.siteId, metadata: { fields: Object.keys(req.body) } });
    ok(res, updated);
  },
);
