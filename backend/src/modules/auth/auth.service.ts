import type { Request } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { PRIVILEGED_ROLES, type RoleKey } from '../../constants/permissions.js';
import { recordAudit, recordAuditSafe } from '../../services/audit.service.js';
import { getSetting } from '../../services/settings.service.js';
import { notifyPasswordReset } from './auth.mail.js';
import { loadAuthUser } from '../../middleware/auth.js';
import type { AuthUser } from '../../types/auth.js';
import { AppError, badRequest, forbidden, unauthorized } from '../../utils/errors.js';
import {
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  randomToken,
  sha256,
  verifyTotp,
} from '../../utils/crypto.js';

export const BCRYPT_COST = 12;
export const hashPassword = (pw: string) => bcrypt.hash(pw, BCRYPT_COST);

/** A pre-computed hash so that unknown e-mails take as long as wrong passwords (no user enumeration). */
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);

export function signAccessToken(userId: string) {
  return jwt.sign({ sub: userId, typ: 'access' }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    issuer: 'axiarix',
  });
}

/** Issues an opaque refresh token. Only its SHA-256 hash is stored. */
async function issueRefreshToken(userId: string, req: Request, familyId: string = crypto.randomUUID()) {
  const token = randomToken();
  const row = await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(token),
      familyId,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      ip: req.ip,
      userAgent: req.get('user-agent')?.slice(0, 300),
    },
  });
  return { token, row };
}

export function publicUser(u: AuthUser) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    organisationId: u.organisationId,
    roles: u.roles,
    permissions: [...u.permissions].sort(),
    scopes: u.scopes.map(({ permissions: _p, ...s }) => s),
    mfaEnabled: u.mfaEnabled,
    isPlatformOwner: u.isPlatformOwner,
    restrictions: u.restrictions,
    mfaEnrolmentRequired: !!u.mfaEnrolmentRequired,
  };
}

export type LoginResult =
  | { mfaRequired: true }
  | { mfaRequired: false; accessToken: string; refreshToken: string; user: ReturnType<typeof publicUser>; mfaEnrolmentRequired: boolean };

/**
 * Authenticates with e-mail + password (+ TOTP when enrolled).
 * Repeated failures lock the account temporarily; every outcome is audited.
 */
export async function login(req: Request, email: string, password: string, mfaCode?: string): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { organisation: { select: { status: true } } } });
  const security = await getSetting('security.policy', user?.organisationId);
  const fail = async (reason: string) => {
    await recordAuditSafe({
      req,
      action: 'LOGIN_FAILED',
      entityType: 'User',
      entityId: user?.id ?? null,
      actorId: user?.id ?? null,
      actorEmail: email.toLowerCase(),
      organisationId: user?.organisationId ?? null,
      outcome: 'FAILURE',
      metadata: { reason },
    });
    return unauthorized('Invalid e-mail or password');
  };

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw await fail('unknown-email');
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordAuditSafe({ req, action: 'LOGIN_FAILED', entityType: 'User', entityId: user.id, actorId: user.id, actorEmail: user.email, organisationId: user.organisationId, outcome: 'DENIED', metadata: { reason: 'locked' } });
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Account temporarily locked after repeated failed attempts. Try again later.');
  }
  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk) {
    const failed = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failed,
        lockedUntil: failed >= security.maxFailedLogins ? new Date(Date.now() + security.lockoutMinutes * 60_000) : null,
      },
    });
    throw await fail('bad-password');
  }
  if (user.status !== 'ACTIVE') throw await fail('inactive');
  if (user.organisation.status !== 'ACTIVE') throw await fail('organisation-suspended');

  if (user.mfaEnabled) {
    if (!mfaCode) return { mfaRequired: true };
    if (!user.mfaSecret || !verifyTotp(decryptSecret(user.mfaSecret), mfaCode)) throw await fail('bad-mfa');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  const authUser = (await loadAuthUser(user.id))!;
  const { token } = await issueRefreshToken(user.id, req);
  await recordAudit({ req, action: 'LOGIN', entityType: 'User', entityId: user.id, actorId: user.id, actorEmail: user.email, organisationId: user.organisationId });
  const privileged = authUser.roles.some((r) => PRIVILEGED_ROLES.includes(r as RoleKey));
  authUser.mfaEnrolmentRequired = security.enforceMfaForPrivileged && privileged && !user.mfaEnabled && !authUser.isPlatformOwner;
  return {
    mfaRequired: false,
    accessToken: signAccessToken(user.id),
    refreshToken: token,
    user: publicUser(authUser),
    mfaEnrolmentRequired: authUser.mfaEnrolmentRequired,
  };
}

