import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { recordAudit } from '../../services/audit.service.js';
import { sendTestEmail } from '../../services/notification.service.js';
import { getSetting, setSetting, settingSchemas, type SettingKey } from '../../services/settings.service.js';
import { badRequest, invalidState, notFound } from '../../utils/errors.js';
import { created, ok, param } from '../../utils/http.js';
import * as svc from './admin.service.js';
import { administeredSiteIds } from '../../services/admin-scope.service.js';

export const adminRouter = Router();

// ───────────── Admin home: setup progress ─────────────

/** Counts behind the admin home's setup checklist, limited to the branches this admin manages. */
adminRouter.get('/setup-status', requirePermission('organisation:update', 'organisation:create', 'user:create'), async (req, res) => {
  const orgId = req.user!.organisationId;
  const siteIds = administeredSiteIds(req.user!, req.user!.permissions.has('user:create') ? 'user:create' : 'organisation:update');
  const siteFilter = siteIds ? { id: { in: siteIds } } : {};
  const unitFilter = siteIds ? { siteId: { in: siteIds } } : {};
  const [org, sites, departments, users, versions, assessments, schedules, flagged] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: orgId }, select: { id: true, name: true, legalEntity: true } }),
    prisma.site.findMany({ where: { organisationId: orgId, ...siteFilter }, select: { id: true, name: true, status: true } }),
    prisma.department.findMany({ where: { organisationId: orgId, ...unitFilter }, select: { id: true, name: true, ownerId: true, siteId: true } }),
    prisma.user.findMany({
      where: { organisationId: orgId, isPlatformOwner: false, status: 'ACTIVE', ...(siteIds ? { roles: { some: { siteId: { in: siteIds } } } } : {}) },
      select: { id: true, lastLoginAt: true, roles: { select: { role: { select: { key: true } } } } },
    }),
    prisma.checklistVersion.groupBy({ by: ['status'], where: { template: { organisationId: orgId } }, _count: true }),
    prisma.assessment.count({ where: { organisationId: orgId, ...unitFilter } }),
    prisma.assessmentSchedule.count({ where: { organisationId: orgId, ...unitFilter, isActive: true } }),
    prisma.controlMapping.count({ where: { needsReview: true, item: { version: { status: { in: ['DRAFT', 'UNDER_REVIEW'] }, template: { organisationId: orgId } } } } }),
  ]);
  const roleCounts: Record<string, number> = {};
  for (const u of users) for (const r of new Set(u.roles.map((x) => x.role.key))) roleCounts[r] = (roleCounts[r] ?? 0) + 1;
  const byStatus = Object.fromEntries(versions.map((v) => [v.status, v._count]));
  ok(res, {
    organisation: org,
    scope: siteIds ? 'site' : 'organisation',
    sites: sites.length,
    siteNames: sites.map((s) => s.name),
    departments: departments.length,
    departmentsWithoutOwner: departments.filter((d) => !d.ownerId).map((d) => ({ id: d.id, name: d.name, siteId: d.siteId })),
    users: users.length,
    usersNeverSignedIn: users.filter((u) => !u.lastLoginAt).length,
    roleCounts,
    checklists: { draft: byStatus.DRAFT ?? 0, underReview: byStatus.UNDER_REVIEW ?? 0, published: byStatus.PUBLISHED ?? 0 },
    flaggedMappings: flagged,
    assessments,
    schedules,
  });
});

// ───────────── System settings ─────────────

adminRouter.get('/settings', requirePermission('settings:read'), async (req, res) => {
  const keys = Object.keys(settingSchemas) as SettingKey[];
  const entries = await Promise.all(keys.map(async (k) => [k, await getSetting(k, req.user!.organisationId)] as const));
  ok(res, Object.fromEntries(entries));
});

adminRouter.put('/settings/:key', requirePermission('settings:update'), async (req, res) => {
  const key = param(req, 'key') as SettingKey;
  if (!(key in settingSchemas)) throw notFound('Setting');
  const before = await getSetting(key, req.user!.organisationId);
  await setSetting(key, req.body, req.user!.id, req.user!.organisationId);
  await recordAudit({ req, action: 'SETTINGS_CHANGED', entityType: 'SystemSetting', entityId: key, metadata: { before, after: req.body } });
  ok(res, await getSetting(key, req.user!.organisationId));
});

