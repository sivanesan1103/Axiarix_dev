import type { Request } from 'express';
import type { FindingCategory, FindingStatus, Severity } from '@prisma/client';
import { assertSod, sodError } from '../../services/sod.service.js';
import { prisma, type Tx } from '../../config/prisma.js';
import { recordAudit } from '../../services/audit.service.js';
import { notify } from '../../services/notification.service.js';
import { assertUnitAccess } from '../../services/scope.service.js';
import { nextCode } from '../../services/settings.service.js';
import { recordTransition } from '../../services/workflow.service.js';
import { badRequest, forbidden, invalidState, notFound, validationError } from '../../utils/errors.js';
import { loadAssessment, usersInUnit } from '../assessments/assessments.service.js';

const RAISE_STATUSES = ['SUBMITTED_FOR_AUDIT', 'UNDER_REVIEW', 'CLARIFICATION_REQUIRED', 'REVIEWED', 'PENDING_APPROVAL'];

export async function loadFinding(req: Request, id: string, db: Tx = prisma) {
  const f = await db.finding.findFirst({ where: { id, organisationId: req.user!.organisationId } });
  if (!f) throw notFound('Finding');
  await assertUnitAccess(req, f, 'Finding', f.id);
  return f;
}

async function setFindingStatus(tx: Tx, req: Request, f: { id: string; status: FindingStatus; siteId: string }, to: FindingStatus, reason?: string | null, extra: Record<string, unknown> = {}) {
  if (f.status === to) return;
  await tx.finding.update({ where: { id: f.id }, data: { status: to, ...extra } });
  await recordTransition(tx, 'Finding', f.id, f.status, to, req.user!.id, reason);
  await recordAudit({ req, action: `FINDING_${to}`, entityType: 'Finding', entityId: f.id, siteId: f.siteId, metadata: { from: f.status, to, reason: reason ?? null } }, tx);
}

async function assertOrgUser(organisationId: string, userId: string) {
  const u = await prisma.user.findFirst({ where: { id: userId, organisationId, status: 'ACTIVE' } });
  if (!u) throw badRequest('Selected owner not found or inactive');
  return u;
}

export interface FindingInput {
  assessmentId: string;
  itemId?: string | null;
  category: FindingCategory;
  severity: Severity;
  title: string;
  description: string;
  auditorComments?: string | null;
  ownerId?: string | null;
  dueDate: Date;
}

/** Auditor raises a finding against an assessment (and optionally a question). AT-07. */
export async function createFinding(req: Request, input: FindingInput) {
  const a = await loadAssessment(req, input.assessmentId);
  if (!RAISE_STATUSES.includes(a.status)) throw invalidState('Findings can be raised once the assessment has been submitted for audit');
  await assertSod(req.user!.id, a, 'audit');
  if (input.itemId) {
    const item = await prisma.checklistItem.findFirst({ where: { id: input.itemId, versionId: a.checklistVersionId } });
    if (!item) throw notFound('Question');
  }
  if (input.ownerId) await assertOrgUser(a.organisationId, input.ownerId);
  const finding = await prisma.$transaction(async (tx) => {
    const code = await nextCode('FND', tx);
    const status: FindingStatus = input.ownerId ? 'ASSIGNED' : 'OPEN';
    const f = await tx.finding.create({
      data: { ...input, code, status, organisationId: a.organisationId, siteId: a.siteId, departmentId: a.departmentId, raisedById: req.user!.id },
    });
    await recordTransition(tx, 'Finding', f.id, null, 'OPEN', req.user!.id);
    if (status === 'ASSIGNED') await recordTransition(tx, 'Finding', f.id, 'OPEN', 'ASSIGNED', req.user!.id);
    await recordAudit({ req, action: 'FINDING_CREATED', entityType: 'Finding', entityId: f.id, siteId: f.siteId, metadata: { code, severity: f.severity, category: f.category, assessmentId: a.id } }, tx);
    return f;
  });
  await notify({
    userIds: [input.ownerId ?? a.ownerId],
    type: 'FINDING_CREATED',
    title: `New ${finding.severity.toLowerCase()} finding: ${finding.code}`,
    body: `${finding.title} – due ${finding.dueDate.toISOString().slice(0, 10)}`,
    link: `/findings/${finding.id}`,
  });
  return finding;
}

