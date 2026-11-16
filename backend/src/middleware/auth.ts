import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { PLATFORM_PERMISSION, type PermissionKey, type RoleKey } from '../constants/permissions.js';
import type { AuthUser } from '../types/auth.js';
import { AppError, forbidden, unauthorized } from '../utils/errors.js';
import { recordAuditSafe } from '../services/audit.service.js';

interface AccessClaims {
  sub: string;
  typ: 'access';
}

/**
 * Loads the principal with roles, permissions and scopes. Deactivated users, and users of a
 * suspended organisation, are rejected immediately. Active per-user restrictions are subtracted
 * from every role's permissions, so a restricted permission is denied everywhere.
 */
export async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      organisation: { select: { status: true } },
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      restrictions: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, include: { permission: true } },
    },
  });
  if (!user || user.status !== 'ACTIVE' || user.organisation.status !== 'ACTIVE') return null;
  const restricted = new Set(user.restrictions.map((r) => r.permission.key));
  const permissions = new Set<PermissionKey>();
  const scopes = user.roles.map((r) => {
    const granted = r.role.permissions.map((rp) => rp.permission.key as PermissionKey).filter((k) => !restricted.has(k));
    for (const k of granted) permissions.add(k);
    return { role: r.role.key as RoleKey, organisationId: r.organisationId, siteId: r.siteId, departmentId: r.departmentId, permissions: granted };
  });
  if (user.isPlatformOwner) permissions.add(PLATFORM_PERMISSION);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    organisationId: user.organisationId,
    roles: [...new Set(user.roles.map((r) => r.role.key as RoleKey))],
    permissions,
    scopes,
    mfaEnabled: user.mfaEnabled,
    isPlatformOwner: user.isPlatformOwner,
    restrictions: user.restrictions.map((r) => ({ permission: r.permission.key as PermissionKey, reason: r.reason, expiresAt: r.expiresAt })),
  };
}

/** Verifies the short-lived bearer access token. Refresh tokens live only in an HTTP-only cookie. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return next(unauthorized());
  let claims: AccessClaims;
  try {
    claims = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: 'axiarix',
    }) as AccessClaims;
  } catch (err) {
    const expired = err instanceof jwt.TokenExpiredError;
    return next(new AppError(401, expired ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED', expired ? 'Session expired' : 'Invalid token'));
  }
  if (claims.typ !== 'access') return next(unauthorized('Invalid token type'));
  const user = await loadAuthUser(claims.sub);
  if (!user) return next(unauthorized('Account is inactive'));
  req.user = user;
  next();
}

export function hasPermission(user: AuthUser, key: PermissionKey) {
  return user.permissions.has(key);
}

/** Route guard: the user must hold at least one of the listed permissions. Denials are audited. */
export function requirePermission(...keys: PermissionKey[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(unauthorized());
    if (keys.some((k) => user.permissions.has(k))) return next();
    await recordAuditSafe({
      req,
      action: 'PERMISSION_DENIED',
      entityType: 'route',
      entityId: `${req.method} ${req.baseUrl}${req.route?.path ?? ''}`,
      outcome: 'DENIED',
      metadata: { required: keys },
    });
    next(forbidden());
  };
}

/** Route guard for platform-owner endpoints (organisation creation and management). */
export function requirePlatformOwner(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.isPlatformOwner) return next();
  next(forbidden('Only a platform owner can manage organisations'));
}