adminRouter.post('/settings/test-email', requirePermission('settings:update'), validate(z.object({ to: z.string().email() })), async (req, res) => {
  try {
    await sendTestEmail(req.body.to);
    await recordAudit({ req, action: 'SMTP_TEST_SENT', entityType: 'SystemSetting', entityId: 'notification.policy', metadata: { ok: true } });
    ok(res, { sent: true });
  } catch (err) {
    await recordAudit({ req, action: 'SMTP_TEST_SENT', entityType: 'SystemSetting', entityId: 'notification.policy', outcome: 'FAILURE', metadata: { error: (err as Error).message } });
    throw badRequest(`SMTP test failed: ${(err as Error).message}`);
  }
});

adminRouter.post('/reminders/run', requirePermission('settings:update'), async (req, res) => {
  const result = await svc.sendDeadlineReminders();
  await recordAudit({ req, action: 'REMINDERS_SENT', entityType: 'Notification', metadata: result });
  ok(res, result);
});

// ───────────── Scoring policies (versioned) ─────────────

const policySchema = z.object({
  name: z.string().trim().min(3).max(120),
  weightCompliant: z.number().min(0).max(1),
  weightPartial: z.number().min(0).max(1),
  weightNonCompliant: z.number().min(0).max(1),
  excludeNotApplicable: z.boolean(),
  excludeNotAssessed: z.boolean(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

adminRouter.get('/scoring-policies', requirePermission('settings:read'), async (req, res) => {
  ok(res, await prisma.scoringPolicy.findMany({ where: { organisationId: req.user!.organisationId }, orderBy: { version: 'desc' }, include: { _count: { select: { assessments: true } } } }));
});

adminRouter.post('/scoring-policies', requirePermission('settings:update'), validate(policySchema), async (req, res) => {
  const last = await prisma.scoringPolicy.findFirst({ where: { organisationId: req.user!.organisationId }, orderBy: { version: 'desc' } });
  const p = await prisma.scoringPolicy.create({ data: { ...req.body, organisationId: req.user!.organisationId, version: (last?.version ?? 0) + 1, isActive: false } });
  await recordAudit({ req, action: 'SCORING_POLICY_CREATED', entityType: 'ScoringPolicy', entityId: p.id, metadata: { version: p.version } });
  created(res, p);
});

/**
 * Approves and activates a scoring policy version for NEW assessments. Existing assessments keep
 * their pinned policy and issued reports keep their frozen figures (no retroactive change).
 */
adminRouter.post('/scoring-policies/:id/activate', requirePermission('settings:approve'), async (req, res) => {
  const id = param(req, 'id');
  const p = await prisma.scoringPolicy.findFirst({ where: { id, organisationId: req.user!.organisationId } });
  if (!p) throw notFound('Scoring policy');
  if (p.isActive) throw invalidState('Policy is already active');
  await prisma.$transaction([
    prisma.scoringPolicy.updateMany({ where: { organisationId: p.organisationId, isActive: true }, data: { isActive: false } }),
    prisma.scoringPolicy.update({ where: { id }, data: { isActive: true, approvedById: req.user!.id, approvedAt: new Date() } }),
  ]);
  await recordAudit({ req, action: 'SCORING_POLICY_ACTIVATED', entityType: 'ScoringPolicy', entityId: id, metadata: { version: p.version } });
  ok(res, { activated: true });
});

// ───────────── Retention & secure deletion ─────────────

adminRouter.get('/retention-policies', requirePermission('settings:read'), async (req, res) => {
  ok(res, await prisma.retentionPolicy.findMany({ where: { organisationId: req.user!.organisationId }, orderBy: { entityType: 'asc' } }));
});

adminRouter.put(
  '/retention-policies/:entityType',
  requirePermission('settings:update'),
  validate(z.object({ retentionDays: z.number().int().min(30).max(36500), action: z.enum(['ARCHIVE', 'REQUEST_DELETION']), isActive: z.boolean(), description: z.string().max(1000).nullable().optional() })),
  async (req, res) => {
    const entityType = param(req, 'entityType');
    if (entityType !== 'EVIDENCE' && entityType !== 'REPORT') throw badRequest('entityType must be EVIDENCE or REPORT');
    const organisationId = req.user!.organisationId;
    const p = await prisma.retentionPolicy.upsert({
      where: { organisationId_entityType: { organisationId, entityType } },
      create: { organisationId, entityType, ...req.body },
      update: req.body,
    });
    await recordAudit({ req, action: 'RETENTION_POLICY_CHANGED', entityType: 'RetentionPolicy', entityId: p.id, metadata: req.body });
    ok(res, p);
  },
);

adminRouter.post('/retention/run', requirePermission('settings:update'), async (req, res) => ok(res, await svc.applyRetention(req, req.user!.organisationId)));

adminRouter.get('/deletion-requests', requirePermission('settings:read'), async (_req, res) => {
  const rows = await prisma.deletionRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  const userIds = [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById]).filter((x): x is string => !!x))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  ok(res, rows.map((r) => ({ ...r, requestedBy: users.find((u) => u.id === r.requestedById) ?? { id: r.requestedById, name: r.requestedById === 'system' ? 'Retention job' : 'Unknown' }, decidedBy: users.find((u) => u.id === r.decidedById) ?? null })));
});
adminRouter.post(
  '/deletion-requests',
  requirePermission('settings:update'),
  validate(z.object({ entityType: z.enum(['Evidence', 'Report']), entityId: z.string().uuid(), reason: z.string().trim().min(10).max(1000) })),
  async (req, res) => created(res, await svc.requestDeletion(req, req.body.entityType, req.body.entityId, req.body.reason)),
);
adminRouter.post('/deletion-requests/:id/decision', requirePermission('settings:approve'), validate(z.object({ decision: z.enum(['APPROVED', 'REJECTED']) })), async (req, res) =>
  ok(res, await svc.decideDeletion(req, param(req, 'id'), req.body.decision)),
);
adminRouter.post('/deletion-requests/:id/execute', requirePermission('settings:update'), async (req, res) => ok(res, await svc.executeDeletion(req, param(req, 'id'))));

// ───────────── Assessment schedules ─────────────

const scheduleSchema = z.object({
  siteId: z.string().uuid(),
  departmentId: z.string().uuid(),
  checklistTemplateId: z.string().uuid(),
  frequency: z.enum(['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY']),
  nextRunDate: z.coerce.date(),
  durationDays: z.number().int().min(1).max(365),
  isActive: z.boolean().default(true),
});

adminRouter.get('/schedules', requirePermission('assessment:create', 'settings:read'), async (req, res) => {
  ok(
    res,
    await prisma.assessmentSchedule.findMany({
      where: { organisationId: req.user!.organisationId },
      include: { site: { select: { id: true, name: true } }, department: { select: { id: true, name: true } }, template: { select: { id: true, title: true } } },
      orderBy: { nextRunDate: 'asc' },
    }),
  );
});
adminRouter.post('/schedules', requirePermission('assessment:create'), validate(scheduleSchema), async (req, res) => {
  const org = req.user!.organisationId;
  const dept = await prisma.department.findFirst({ where: { id: req.body.departmentId, siteId: req.body.siteId, organisationId: org } });
  const tpl = await prisma.checklistTemplate.findFirst({ where: { id: req.body.checklistTemplateId, organisationId: org } });
  if (!dept || !tpl) throw badRequest('Invalid department or checklist');
  const s = await prisma.assessmentSchedule.create({ data: { ...req.body, organisationId: org } });
  await recordAudit({ req, action: 'SCHEDULE_CREATED', entityType: 'AssessmentSchedule', entityId: s.id, siteId: s.siteId, metadata: { frequency: s.frequency } });
  created(res, s);
});
adminRouter.patch('/schedules/:id', requirePermission('assessment:create'), validate(scheduleSchema.partial()), async (req, res) => {
  const id = param(req, 'id');
  const s = await prisma.assessmentSchedule.findFirst({ where: { id, organisationId: req.user!.organisationId } });
  if (!s) throw notFound('Schedule');
  const updated = await prisma.assessmentSchedule.update({ where: { id }, data: req.body });
  await recordAudit({ req, action: 'SCHEDULE_UPDATED', entityType: 'AssessmentSchedule', entityId: id, metadata: { fields: Object.keys(req.body) } });
  ok(res, updated);
});
adminRouter.post('/schedules/:id/run', requirePermission('assessment:create'), async (req, res) => created(res, await svc.runSchedule(req, param(req, 'id'))));
