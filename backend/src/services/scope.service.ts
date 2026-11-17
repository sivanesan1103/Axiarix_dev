import type { Request } from 'express';
import type { AuthUser } from '../types/auth.js';
import { badRequest, forbidden } from '../utils/errors.js';
import { prisma } from '../config/prisma.js';
import { recordAuditSafe } from './audit.service.js';

export interface UnitRef {
  organisationId: string;
  siteId: string;
  departmentId: string;
}

/**
 * Organisation / site / department boundary checks.
 *
 * A scope with `siteId = null` covers the whole organisation; a scope with
 * `departmentId = null` covers every department of its site. Branch data must
 * never mix (BRD §8), so every record-level read and write passes through here.
 */
export function canAccessUnit(user: AuthUser, unit: UnitRef): boolean {
  return user.scopes.some(
    (s) =>
      s.organisationId === unit.organisationId &&
      (s.siteId === null || s.siteId === unit.siteId) &&
      (s.departmentId === null || s.departmentId === unit.departmentId),
  );
}

export function isOrgWide(user: AuthUser): boolean {
  return user.scopes.some((s) => s.organisationId === user.organisationId && s.siteId === null);
}

/** Prisma `where` fragment restricting a query on a model that has organisationId/siteId/departmentId. */
export function unitWhere(user: AuthUser): {
  organisationId: string;
  OR?: Array<{ siteId: string; departmentId?: string }>;
} {
  if (isOrgWide(user)) return { organisationId: user.organisationId };
  const OR = user.scopes
    .filter((s) => s.organisationId === user.organisationId && s.siteId)
    .map((s) => (s.departmentId ? { siteId: s.siteId!, departmentId: s.departmentId } : { siteId: s.siteId! }));
  // An empty OR array matches nothing in Prisma, which is the safe default for a user with no scope.
  return { organisationId: user.organisationId, OR };
}

/**
 * A task (assessment ownership, question, finding, corrective action) may only be given to someone
 * who can actually open the record: active, in the organisation, with a role covering its site and department.
 */
export async function assertUserCoversUnit(unit: UnitRef, userId: string, what: string) {
  const u = await prisma.user.findFirst({ where: { id: userId, organisationId: unit.organisationId, status: 'ACTIVE', isPlatformOwner: false }, include: { roles: true } });
  if (!u) throw badRequest(`The selected ${what} is not an active member of this organisation`);
  const covers = u.roles.some((r) => (r.siteId === null || r.siteId === unit.siteId) && (r.departmentId === null || r.departmentId === unit.departmentId));
  if (!covers) throw badRequest(`${u.name} has no access to this branch and department, so they cannot be the ${what}. Pick someone who works there, or give them a role there first.`);
  return u;
}

/** Site ids the user may see (null = all sites in the organisation). */
export function accessibleSiteIds(user: AuthUser): string[] | null {
  if (isOrgWide(user)) return null;
  return [...new Set(user.scopes.map((s) => s.siteId).filter((s): s is string => !!s))];
}

/**
 * Throws 403 and records a DENIED audit event when the user is outside the record's unit.
 * Used for AT-10 (cross-branch evidence access is denied and logged).
 */
export async function assertUnitAccess(
  req: Request,
  unit: UnitRef,
  entityType: string,
  entityId: string,
): Promise<void> {
  const user = req.user!;
  if (canAccessUnit(user, unit)) return;
  await recordAuditSafe({
    req,
    action: 'ACCESS_DENIED',
    entityType,
    entityId,
    outcome: 'DENIED',
    siteId: unit.siteId,
    metadata: { reason: 'outside-scope', targetSiteId: unit.siteId, targetDepartmentId: unit.departmentId },
  });
  throw forbidden('This record belongs to a site or department outside your access scope');
}
