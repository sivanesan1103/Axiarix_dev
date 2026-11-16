import type { PermissionKey } from '../constants/permissions.js';
import type { AuthUser } from '../types/auth.js';
import { forbidden } from '../utils/errors.js';

/** A unit of the organisation an admin action targets. `siteId = null` means the organisation level. */
export interface TargetUnit {
  siteId: string | null;
  departmentId: string | null;
}

/**
 * Administrative scope checks.
 *
 * Permissions are granted per role assignment, and each assignment has a scope. An admin
 * may only act on units their *administering* assignments cover:
 *  - an organisation-wide assignment covers every unit;
 *  - a site assignment covers that site and all its departments, but not the organisation level;
 *  - a department assignment covers only that department.
 * So a branch administrator cannot create organisation-wide roles, manage other branches, or
 * manage users who hold access outside their branch.
 */
export function canAdministerUnit(user: AuthUser, permission: PermissionKey, unit: TargetUnit): boolean {
  return user.scopes.some((s) => {
    if (s.organisationId !== user.organisationId || !s.permissions.includes(permission)) return false;
    if (s.siteId === null) return true;
    if (unit.siteId === null || unit.siteId !== s.siteId) return false;
    if (s.departmentId === null) return true;
    return unit.departmentId !== null && unit.departmentId === s.departmentId;
  });
}

/** True when the user holds the permission through an organisation-wide assignment. */
export function administersOrganisation(user: AuthUser, permission: PermissionKey): boolean {
  return canAdministerUnit(user, permission, { siteId: null, departmentId: null });
}

/** Site ids the user administers with the permission (null = every site). */
export function administeredSiteIds(user: AuthUser, permission: PermissionKey): string[] | null {
  if (administersOrganisation(user, permission)) return null;
  return [...new Set(user.scopes.filter((s) => s.siteId && s.permissions.includes(permission)).map((s) => s.siteId!))];
}

export function assertCanAdministerUnits(user: AuthUser, permission: PermissionKey, units: TargetUnit[], what: string) {
  for (const unit of units) {
    if (!canAdministerUnit(user, permission, unit)) {
      throw forbidden(
        unit.siteId === null
          ? `Only an organisation-wide administrator can ${what} at organisation level`
          : `You can only ${what} inside the branch or department you administer`,
      );
    }
  }
}

/**
 * The target user must sit entirely inside the actor's administered scope: every role assignment
 * the target holds must be a unit the actor administers. A user with no assignments can only be
 * managed by an organisation-wide administrator.
 */
export function assertCanManageUser(actor: AuthUser, permission: PermissionKey, targetUnits: TargetUnit[]) {
  if (!targetUnits.length) {
    if (!administersOrganisation(actor, permission)) throw forbidden('Only an organisation-wide administrator can manage a user without any role');
    return;
  }
  assertCanAdministerUnits(actor, permission, targetUnits, 'manage users');
}
