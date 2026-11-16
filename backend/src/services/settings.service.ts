import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma.js';

/**
 * Typed, validated system configuration stored in SystemSetting.
 * Each group has defaults so the system works before an administrator configures it.
 */
export const settingSchemas = {
  'upload.policy': z.object({
    maxFileSizeMb: z.number().int().min(1).max(200),
    allowedExtensions: z.array(z.string().regex(/^[a-z0-9]+$/)).min(1),
  }),
  'workflow.policy': z.object({
    approvalRequiredByDefault: z.boolean(),
    clarificationEnabled: z.boolean(),
    requireAuditorAcceptanceForNA: z.boolean(),
  }),
  'security.policy': z.object({
    enforceMfaForPrivileged: z.boolean(),
    maxFailedLogins: z.number().int().min(3).max(20),
    lockoutMinutes: z.number().int().min(1).max(1440),
  }),
  'notification.policy': z.object({
    emailEnabled: z.boolean(),
    events: z.record(z.boolean()),
    deadlineReminderDays: z.number().int().min(0).max(60),
  }),
  'report.config': z.object({
    headerTitle: z.string().min(1).max(200),
    footerText: z.string().max(500),
    signOffRoles: z.array(z.string().min(1).max(100)).max(8),
    includeEvidenceList: z.boolean(),
  }),
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingSchemas)[K]>;

export const NOTIFICATION_EVENTS = [
  'ASSIGNMENT_CREATED',
  'ASSESSMENT_DEADLINE',
  'CLARIFICATION_REQUESTED',
  'EVIDENCE_REJECTED',
  'FINDING_CREATED',
  'ACTION_DEADLINE',
  'APPROVAL_REQUESTED',
  'ASSESSMENT_APPROVED',
] as const;

export const settingDefaults: { [K in SettingKey]: SettingValue<K> } = {
  'upload.policy': { maxFileSizeMb: 25, allowedExtensions: ['pdf', 'docx', 'xlsx', 'csv', 'png', 'jpg', 'jpeg'] },
  'workflow.policy': { approvalRequiredByDefault: true, clarificationEnabled: true, requireAuditorAcceptanceForNA: false },
  'security.policy': { enforceMfaForPrivileged: false, maxFailedLogins: 5, lockoutMinutes: 15 },
  'notification.policy': {
    emailEnabled: true,
    events: Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, true])),
    deadlineReminderDays: 3,
  },
  'report.config': {
    headerTitle: 'ISO/IEC 27001:2022 Internal Assessment Report',
    footerText:
      'This report supports the ISMS process. It does not by itself establish conformity with ISO/IEC 27001:2022.',
    signOffRoles: ['IT Department Head', 'Hospital ISMS / Compliance Owner', 'Auditor'],
    includeEvidenceList: true,
  },
};

/** Settings are stored per organisation under `org:<id>:<key>`; the legacy global row is the fallback. */
const orgKey = (organisationId: string, key: string) => `org:${organisationId}:${key}`;

export async function getSetting<K extends SettingKey>(key: K, organisationId?: string | null, db: Tx = prisma): Promise<SettingValue<K>> {
  const rows = await db.systemSetting.findMany({ where: { key: { in: organisationId ? [orgKey(organisationId, key), key] : [key] } } });
  const row = rows.find((r) => r.key !== key) ?? rows.find((r) => r.key === key);
  if (!row) return settingDefaults[key];
  const parsed = settingSchemas[key].safeParse({ ...(settingDefaults[key] as object), ...(row.value as object) });
  return (parsed.success ? parsed.data : settingDefaults[key]) as SettingValue<K>;
}

export async function setSetting<K extends SettingKey>(key: K, value: unknown, userId: string, organisationId: string) {
  const parsed = settingSchemas[key].parse(value) as Prisma.InputJsonValue;
  const k = orgKey(organisationId, key);
  return prisma.systemSetting.upsert({
    where: { key: k },
    create: { key: k, value: parsed, updatedBy: userId },
    update: { value: parsed, updatedBy: userId },
  });
}

/** Atomically increments a named counter and returns a formatted code such as `ASM-2026-0007`. */
export async function nextCode(prefix: string, db: Tx = prisma): Promise<string> {
  const year = new Date().getUTCFullYear();
  const key = `counter.${prefix}.${year}`;
  const rows = await db.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "SystemSetting" (key, value, "updatedAt") VALUES (${key}, '1'::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = to_jsonb(("SystemSetting".value)::text::int + 1), "updatedAt" = now()
    RETURNING (value)::text::int AS value`;
  return `${prefix}-${year}-${String(rows[0].value).padStart(4, '0')}`;
}
