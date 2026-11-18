import type { PermissionKey, RoleKey } from '../constants/permissions.js';

export interface AccessScope {
  role: RoleKey;
  organisationId: string;
  siteId: string | null;
  departmentId: string | null;
  /** Effective permissions this role assignment grants (role permissions minus the user's restrictions). */
  permissions: PermissionKey[];
}

export interface ActiveRestriction {
  permission: PermissionKey;
  reason: string;
  expiresAt: Date | null;
}

/** Authenticated principal, reloaded from the database on every request. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  organisationId: string;
  roles: RoleKey[];
  permissions: Set<PermissionKey>;
  scopes: AccessScope[];
  mfaEnabled: boolean;
  isPlatformOwner: boolean;
  restrictions: ActiveRestriction[];
  /** True while the security policy requires MFA for this (privileged) user and they have not enrolled. */
  mfaEnrolmentRequired?: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    requestId?: string;
  }
}
