import { disconnectUser } from '../../services/realtime.service.js';
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { requirePermission } from '../../middleware/auth.js';
import { administersOrganisation, assertCanAdministerUnits, assertCanManageUser, canAdministerUnit, type TargetUnit } from '../../services/admin-scope.service.js';
import type { AuthUser } from '../../types/auth.js';
import { validate } from '../../middleware/common.js';
import { recordAudit } from '../../services/audit.service.js';
import { accessibleSiteIds } from '../../services/scope.service.js';
import { created, ok, pageArgs, pageMeta, paginationSchema, param } from '../../utils/http.js';
import { badRequest, forbidden, notFound } from '../../utils/errors.js';
import { randomToken } from '../../utils/crypto.js';
import { hashPassword } from '../auth/auth.service.js';
import { passwordSchema } from '../auth/auth.routes.js';
import { forgotPassword } from '../auth/auth.service.js';

const roleAssignment = z.object({
  roleKey: z.string().min(2),
  siteId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
});

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  designation: z.string().trim().max(120).optional().nullable(),
  password: passwordSchema.optional(),
  sendInvite: z.boolean().default(true),
  roles: z.array(roleAssignment).min(1, 'Assign at least one role'),
});

const listSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  role: z.string().optional(),
  siteId: z.string().uuid().optional(),
});

const userSelect = {
  id: true,
  name: true,
  email: true,
  designation: true,
  status: true,
  mfaEnabled: true,
  lastLoginAt: true,
  createdAt: true,
  roles: {
    select: {
      id: true,
      siteId: true,
      departmentId: true,
      role: { select: { key: true, name: true } },
      site: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
    },
  },
  restrictions: {
    select: { id: true, reason: true, expiresAt: true, createdAt: true, permission: { select: { key: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.UserSelect;

type SelectedUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;

const unitsOf = (u: { roles: Array<{ siteId: string | null; departmentId: string | null }> }): TargetUnit[] =>
  u.roles.map((r) => ({ siteId: r.siteId, departmentId: r.departmentId }));

/** Adds `canManage` so the UI only offers actions the API will accept for this actor. */
function withManageFlag(actor: AuthUser, u: SelectedUser) {
  const units = unitsOf(u);
  const canManage =
    u.id !== actor.id &&
    (units.length ? units.every((unit) => canAdministerUnit(actor, 'user:update', unit)) : administersOrganisation(actor, 'user:update'));
  return { ...u, restrictions: u.restrictions.map((r) => ({ id: r.id, permission: r.permission.key, reason: r.reason, expiresAt: r.expiresAt, createdAt: r.createdAt })), canManage };
}

async function loadTarget(actor: AuthUser, id: string) {
  const existing = await prisma.user.findFirst({ where: { id, organisationId: actor.organisationId, isPlatformOwner: false }, select: userSelect });
  if (!existing) throw notFound('User');
  return existing;
}

/** Validates that every role exists and every scope belongs to this organisation. */
async function resolveRoles(organisationId: string, roles: z.infer<typeof roleAssignment>[]) {
  const out: Prisma.UserRoleCreateManyUserInput[] = [];
  for (const r of roles) {
    const role = await prisma.role.findUnique({ where: { organisationId_key: { organisationId, key: r.roleKey } } });
    if (!role) throw badRequest(`Unknown role ${r.roleKey}`);
    if (r.siteId) {
      const site = await prisma.site.findFirst({ where: { id: r.siteId, organisationId } });
      if (!site) throw badRequest('Site does not belong to this organisation');
    }
    if (r.departmentId) {
      const dept = await prisma.department.findFirst({ where: { id: r.departmentId, organisationId, siteId: r.siteId ?? undefined } });
      if (!dept || !r.siteId) throw badRequest('Department scope requires a matching site');
    }
    out.push({ roleId: role.id, organisationId, siteId: r.siteId ?? null, departmentId: r.departmentId ?? null });
  }
  return out;
}

export const usersRouter = Router();

usersRouter.get('/', requirePermission('user:read'), validate(listSchema, 'query'), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof listSchema>;
  const siteIds = accessibleSiteIds(req.user!);
  const where: Prisma.UserWhereInput = {
    organisationId: req.user!.organisationId,
    isPlatformOwner: false,
    status: q.status,
    ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] } : {}),
    AND: [
      ...(q.role ? [{ roles: { some: { role: { key: q.role } } } }] : []),
      ...(q.siteId ? [{ roles: { some: { OR: [{ siteId: q.siteId }, { siteId: null }] } } }] : []),
      // A branch-scoped viewer only sees people who work in their branch(es).
      ...(siteIds ? [{ roles: { some: { siteId: { in: siteIds } } } }] : []),
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, select: userSelect, orderBy: { name: 'asc' }, ...pageArgs(q) }),
    prisma.user.count({ where }),
  ]);
  ok(res, rows.map((u) => withManageFlag(req.user!, u)), pageMeta(q, total));
});