export async function updateFinding(req: Request, id: string, input: Partial<Omit<FindingInput, 'assessmentId' | 'itemId' | 'ownerId'>>) {
  const f = await loadFinding(req, id);
  if (f.status === 'CLOSED') throw invalidState('Closed findings cannot be edited');
  if (!req.user!.permissions.has('finding:review') && f.raisedById !== req.user!.id) throw forbidden('Only the auditor can edit finding details');
  const updated = await prisma.finding.update({ where: { id }, data: input });
  await recordAudit({ req, action: 'FINDING_UPDATED', entityType: 'Finding', entityId: id, siteId: f.siteId, metadata: { fields: Object.keys(input) } });
  return updated;
}

export async function assignFinding(req: Request, id: string, ownerId: string, dueDate?: Date | null) {
  const f = await loadFinding(req, id);
  if (f.status === 'CLOSED') throw invalidState('Finding is closed');
  await assertOrgUser(f.organisationId, ownerId);
  await prisma.$transaction(async (tx) => {
    await tx.finding.update({ where: { id }, data: { ownerId, ...(dueDate ? { dueDate } : {}) } });
    if (f.status === 'OPEN') await setFindingStatus(tx, req, f, 'ASSIGNED');
    await recordAudit({ req, action: 'FINDING_ASSIGNED', entityType: 'Finding', entityId: id, siteId: f.siteId, metadata: { ownerId } }, tx);
  });
  await notify({ userIds: [ownerId], type: 'FINDING_CREATED', title: `Finding assigned: ${f.code}`, body: f.title, link: `/findings/${f.id}` });
  return prisma.finding.findUniqueOrThrow({ where: { id } });
}

export interface ActionInput {
  rootCause?: string | null;
  immediateCorrection?: string | null;
  correctiveAction: string;
  ownerId: string;
  targetDate: Date;
}

export async function createAction(req: Request, findingId: string, input: ActionInput) {
  const f = await loadFinding(req, findingId);
  if (f.status === 'CLOSED') throw invalidState('Finding is closed');
  const u = req.user!;
  if (!u.permissions.has('corrective_action:create') && f.ownerId !== u.id) throw forbidden('Only the finding owner or IT owner can plan corrective actions');
  await assertOrgUser(f.organisationId, input.ownerId);
  const action = await prisma.$transaction(async (tx) => {
    const code = await nextCode('CA', tx);
    const ca = await tx.correctiveAction.create({ data: { ...input, code, findingId, createdById: u.id } });
    await recordTransition(tx, 'CorrectiveAction', ca.id, null, 'PLANNED', u.id);
    await recordAudit({ req, action: 'CORRECTIVE_ACTION_CREATED', entityType: 'CorrectiveAction', entityId: ca.id, siteId: f.siteId, metadata: { code, findingId, ownerId: input.ownerId } }, tx);
    await setFindingStatus(tx, req, f, 'ACTION_IN_PROGRESS', `Corrective action ${code} planned`, f.ownerId ? {} : { ownerId: input.ownerId });
    return ca;
  });
  await notify({ userIds: [input.ownerId], type: 'ACTION_DEADLINE', title: `Corrective action assigned: ${action.code}`, body: `${input.correctiveAction.slice(0, 160)} – target ${input.targetDate.toISOString().slice(0, 10)}`, link: `/corrective-actions/${action.id}` });
  return action;
}

export async function loadAction(req: Request, id: string) {
  const ca = await prisma.correctiveAction.findFirst({ where: { id, finding: { organisationId: req.user!.organisationId } }, include: { finding: true } });
  if (!ca) throw notFound('Corrective action');
  await assertUnitAccess(req, ca.finding, 'CorrectiveAction', ca.id);
  return ca;
}