/**
 * Rotates a refresh token. Presenting an already-rotated token is treated as theft:
 * the whole token family is revoked and the event is audited.
 */
export async function refresh(req: Request, presented: string | undefined) {
  if (!presented) throw unauthorized('No refresh token');
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(presented) } });
  if (!row) throw unauthorized('Invalid refresh token');
  if (row.revokedAt) {
    await prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordAuditSafe({ req, action: 'REFRESH_TOKEN_REUSE', entityType: 'User', entityId: row.userId, actorId: row.userId, outcome: 'DENIED' });
    throw unauthorized('Refresh token reuse detected; please sign in again');
  }
  if (row.expiresAt < new Date()) throw new AppError(401, 'SESSION_EXPIRED', 'Session expired; please sign in again');
  const user = await loadAuthUser(row.userId);
  if (!user) throw unauthorized('Account is inactive');

  const next = await issueRefreshToken(row.userId, req, row.familyId);
  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date(), replacedBy: next.row.id } });
  return { accessToken: signAccessToken(row.userId), refreshToken: next.token, user: publicUser(user) };
}

export async function logout(req: Request, presented: string | undefined) {
  if (!presented) return;
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(presented) } });
  if (!row) return;
  await prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  await recordAuditSafe({ req, action: 'LOGOUT', entityType: 'User', entityId: row.userId, actorId: row.userId });
}

const RESET_TTL_MS = 30 * 60_000;

/** Always succeeds from the caller's perspective to avoid revealing which e-mails exist. */
export async function forgotPassword(req: Request, email: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || user.status !== 'ACTIVE') return null;
  const token = randomToken(32);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetHash: sha256(token), passwordResetExpires: new Date(Date.now() + RESET_TTL_MS) },
  });
  await recordAuditSafe({ req, action: 'PASSWORD_RESET_REQUESTED', entityType: 'User', entityId: user.id, actorId: user.id, actorEmail: user.email });
  await notifyPasswordReset(user.email, user.name, token);
  return token;
}

export async function resetPassword(req: Request, token: string, password: string) {
  const user = await prisma.user.findFirst({
    where: { passwordResetHash: sha256(token), passwordResetExpires: { gt: new Date() } },
  });
  if (!user) throw badRequest('Reset link is invalid or has expired');
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(password),
        passwordResetHash: null,
        passwordResetExpires: null,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    }),
    prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await recordAudit({ req, action: 'PASSWORD_RESET', entityType: 'User', entityId: user.id, actorId: user.id, actorEmail: user.email });
  // The holder of a valid reset token already proved control of this mailbox, so echoing it back reveals nothing new.
  return { email: user.email };
}

export async function changePassword(req: Request, current: string, next: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await bcrypt.compare(current, user.passwordHash))) throw badRequest('Current password is incorrect');
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date() } });
  await recordAudit({ req, action: 'PASSWORD_CHANGED', entityType: 'User', entityId: user.id });
}

export async function mfaSetup(req: Request) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (user.mfaEnabled) throw badRequest('MFA is already enabled');
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: user.id }, data: { mfaSecret: encryptSecret(secret) } });
  const label = encodeURIComponent(`Axiarix:${user.email}`);
  return { secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=Axiarix&algorithm=SHA1&digits=6&period=30` };
}

export async function mfaEnable(req: Request, code: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!user.mfaSecret) throw badRequest('Start MFA setup first');
  if (!verifyTotp(decryptSecret(user.mfaSecret), code)) throw badRequest('Invalid verification code');
  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
  await recordAudit({ req, action: 'MFA_ENABLED', entityType: 'User', entityId: user.id });
}

export async function mfaDisable(req: Request, password: string, code: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!user.mfaEnabled || !user.mfaSecret) throw badRequest('MFA is not enabled');
  const security = await getSetting('security.policy', user.organisationId);
  if (security.enforceMfaForPrivileged && req.user!.roles.some((r) => PRIVILEGED_ROLES.includes(r))) throw forbidden('Your role requires two-step verification, so it cannot be switched off');
  if (!(await bcrypt.compare(password, user.passwordHash))) throw badRequest('Password is incorrect');
  if (!verifyTotp(decryptSecret(user.mfaSecret), code)) throw badRequest('Invalid verification code');
  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecret: null } });
  await recordAudit({ req, action: 'MFA_DISABLED', entityType: 'User', entityId: user.id });
}