/** Lightweight directory used by owner/assignee pickers. */
usersRouter.get('/directory', async (req, res) => {
  const role = typeof req.query.role === 'string' ? req.query.role : undefined;
  const users = await prisma.user.findMany({
    where: { organisationId: req.user!.organisationId, isPlatformOwner: false, status: 'ACTIVE', ...(role ? { roles: { some: { role: { key: { in: role.split(',') } } } } } : {}) },
    select: { id: true, name: true, email: true, designation: true, roles: { select: { role: { select: { key: true } }, siteId: true, departmentId: true } } },
    orderBy: { name: 'asc' },
  });
  ok(res, users);
});

usersRouter.get('/:id', requirePermission('user:read'), async (req, res) => {
  const user = await loadTarget(req.user!, param(req, 'id'));
  const siteIds = accessibleSiteIds(req.user!);
  if (siteIds && !user.roles.some((r) => r.siteId && siteIds.includes(r.siteId))) throw notFound('User');
  ok(res, withManageFlag(req.user!, user));
});

usersRouter.post('/', requirePermission('user:create'), validate(createUserSchema), async (req, res) => {
  const body = req.body as z.infer<typeof createUserSchema>;
  assertCanAdministerUnits(req.user!, 'user:create', body.roles.map((r) => ({ siteId: r.siteId ?? null, departmentId: r.departmentId ?? null })), 'grant roles');
  const roles = await resolveRoles(req.user!.organisationId, body.roles);
  const user = await prisma.user.create({
    data: {
      organisationId: req.user!.organisationId,
      name: body.name,
      email: body.email,
      designation: body.designation,
      // Invited users get an unguessable password and set their own via the reset link.
      passwordHash: await hashPassword(body.password ?? randomToken(24) + 'Aa1'),
      roles: { createMany: { data: roles } },
    },
    select: userSelect,
  });
  await recordAudit({ req, action: 'USER_CREATED', entityType: 'User', entityId: user.id, metadata: { email: user.email, roles: body.roles.map((r) => r.roleKey) } });
  if (body.sendInvite && !body.password) await forgotPassword(req, user.email, { invite: true });
  created(res, withManageFlag(req.user!, user));
});

usersRouter.patch(
  '/:id',
  requirePermission('user:update'),
  validate(z.object({ name: z.string().trim().min(2).max(120).optional(), designation: z.string().trim().max(120).nullable().optional() })),
  async (req, res) => {
    const id = param(req, 'id');
    const existing = await loadTarget(req.user!, id);
    if (id !== req.user!.id) assertCanManageUser(req.user!, 'user:update', unitsOf(existing));
    const user = await prisma.user.update({ where: { id }, data: req.body, select: userSelect });
    await recordAudit({ req, action: 'USER_UPDATED', entityType: 'User', entityId: id, metadata: { fields: Object.keys(req.body) } });
    ok(res, withManageFlag(req.user!, user));
  },
);

usersRouter.post(
  '/:id/status',
  requirePermission('user:update'),
  validate(z.object({ status: z.enum(['ACTIVE', 'INACTIVE']), reason: z.string().trim().min(3).max(500) })),
  async (req, res) => {
    const id = param(req, 'id');
    if (id === req.user!.id) throw badRequest('You cannot change the status of your own account');
    const existing = await loadTarget(req.user!, id);
    assertCanManageUser(req.user!, 'user:update', unitsOf(existing));
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id }, data: { status: req.body.status }, select: userSelect });
      if (req.body.status === 'INACTIVE') await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      return u;
    });
    await recordAudit({ req, action: req.body.status === 'INACTIVE' ? 'USER_DEACTIVATED' : 'USER_ACTIVATED', entityType: 'User', entityId: id, metadata: { reason: req.body.reason } });
    if (req.body.status === 'INACTIVE') disconnectUser(id);
    ok(res, withManageFlag(req.user!, user));
  },
);

usersRouter.put('/:id/roles', requirePermission('role:assign', 'user:assign'), validate(z.object({ roles: z.array(roleAssignment).min(1) })), async (req, res) => {
  const id = param(req, 'id');
  // Nobody changes their own access: another administrator must do it (segregation of duties, ISO 27001 A.5.3).
  if (id === req.user!.id) throw forbidden('You cannot change your own roles. Ask another administrator.');
  const existing = await loadTarget(req.user!, id);
  const perm = req.user!.permissions.has('role:assign') ? 'role:assign' : 'user:assign';
  assertCanManageUser(req.user!, perm, unitsOf(existing));
  const next = req.body.roles as Array<z.infer<typeof roleAssignment>>;
  assertCanAdministerUnits(req.user!, perm, next.map((r) => ({ siteId: r.siteId ?? null, departmentId: r.departmentId ?? null })), 'grant roles');
  const roles = await resolveRoles(req.user!.organisationId, next);
  const user = await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId: id } });
    await tx.userRole.createMany({ data: roles.map((r) => ({ ...r, userId: id })) });
    return tx.user.findUniqueOrThrow({ where: { id }, select: userSelect });
  });
  await recordAudit({
    req,
    action: 'ROLES_CHANGED',
    entityType: 'User',
    entityId: id,
    metadata: {
      before: existing.roles.map((r) => ({ role: r.role.key, siteId: r.siteId, departmentId: r.departmentId })),
      after: req.body.roles,
    },
  });
  ok(res, withManageFlag(req.user!, user));
});