function assertActionEditor(req: Request, ca: { ownerId: string; status: string }) {
  if (!['PLANNED', 'IN_PROGRESS', 'RETURNED'].includes(ca.status)) throw invalidState('This action is awaiting verification or already verified');
  if (ca.ownerId !== req.user!.id && !req.user!.permissions.has('corrective_action:create')) throw forbidden('Only the action owner can update it');
}

export async function updateAction(req: Request, id: string, input: Partial<ActionInput>) {
  const ca = await loadAction(req, id);
  assertActionEditor(req, ca);
  if (input.ownerId) await assertOrgUser(ca.finding.organisationId, input.ownerId);
  const updated = await prisma.correctiveAction.update({ where: { id }, data: input });
  await recordAudit({ req, action: 'CORRECTIVE_ACTION_UPDATED', entityType: 'CorrectiveAction', entityId: id, siteId: ca.finding.siteId, metadata: { fields: Object.keys(input) } });
  return updated;
}

export async function addProgress(req: Request, id: string, note: string, progressPercent?: number | null) {
  const ca = await loadAction(req, id);
  assertActionEditor(req, ca);
  return prisma.$transaction(async (tx) => {
    const upd = await tx.correctiveActionUpdate.create({ data: { actionId: id, authorId: req.user!.id, note, progressPercent: progressPercent ?? null } });
    const to = ca.status === 'PLANNED' || ca.status === 'RETURNED' ? 'IN_PROGRESS' : ca.status;
    await tx.correctiveAction.update({ where: { id }, data: { status: to, ...(progressPercent != null ? { progressPercent } : {}) } });
    if (to !== ca.status) await recordTransition(tx, 'CorrectiveAction', id, ca.status, to, req.user!.id, 'Progress update');
    await recordAudit({ req, action: 'CORRECTIVE_ACTION_PROGRESS', entityType: 'CorrectiveAction', entityId: id, siteId: ca.finding.siteId, metadata: { progressPercent: progressPercent ?? null } }, tx);
    return upd;
  });
}

