import type { Tx } from '../config/prisma.js';
import { ACTIONS, RESOURCES, ROLE_DEFINITIONS, type RoleKey } from '../constants/permissions.js';

/** Global permission catalogue (`resource:action`), shared by every organisation. Idempotent. */
export async function ensurePermissions(db: Tx) {
  for (const resource of RESOURCES) {
    for (const action of ACTIONS) {
      const key = `${resource}:${action}`;
      await db.permission.upsert({ where: { key }, create: { key, resource, action, description: `${action} ${resource.replace('_', ' ')}` }, update: {} });
    }
  }
}

/**
 * Gives an organisation its own copy of the six built-in roles with their default permissions.
 * Existing roles keep any permission changes the organisation already made. Idempotent.
 */
export async function ensureOrgRoles(db: Tx, organisationId: string) {
  const perms = await db.permission.findMany();
  const out: Partial<Record<RoleKey, string>> = {};
  for (const [key, def] of Object.entries(ROLE_DEFINITIONS) as [RoleKey, (typeof ROLE_DEFINITIONS)[RoleKey]][]) {
    const role = await db.role.upsert({
      where: { organisationId_key: { organisationId, key } },
      create: { organisationId, key, name: def.name, description: def.description },
      update: { name: def.name, description: def.description },
    });
    if ((await db.rolePermission.count({ where: { roleId: role.id } })) === 0) {
      await db.rolePermission.createMany({ data: perms.filter((p) => def.permissions.includes(p.key as never)).map((p) => ({ roleId: role.id, permissionId: p.id })) });
    }
    out[key] = role.id;
  }
  return out as Record<RoleKey, string>;
}

/** Default scoring and retention policies for a new organisation. Idempotent. */
export async function ensureOrgPolicies(db: Tx, organisationId: string, approvedById: string | null) {
  const existing = await db.scoringPolicy.findFirst({ where: { organisationId } });
  if (!existing) {
    await db.scoringPolicy.create({
      data: {
        organisationId,
        version: 1,
        name: 'SRS §9 proposed default',
        weightCompliant: 1,
        weightPartial: 0.5,
        weightNonCompliant: 0,
        excludeNotApplicable: true,
        excludeNotAssessed: false,
        isActive: true,
        approvedById,
        approvedAt: new Date(),
        notes: 'Proposed default from the SRS. Treatment of N/A and Not Assessed is an open stakeholder decision (SRS §13 "Scoring").',
      },
    });
  }
  for (const entityType of ['EVIDENCE', 'REPORT'] as const) {
    await db.retentionPolicy.upsert({
      where: { organisationId_entityType: { organisationId, entityType } },
      create: { organisationId, entityType, retentionDays: 2555, action: 'ARCHIVE', description: 'Proposed 7-year retention pending policy confirmation (SRS §13).' },
      update: {},
    });
  }
}