// ───────────── Per-user permission restrictions ─────────────

const restrictionsSchema = z.object({
  restrictions: z
    .array(z.object({ permission: z.string().regex(/^[a-z_]+:[a-z]+$/), expiresAt: z.coerce.date().nullable().optional() }))
    .max(150),
  reason: z.string().trim().min(3, 'Give a reason (at least 3 characters)').max(500),
});

/**
 * Replaces the set of permissions removed from one user ("limit power for selected users").
 * The role is unchanged; the restriction applies to this person only and is enforced on every request.
 */
usersRouter.put('/:id/restrictions', requirePermission('role:assign', 'user:assign'), validate(restrictionsSchema), async (req, res) => {
  const id = param(req, 'id');
  if (id === req.user!.id) throw forbidden('You cannot change your own restrictions. Ask another administrator.');
  const existing = await loadTarget(req.user!, id);
  const perm = req.user!.permissions.has('role:assign') ? 'role:assign' : 'user:assign';
  assertCanManageUser(req.user!, perm, unitsOf(existing));
  const body = req.body as z.infer<typeof restrictionsSchema>;
  const now = new Date();
  for (const r of body.restrictions) if (r.expiresAt && r.expiresAt <= now) throw badRequest('A restriction end date must be in the future');
  const permissions = await prisma.permission.findMany({ where: { key: { in: body.restrictions.map((r) => r.permission) } } });
  if (permissions.length !== new Set(body.restrictions.map((r) => r.permission)).size) throw badRequest('Unknown permission in the restriction list');
  const byKey = new Map(permissions.map((p) => [p.key, p.id]));
  const user = await prisma.$transaction(async (tx) => {
    await tx.userPermissionRestriction.deleteMany({ where: { userId: id } });
    if (body.restrictions.length) {
      await tx.userPermissionRestriction.createMany({
        data: body.restrictions.map((r) => ({ userId: id, permissionId: byKey.get(r.permission)!, reason: body.reason, expiresAt: r.expiresAt ?? null, createdById: req.user!.id })),
      });
    }
    return tx.user.findUniqueOrThrow({ where: { id }, select: userSelect });
  });
  const before = existing.restrictions.map((r) => r.permission.key);
  const after = body.restrictions.map((r) => r.permission);
  await recordAudit({
    req,
    action: 'USER_RESTRICTIONS_CHANGED',
    entityType: 'User',
    entityId: id,
    metadata: { reason: body.reason, added: after.filter((k) => !before.includes(k)), removed: before.filter((k) => !after.includes(k)) },
  });
  ok(res, withManageFlag(req.user!, user));
});

// ───────────── Roles & permissions ─────────────

export const rolesRouter = Router();

rolesRouter.get('/', requirePermission('role:read', 'user:read'), async (req, res) => {
  const roles = await prisma.role.findMany({
    where: { organisationId: req.user!.organisationId },
    orderBy: { name: 'asc' },
    include: { permissions: { include: { permission: true } }, _count: { select: { userRoles: true } } },
  });
  ok(
    res,
    roles.map((r) => ({ ...r, permissions: r.permissions.map((p) => p.permission.key).sort() })),
  );
});

rolesRouter.get('/permissions', requirePermission('role:read', 'user:read'), async (_req, res) => {
  ok(res, await prisma.permission.findMany({ orderBy: [{ resource: 'asc' }, { action: 'asc' }] }));
});

/** Replaces a role's permission set. SYSTEM_ADMIN is protected so administrators cannot lock themselves out. */
rolesRouter.put('/:id/permissions', requirePermission('role:update'), validate(z.object({ permissions: z.array(z.string()).max(500) })), async (req, res) => {
  const id = param(req, 'id');
  const role = await prisma.role.findFirst({ where: { id, organisationId: req.user!.organisationId }, include: { permissions: { include: { permission: true } } } });
  if (!role) throw notFound('Role');
  if (!administersOrganisation(req.user!, 'role:update')) throw forbidden('Only an organisation-wide administrator can change role permissions');
  if (role.key === 'SYSTEM_ADMIN') throw badRequest('System Administrator permissions cannot be reduced');
  const perms = await prisma.permission.findMany({ where: { key: { in: req.body.permissions } } });
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId: id } }),
    prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: id, permissionId: p.id })) }),
  ]);
  const before = role.permissions.map((p) => p.permission.key);
  const after = perms.map((p) => p.key);
  await recordAudit({
    req,
    action: 'PERMISSIONS_CHANGED',
    entityType: 'Role',
    entityId: id,
    metadata: { role: role.key, added: after.filter((k) => !before.includes(k)), removed: before.filter((k) => !after.includes(k)) },
  });
  ok(res, { id, permissions: after.sort() });
});
