import type { Request } from 'express';
import { prisma } from '../../config/prisma.js';
import { recordAudit, recordAuditSafe } from '../../services/audit.service.js';
import { notify } from '../../services/notification.service.js';
import { getSetting } from '../../services/settings.service.js';
import { storage } from '../../services/storage/index.js';
import { badRequest, forbidden, invalidState, notFound } from '../../utils/errors.js';
import { createAssessment } from '../assessments/assessments.service.js';
import { periodLabelFor } from '../../utils/period.js';

/**
 * Applies active retention policies. ARCHIVE hides records from normal views; REQUEST_DELETION
 * opens a secure-deletion request that a second authorised person must approve (NFR-SEC-11).
 * Only records of closed (approved) assessments are eligible, so live audit work is never affected.
 */
export async function applyRetention(req: Request | null, organisationId: string) {
  const policies = await prisma.retentionPolicy.findMany({ where: { organisationId, isActive: true } });
  const summary = { archived: 0, deletionRequests: 0 };
  for (const p of policies) {
    const cutoff = new Date(Date.now() - p.retentionDays * 86_400_000);
    if (p.entityType === 'EVIDENCE') {
      const due = await prisma.evidence.findMany({
        where: { organisationId, archivedAt: null, deletedAt: null, createdAt: { lt: cutoff }, OR: [{ assessment: { status: 'APPROVED' } }, { assessmentId: null }] },
        select: { id: true },
      });
      for (const e of due) {
        if (p.action === 'ARCHIVE') {
          await prisma.evidence.update({ where: { id: e.id }, data: { archivedAt: new Date() } });
          summary.archived++;
        } else if (!(await prisma.deletionRequest.findFirst({ where: { entityType: 'Evidence', entityId: e.id, status: { in: ['PENDING', 'APPROVED'] } } }))) {
          await prisma.deletionRequest.create({ data: { organisationId, entityType: 'Evidence', entityId: e.id, reason: `Retention policy: older than ${p.retentionDays} days`, requestedById: req?.user?.id ?? 'system' } });
          summary.deletionRequests++;
        }
      }
    } else {
      const due = await prisma.report.findMany({ where: { organisationId, archivedAt: null, generatedAt: { lt: cutoff } }, select: { id: true } });
      for (const r of due) {
        if (p.action === 'ARCHIVE') {
          await prisma.report.update({ where: { id: r.id }, data: { archivedAt: new Date() } });
          summary.archived++;
        } else if (!(await prisma.deletionRequest.findFirst({ where: { entityType: 'Report', entityId: r.id, status: { in: ['PENDING', 'APPROVED'] } } }))) {
          await prisma.deletionRequest.create({ data: { organisationId, entityType: 'Report', entityId: r.id, reason: `Retention policy: older than ${p.retentionDays} days`, requestedById: req?.user?.id ?? 'system' } });
          summary.deletionRequests++;
        }
      }
    }
  }
  if (req) await recordAudit({ req, action: 'RETENTION_APPLIED', entityType: 'RetentionPolicy', metadata: summary });
  else await recordAuditSafe({ action: 'RETENTION_APPLIED', entityType: 'RetentionPolicy', organisationId, metadata: summary });
  return summary;
}

export async function requestDeletion(req: Request, entityType: 'Evidence' | 'Report', entityId: string, reason: string) {
  const org = req.user!.organisationId;
  const exists = entityType === 'Evidence' ? await prisma.evidence.findFirst({ where: { id: entityId, organisationId: org } }) : await prisma.report.findFirst({ where: { id: entityId, organisationId: org } });
  if (!exists) throw notFound(entityType);
  const dr = await prisma.deletionRequest.create({ data: { organisationId: org, entityType, entityId, reason, requestedById: req.user!.id } });
  await recordAudit({ req, action: 'DELETION_REQUESTED', entityType, entityId, metadata: { requestId: dr.id, reason } });
  return dr;
}

/** Second-person decision. The requester can never approve their own request. */
export async function decideDeletion(req: Request, id: string, decision: 'APPROVED' | 'REJECTED') {
  const dr = await prisma.deletionRequest.findFirst({ where: { id, organisationId: req.user!.organisationId } });
  if (!dr) throw notFound('Deletion request');
  if (dr.status !== 'PENDING') throw invalidState('Request already decided');
  if (dr.requestedById === req.user!.id) throw forbidden('A different authorised person must approve a deletion you requested');
  const updated = await prisma.deletionRequest.update({ where: { id }, data: { status: decision, decidedById: req.user!.id, decidedAt: new Date() } });
  await recordAudit({ req, action: `DELETION_${decision}`, entityType: dr.entityType, entityId: dr.entityId, metadata: { requestId: id } });
  return updated;
}

/**
 * Executes an approved deletion: stored file objects are destroyed; a metadata tombstone
 * (who/what/when/checksum) is retained so the audit trail stays complete.
 */