/** Owner submits for verification; at least one clean closure evidence file is mandatory. */
export async function submitAction(req: Request, id: string, closureNotes: string) {
  const ca = await loadAction(req, id);
  assertActionEditor(req, ca);
  const evidence = await prisma.evidence.findMany({ where: { correctiveActionId: id, deletedAt: null }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
  if (!evidence.some((e) => e.verificationStatus !== 'REJECTED' && e.versions[0]?.scanStatus === 'CLEAN')) {
    throw validationError('Attach at least one closure evidence file before submitting for verification');
  }
  await prisma.$transaction(async (tx) => {
    await tx.correctiveAction.update({ where: { id }, data: { status: 'SUBMITTED_FOR_VERIFICATION', closureNotes, progressPercent: 100 } });
    await recordTransition(tx, 'CorrectiveAction', id, ca.status, 'SUBMITTED_FOR_VERIFICATION', req.user!.id, closureNotes.slice(0, 500));
    await recordAudit({ req, action: 'CORRECTIVE_ACTION_SUBMITTED', entityType: 'CorrectiveAction', entityId: id, siteId: ca.finding.siteId }, tx);
    const siblings = await tx.correctiveAction.findMany({ where: { findingId: ca.findingId } });
    if (siblings.every((s) => ['SUBMITTED_FOR_VERIFICATION', 'VERIFIED'].includes(s.status))) {
      await setFindingStatus(tx, req, ca.finding, 'READY_FOR_VERIFICATION', 'All corrective actions submitted');
    }
  });
  await notify({
    userIds: [ca.finding.raisedById, ...(await usersInUnit(['AUDITOR'], ca.finding))],
    type: 'APPROVAL_REQUESTED',
    title: `Closure evidence submitted: ${ca.code}`,
    body: `Corrective action for ${ca.finding.code} is ready for verification.`,
    link: `/corrective-actions/${ca.id}`,
  });
}

/** Owner of the action, or anyone who recorded its submission for verification. */
export async function isActionPreparer(userId: string, ca: { id: string; ownerId: string }) {
  if (ca.ownerId === userId) return true;
  return !!(await prisma.statusHistory.findFirst({ where: { entityType: 'CorrectiveAction', entityId: ca.id, toStatus: 'SUBMITTED_FOR_VERIFICATION', actorId: userId } }));
}

/**
 * Auditor verifies or returns closure evidence (FR-017). Returning requires a comment and puts
 * the finding back to Action In Progress. A finding closes only via {@link closeFinding}.
 */
export async function verifyAction(req: Request, id: string, decision: 'VERIFIED' | 'RETURNED', comment?: string | null) {
  const ca = await loadAction(req, id);
  if (ca.status !== 'SUBMITTED_FOR_VERIFICATION') throw invalidState('Only submitted actions can be verified');
  if (await isActionPreparer(req.user!.id, ca)) throw sodError('You own or submitted this corrective action, so someone else must verify it.');
  if (decision === 'RETURNED' && !comment?.trim()) throw validationError('A comment is required when returning closure evidence');
  await prisma.$transaction(async (tx) => {
    await tx.correctiveAction.update({
      where: { id },
      data: { status: decision, verificationComment: comment, ...(decision === 'VERIFIED' ? { verifiedById: req.user!.id, verifiedAt: new Date() } : {}) },
    });
    await recordTransition(tx, 'CorrectiveAction', id, ca.status, decision, req.user!.id, comment);
    await recordAudit({ req, action: decision === 'VERIFIED' ? 'CORRECTIVE_ACTION_VERIFIED' : 'CORRECTIVE_ACTION_RETURNED', entityType: 'CorrectiveAction', entityId: id, siteId: ca.finding.siteId, metadata: { comment: comment ?? null } }, tx);
    if (decision === 'RETURNED') {
      await tx.evidence.updateMany({ where: { correctiveActionId: id, verificationStatus: 'PENDING' }, data: { verificationStatus: 'REJECTED', verificationNote: comment } });
      await setFindingStatus(tx, req, ca.finding, 'ACTION_IN_PROGRESS', `Closure evidence returned: ${comment}`);
    } else {
      await tx.evidence.updateMany({ where: { correctiveActionId: id, verificationStatus: 'PENDING' }, data: { verificationStatus: 'ACCEPTED', verifiedById: req.user!.id, verifiedAt: new Date() } });
    }
  });
  if (decision === 'RETURNED') {
    await notify({ userIds: [ca.ownerId], type: 'EVIDENCE_REJECTED', title: `Closure evidence returned: ${ca.code}`, body: comment ?? '', link: `/corrective-actions/${ca.id}` });
  }
}

/** Closes a finding after all actions are verified, or by recorded override when there are none (observations). */
export async function closeFinding(req: Request, id: string, closureRecommendation: string, overrideReason?: string | null) {
  const f = await loadFinding(req, id);
  if (f.status === 'CLOSED') throw invalidState('Finding is already closed');
  const actions = await prisma.correctiveAction.findMany({ where: { findingId: id } });
  if (actions.length && actions.some((a) => a.status !== 'VERIFIED')) throw invalidState('All corrective actions must be verified before the finding can be closed');
  if (!actions.length && !overrideReason?.trim()) throw validationError('This finding has no verified corrective action. Provide an override reason to close it.');
  await prisma.$transaction((tx) =>
    setFindingStatus(tx, req, f, 'CLOSED', overrideReason ? `Closed by override: ${overrideReason}` : 'All corrective actions verified', {
      closureRecommendation,
      closedAt: new Date(),
      closedById: req.user!.id,
    }),
  );
  return prisma.finding.findUniqueOrThrow({ where: { id } });
}

export async function commentOnFinding(req: Request, id: string, body: string) {
  const f = await loadFinding(req, id);
  const c = await prisma.reviewComment.create({ data: { findingId: id, assessmentId: f.assessmentId, authorId: req.user!.id, body }, include: { author: { select: { id: true, name: true } } } });
  await recordAudit({ req, action: 'COMMENT_ADDED', entityType: 'Finding', entityId: id, siteId: f.siteId });
  return c;
}