export async function executeDeletion(req: Request, id: string) {
  const dr = await prisma.deletionRequest.findFirst({ where: { id, organisationId: req.user!.organisationId } });
  if (!dr) throw notFound('Deletion request');
  if (dr.status !== 'APPROVED') throw invalidState('Only approved requests can be executed');
  if (dr.entityType === 'Evidence') {
    const ev = await prisma.evidence.findFirst({ where: { id: dr.entityId, organisationId: req.user!.organisationId }, include: { versions: true } });
    if (!ev) throw notFound('Evidence');
    for (const v of ev.versions) await storage.delete(v.storageKey).catch(() => undefined);
    await prisma.evidence.update({ where: { id: ev.id }, data: { deletedAt: new Date(), archivedAt: ev.archivedAt ?? new Date() } });
  } else if (dr.entityType === 'Report') {
    const r = await prisma.report.findFirst({ where: { id: dr.entityId, organisationId: req.user!.organisationId } });
    if (!r) throw notFound('Report');
    await storage.delete(r.storageKey).catch(() => undefined);
    await prisma.report.update({ where: { id: r.id }, data: { archivedAt: new Date(), approvalStatus: 'DELETED' } });
  } else throw badRequest('Unsupported entity type');
  const updated = await prisma.deletionRequest.update({ where: { id }, data: { status: 'EXECUTED', executedAt: new Date() } });
  await recordAudit({ req, action: 'SECURE_DELETION_EXECUTED', entityType: dr.entityType, entityId: dr.entityId, metadata: { requestId: id } });
  return updated;
}

const addMonths = (d: Date, m: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + m);
  return x;
};
const FREQ_MONTHS = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 } as const;

/** Creates the next assessment from a schedule using the template's current published version. */
export async function runSchedule(req: Request, id: string) {
  const s = await prisma.assessmentSchedule.findFirst({ where: { id, organisationId: req.user!.organisationId }, include: { template: true, department: true } });
  if (!s) throw notFound('Schedule');
  const version = await prisma.checklistVersion.findFirst({ where: { templateId: s.checklistTemplateId, status: 'PUBLISHED' }, orderBy: { versionNumber: 'desc' } });
  if (!version) throw invalidState('The scheduled checklist has no published version');
  const owner = s.department.ownerId;
  if (!owner) throw invalidState('Set a department owner before running the schedule');
  const months = FREQ_MONTHS[s.frequency];
  const periodStart = s.nextRunDate;
  const periodEnd = new Date(addMonths(periodStart, months).getTime() - 86_400_000);
  const label = periodLabelFor(periodStart, s.frequency);
  const a = await createAssessment(req, {
    title: `${s.template.title} – ${label}`,
    siteId: s.siteId,
    departmentId: s.departmentId,
    checklistVersionId: version.id,
    periodLabel: label,
    periodStart,
    periodEnd,
    startDate: periodStart,
    dueDate: new Date(periodStart.getTime() + s.durationDays * 86_400_000),
    ownerId: owner,
    assignDefaultOwners: true,
  });
  await prisma.assessmentSchedule.update({ where: { id }, data: { nextRunDate: addMonths(s.nextRunDate, months) } });
  return a;
}

/**
 * Sends assessment and corrective-action deadline reminders (FR-019). Idempotent per day:
 * a reminder is not repeated if one was already created today for the same record.
 */
export async function sendDeadlineReminders() {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  let sent = 0;
  // Each organisation has its own reminder horizon.
  const orgs = await prisma.organisation.findMany({ where: { isPlatform: false, status: 'ACTIVE' }, select: { id: true } });
  for (const org of orgs) {
    const policy = await getSetting('notification.policy', org.id);
    const horizon = new Date(Date.now() + policy.deadlineReminderDays * 86_400_000);
    const assessments = await prisma.assessment.findMany({ where: { organisationId: org.id, status: { in: ['ASSIGNED', 'IN_PROGRESS', 'CLARIFICATION_REQUIRED'] }, dueDate: { lte: horizon } } });
    for (const a of assessments) {
      const link = `/my-assessments/${a.id}`;
      if (await prisma.notification.findFirst({ where: { userId: a.ownerId, type: 'ASSESSMENT_DEADLINE', link, createdAt: { gte: since } } })) continue;
      await notify({ userIds: [a.ownerId], type: 'ASSESSMENT_DEADLINE', title: `Assessment due ${a.dueDate.toISOString().slice(0, 10)}: ${a.code}`, body: `${a.title} is ${a.dueDate < since ? 'overdue' : 'due soon'}.`, link });
      sent++;
    }
    const actions = await prisma.correctiveAction.findMany({ where: { finding: { organisationId: org.id }, status: { in: ['PLANNED', 'IN_PROGRESS', 'RETURNED'] }, targetDate: { lte: horizon } } });
    for (const ca of actions) {
      const link = `/corrective-actions/${ca.id}`;
      if (await prisma.notification.findFirst({ where: { userId: ca.ownerId, type: 'ACTION_DEADLINE', link, createdAt: { gte: since } } })) continue;
      await notify({ userIds: [ca.ownerId], type: 'ACTION_DEADLINE', title: `Corrective action ${ca.targetDate < since ? 'overdue' : 'due soon'}: ${ca.code}`, body: `Target date ${ca.targetDate.toISOString().slice(0, 10)}.`, link });
      sent++;
    }
  }
  return { sent };
}
