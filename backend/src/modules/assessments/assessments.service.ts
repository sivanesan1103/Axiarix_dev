import type { Request } from 'express';
import type { AssessmentStatus, Prisma, ResponseStatus } from '@prisma/client';
import { assertSod, assessmentParticipants, sodBlockReason } from '../../services/sod.service.js';
import { prisma, type Tx } from '../../config/prisma.js';
import type { RoleKey } from '../../constants/permissions.js';
import type { AuthUser } from '../../types/auth.js';
import { recordAudit, recordAuditSafe } from '../../services/audit.service.js';
import { assessmentMetrics } from '../../services/compliance.service.js';
import { notify } from '../../services/notification.service.js';
import { assertUnitAccess, assertUserCoversUnit, canAccessUnit } from '../../services/scope.service.js';
import { getSetting, nextCode } from '../../services/settings.service.js';
import { recordTransition } from '../../services/workflow.service.js';
import { parsePeriod, PERIOD_FORMAT_HINT } from '../../utils/period.js';
import { AppError, badRequest, forbidden, invalidState, notFound, validationError } from '../../utils/errors.js';
import { generateFinalReport } from '../reports/reports.service.js';

/** Statuses in which the IT department may edit answers. */
export const EDITABLE_STATUSES: AssessmentStatus[] = ['ASSIGNED', 'IN_PROGRESS', 'CLARIFICATION_REQUIRED'];
/** Statuses from which an authorised user may reopen. */
const REOPENABLE: AssessmentStatus[] = ['SUBMITTED_FOR_AUDIT', 'UNDER_REVIEW', 'CLARIFICATION_REQUIRED', 'REVIEWED', 'PENDING_APPROVAL', 'APPROVED'];

const hasRole = (u: AuthUser, ...roles: RoleKey[]) => u.roles.some((r) => roles.includes(r));

/** Loads an assessment and enforces organisation/site/department scope (403 + audit when outside). */
export async function loadAssessment(req: Request, id: string, db: Tx = prisma) {
  const a = await db.assessment.findFirst({ where: { id, organisationId: req.user!.organisationId } });
  if (!a) throw notFound('Assessment');
  await assertUnitAccess(req, a, 'Assessment', a.id);
  return a;
}

/** Users holding any of `roles` whose scope covers the given unit (used for routing notifications). */
export async function usersInUnit(roles: RoleKey[], unit: { organisationId: string; siteId: string; departmentId: string }) {
  const rows = await prisma.userRole.findMany({
    where: {
      organisationId: unit.organisationId,
      role: { key: { in: roles } },
      user: { status: 'ACTIVE' },
      AND: [{ OR: [{ siteId: null }, { siteId: unit.siteId }] }, { OR: [{ departmentId: null }, { departmentId: unit.departmentId }] }],
    },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

async function transition(
  tx: Tx,
  req: Request,
  a: { id: string; status: AssessmentStatus; siteId: string },
  to: AssessmentStatus,
  allowedFrom: AssessmentStatus[],
  extra: Prisma.AssessmentUpdateManyMutationInput = {},
  reason?: string | null,
  auditAction?: string,
) {
  // Conditional update guards against double-submission and concurrent transitions.
  const res = await tx.assessment.updateMany({ where: { id: a.id, status: { in: allowedFrom } }, data: { status: to, ...extra } });
  if (res.count === 0) throw invalidState(`Assessment cannot move from ${a.status} to ${to}`);
  await recordTransition(tx, 'Assessment', a.id, a.status, to, req.user!.id, reason);
  await recordAudit({ req, action: auditAction ?? `ASSESSMENT_${to}`, entityType: 'Assessment', entityId: a.id, siteId: a.siteId, metadata: { from: a.status, to, reason: reason ?? null } }, tx);
}

export interface CreateAssessmentInput {
  title: string;
  siteId: string;
  departmentId: string;
  checklistVersionId: string;
  periodLabel: string;
  /** Ignored when the label is a standard period: dates are derived from the label. */
  periodStart?: Date;
  periodEnd?: Date;
  startDate: Date;
  dueDate: Date;
  ownerId: string;
  scope?: string | null;
  approvalRequired?: boolean;
  assignDefaultOwners?: boolean;
}

/**
 * Creates an assessment bound to a published checklist version and the active scoring policy.
 * The version and policy are pinned so later checklist or scoring changes never alter it (FR-007).
 */
export async function createAssessment(req: Request, input: CreateAssessmentInput) {
  const user = req.user!;
  const dept = await prisma.department.findFirst({ where: { id: input.departmentId, siteId: input.siteId, organisationId: user.organisationId } });
  if (!dept) throw badRequest('Department does not belong to the selected site');
  if (!canAccessUnit(user, { organisationId: user.organisationId, siteId: input.siteId, departmentId: input.departmentId })) {
    throw forbidden('You cannot create assessments for this site/department');
  }
  const version = await prisma.checklistVersion.findFirst({
    where: { id: input.checklistVersionId, status: 'PUBLISHED', template: { organisationId: user.organisationId } },
    include: { items: { where: { status: 'ACTIVE' }, select: { id: true, defaultOwnerId: true } } },
  });
  if (!version) throw validationError('Only a published checklist version can be used for an assessment');
  const owner = await assertUserCoversUnit({ organisationId: user.organisationId, siteId: input.siteId, departmentId: input.departmentId }, input.ownerId, 'assessment owner');
  const period = parsePeriod(input.periodLabel);
  if (!period) throw validationError(PERIOD_FORMAT_HINT, { fieldErrors: { periodLabel: [PERIOD_FORMAT_HINT] } });
  input = { ...input, periodLabel: period.label, periodStart: period.start, periodEnd: period.end };
  if (input.dueDate < input.startDate) throw validationError('Due date must be after start date');
  const policy = await prisma.scoringPolicy.findFirst({ where: { organisationId: user.organisationId, isActive: true }, orderBy: { version: 'desc' } });
  if (!policy) throw invalidState('No active scoring policy is configured');
  const workflow = await getSetting('workflow.policy', user.organisationId);

  return prisma.$transaction(async (tx) => {
    const code = await nextCode('ASM', tx);
    const a = await tx.assessment.create({
      data: {
        code,
        organisationId: user.organisationId,
        siteId: input.siteId,
        departmentId: input.departmentId,
        checklistVersionId: version.id,
        scoringPolicyId: policy.id,
        title: input.title,
        periodLabel: input.periodLabel,
        periodStart: period.start,
        periodEnd: period.end,
        startDate: input.startDate,
        dueDate: input.dueDate,
        scope: input.scope,
        approvalRequired: input.approvalRequired ?? workflow.approvalRequiredByDefault,
        ownerId: owner.id,
        createdById: user.id,
        responses: { createMany: { data: version.items.map((i) => ({ itemId: i.id })) } },
      },
    });
    if (input.assignDefaultOwners) {
      const withOwner = version.items.filter((i) => i.defaultOwnerId);
      if (withOwner.length) {
        await tx.assessmentAssignment.createMany({ data: withOwner.map((i) => ({ assessmentId: a.id, itemId: i.id, assigneeId: i.defaultOwnerId!, assignedById: user.id })) });
      }
    }
    await recordTransition(tx, 'Assessment', a.id, null, 'DRAFT', user.id);
    await recordAudit({ req, action: 'ASSESSMENT_CREATED', entityType: 'Assessment', entityId: a.id, siteId: a.siteId, metadata: { code, checklistVersionId: version.id, versionNumber: version.versionNumber, period: input.periodLabel } }, tx);
    return a;
  });
}

export async function updateAssessment(req: Request, id: string, input: Partial<Omit<CreateAssessmentInput, 'siteId' | 'departmentId' | 'checklistVersionId'>>) {
  const a = await loadAssessment(req, id);
  if (!['DRAFT', 'ASSIGNED'].includes(a.status)) throw invalidState('Assessment details can only be edited before work starts');
  if (input.ownerId) {
    await assertUserCoversUnit(a, input.ownerId, 'assessment owner');
  }
  const { assignDefaultOwners: _ignored, ...rest } = input;
  void _ignored;
  const data = { ...rest };
  if (rest.periodLabel) {
    const period = parsePeriod(rest.periodLabel);
    if (!period) throw validationError(PERIOD_FORMAT_HINT);
    Object.assign(data, { periodLabel: period.label, periodStart: period.start, periodEnd: period.end });
  } else {
    delete data.periodStart;
    delete data.periodEnd;
  }
  const updated = await prisma.assessment.update({ where: { id }, data });
  await recordAudit({ req, action: 'ASSESSMENT_UPDATED', entityType: 'Assessment', entityId: id, siteId: a.siteId, metadata: { fields: Object.keys(data) } });
  return updated;
}

/** DRAFT → ASSIGNED: releases the assessment to the department owner. */
export async function releaseAssessment(req: Request, id: string) {
  const a = await loadAssessment(req, id);
  await prisma.$transaction((tx) => transition(tx, req, a, 'ASSIGNED', ['DRAFT']));
  await notify({
    userIds: [a.ownerId],
    type: 'ASSIGNMENT_CREATED',
    title: `Assessment assigned: ${a.title}`,
    body: `${a.code} (${a.periodLabel}) has been assigned to your department. Due ${a.dueDate.toISOString().slice(0, 10)}.`,
    link: `/my-assessments/${a.id}`,
  });
  return prisma.assessment.findUniqueOrThrow({ where: { id } });
}

/**
 * Hands an open assessment to a different owner (wrong owner chosen, owner left, workload moved).
 * The new owner must work in the assessment's branch and department. Recorded with a reason; the
 * new owner is notified. Other details stay locked once work has started.
 */
export async function changeOwner(req: Request, id: string, ownerId: string, reason: string) {
  const a = await loadAssessment(req, id);
  if (!['DRAFT', ...EDITABLE_STATUSES].includes(a.status)) throw invalidState('The owner can only be changed while the assessment is open');
  if (ownerId === a.ownerId) throw badRequest('This person already owns the assessment');
  const owner = await assertUserCoversUnit(a, ownerId, 'assessment owner');
  await prisma.$transaction(async (tx) => {
    await tx.assessment.update({ where: { id }, data: { ownerId } });
    await recordAudit({ req, action: 'ASSESSMENT_OWNER_CHANGED', entityType: 'Assessment', entityId: id, siteId: a.siteId, metadata: { from: a.ownerId, to: ownerId, reason } }, tx);
  });
  await notify({ userIds: [ownerId], type: 'ASSIGNMENT_CREATED', title: `You now own ${a.code}`, body: `${a.title}. Reason: ${reason}`, link: `/my-assessments/${a.id}` });
  return { ...a, ownerId: owner.id };
}

/** Assigns or reassigns a group of questions to one owner. */
export async function assignItems(req: Request, id: string, itemIds: string[], assigneeId: string, dueDate?: Date | null) {
  const a = await loadAssessment(req, id);
  if (!['DRAFT', ...EDITABLE_STATUSES].includes(a.status)) throw invalidState('Questions can only be assigned while the assessment is open');
  await assertUserCoversUnit(a, assigneeId, 'person answering these questions');
  const valid = await prisma.checklistItem.count({ where: { id: { in: itemIds }, versionId: a.checklistVersionId } });
  if (valid !== new Set(itemIds).size) throw badRequest('Some questions do not belong to this assessment');

  await prisma.$transaction(async (tx) => {
    for (const itemId of itemIds) {
      await tx.assessmentAssignment.upsert({
        where: { assessmentId_itemId: { assessmentId: id, itemId } },
        create: { assessmentId: id, itemId, assigneeId, assignedById: req.user!.id, dueDate: dueDate ?? null },
        update: { assigneeId, assignedById: req.user!.id, dueDate: dueDate ?? null, assignedAt: new Date() },
      });
    }
    await recordAudit({ req, action: 'ASSIGNMENT_CHANGED', entityType: 'Assessment', entityId: id, siteId: a.siteId, metadata: { assigneeId, items: itemIds.length } }, tx);
  });
  await notify({
    userIds: [assigneeId],
    type: 'ASSIGNMENT_CREATED',
    title: `${itemIds.length} question(s) assigned to you`,
    body: `You have been assigned ${itemIds.length} question(s) in ${a.code} – ${a.title}.`,
    link: `/my-assessments/${a.id}`,
  });
}

export async function unassignItems(req: Request, id: string, itemIds: string[]) {
  const a = await loadAssessment(req, id);
  if (!['DRAFT', ...EDITABLE_STATUSES].includes(a.status)) throw invalidState('Assessment is not open');
  await prisma.assessmentAssignment.deleteMany({ where: { assessmentId: id, itemId: { in: itemIds } } });
  await recordAudit({ req, action: 'ASSIGNMENT_REMOVED', entityType: 'Assessment', entityId: id, siteId: a.siteId, metadata: { items: itemIds.length } });
}

/** Items with an unresolved rejection or clarification request in the current round. */
export async function openClarificationItemIds(assessmentId: string, round: number, db: Tx = prisma) {
  const reviews = await db.auditorReview.findMany({
    where: { assessmentId, round, decision: { in: ['REJECTED', 'CLARIFICATION_REQUESTED'] }, resolvedAt: null, itemId: { not: null } },
    select: { itemId: true },
  });
  return new Set(reviews.map((r) => r.itemId!));
}

export interface PendingReview {
  itemId: string;
  questionCode: string;
  question: string;
  problems: string[];
}

/**
 * What the auditor still has to decide in the current round before the review can be submitted.
 * Every answered question needs a live decision (accepted, or an open rejection / clarification
 * request), and every evidence file on it must be accepted or rejected. A clarification the
 * department has since answered (resolved) needs a fresh decision; so does newly uploaded evidence.
 */
export async function reviewCoverage(a: { id: string; checklistVersionId: string }, db: Tx = prisma) {
  const [items, responses, reviews, evidence] = await Promise.all([
    db.checklistItem.findMany({ where: { versionId: a.checklistVersionId, status: 'ACTIVE' }, select: { id: true, questionCode: true, question: true }, orderBy: { sequence: 'asc' } }),
    db.assessmentResponse.findMany({ where: { assessmentId: a.id }, select: { itemId: true, status: true, updatedAt: true } }),
    db.auditorReview.findMany({
      where: { assessmentId: a.id, itemId: { not: null }, decision: { in: ['ACCEPTED', 'REJECTED', 'CLARIFICATION_REQUESTED'] } },
      select: { itemId: true, decision: true, resolvedAt: true, evidenceId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    db.evidence.findMany({ where: { assessmentId: a.id, deletedAt: null, itemId: { not: null } }, select: { itemId: true, verificationStatus: true } }),
  ]);
  const pending: PendingReview[] = [];
  const acceptedAnswers = new Set<string>();
  let reviewable = 0;
  for (const item of items) {
    const response = responses.find((r) => r.itemId === item.id);
    const status = response?.status ?? 'NOT_ASSESSED';
    if (status === 'NOT_ASSESSED') continue;
    reviewable++;
    // The latest decision on the answer itself counts, across rounds, unless the answer changed after
    // it was made. Decisions on evidence files are separate: accepting a file does not accept the answer.
    // A rejection or clarification request (on the answer or on a file) that is still open also counts:
    // the question goes back to the department.
    const latestAnswer = reviews.find((r) => r.itemId === item.id && !r.evidenceId);
    const latest = reviews.find((r) => r.itemId === item.id);
    const accepted = !!latestAnswer && latestAnswer.decision === 'ACCEPTED' && (!response || response.updatedAt <= latestAnswer.createdAt);
    if (accepted) acceptedAnswers.add(item.id);
    const decided = accepted || (!!latest && latest.decision !== 'ACCEPTED' && !latest.resolvedAt);
    const undecidedFiles = evidence.filter((e) => e.itemId === item.id && e.verificationStatus === 'PENDING').length;
    const problems: string[] = [];
    if (!decided) problems.push(latest ? 'Answer changed or clarification answered since your last decision' : 'No decision on this answer yet');
    if (undecidedFiles) problems.push(`${undecidedFiles} evidence file(s) not accepted or rejected`);
    if (problems.length) pending.push({ itemId: item.id, questionCode: item.questionCode, question: item.question, problems });
  }
  return { reviewable, decided: reviewable - pending.length, pending, acceptedAnswers };
}

/**
 * Decides whether the current user may change the response/evidence of an item.
 * Submitted assessments are read-only for contributors; changes require reopening (AT-11).
 * During clarification only the items the auditor flagged are editable.
 */
export async function assertCanEditItem(req: Request, a: { id: string; status: AssessmentStatus; round: number; siteId: string; departmentId: string; organisationId: string; ownerId: string }, itemId: string) {
  const user = req.user!;
  if (!EDITABLE_STATUSES.includes(a.status)) {
    await recordAuditSafe({ req, action: 'RESPONSE_EDIT_BLOCKED', entityType: 'Assessment', entityId: a.id, siteId: a.siteId, outcome: 'DENIED', metadata: { itemId, status: a.status } });
    throw new AppError(409, 'ASSESSMENT_LOCKED', 'This assessment has been submitted and is read-only. It must be formally reopened before answers can change.');
  }
  if (!user.permissions.has('response:update')) throw forbidden();
  const isDeptOwner = a.ownerId === user.id || hasRole(user, 'IT_OWNER');
  if (!isDeptOwner) {
    const assignment = await prisma.assessmentAssignment.findUnique({ where: { assessmentId_itemId: { assessmentId: a.id, itemId } } });
    if (assignment?.assigneeId !== user.id) throw forbidden('This question is not assigned to you');
  }
  if (a.status === 'CLARIFICATION_REQUIRED') {
    const open = await openClarificationItemIds(a.id, a.round);
    if (!open.has(itemId)) throw new AppError(409, 'ASSESSMENT_LOCKED', 'Only questions with an open clarification request can be changed during clarification');
  }
}

export async function saveResponse(req: Request, id: string, itemId: string, input: { status: ResponseStatus; comment?: string | null; justification?: string | null }) {
  const a = await loadAssessment(req, id);
  const item = await prisma.checklistItem.findFirst({ where: { id: itemId, versionId: a.checklistVersionId } });
  if (!item) throw notFound('Question');
  await assertCanEditItem(req, a, itemId);
  if (input.status === 'NOT_APPLICABLE' && !input.justification?.trim()) {
    throw validationError('A justification is required when marking a question Not Applicable', { fieldErrors: { justification: ['Required for Not Applicable'] } });
  }
  return prisma.$transaction(async (tx) => {
    const before = await tx.assessmentResponse.findUnique({ where: { assessmentId_itemId: { assessmentId: id, itemId } } });
    const response = await tx.assessmentResponse.upsert({
      where: { assessmentId_itemId: { assessmentId: id, itemId } },
      create: { assessmentId: id, itemId, status: input.status, comment: input.comment, justification: input.justification, responderId: req.user!.id },
      update: { status: input.status, comment: input.comment, justification: input.justification, responderId: req.user!.id },
    });
    if (a.status === 'ASSIGNED') await transition(tx, req, a, 'IN_PROGRESS', ['ASSIGNED'], {}, 'First response saved');
    await recordAudit(
      { req, action: 'RESPONSE_UPDATED', entityType: 'AssessmentResponse', entityId: response.id, siteId: a.siteId, metadata: { assessmentId: id, itemId, questionCode: item.questionCode, from: before?.status ?? null, to: input.status } },
      tx,
    );
    return response;
  });
}

export interface MissingItem {
  itemId: string;
  questionCode: string;
  question: string;
  problems: string[];
}

/**
 * Submission validation (FR-012): mandatory answers, N/A justifications and
 * required evidence (clean scan, not rejected) for Compliant/Partially Compliant answers.
 */
export async function validateForSubmission(assessmentId: string, db: Tx = prisma): Promise<MissingItem[]> {
  const a = await db.assessment.findUniqueOrThrow({
    where: { id: assessmentId },
    include: {
      checklistVersion: { include: { items: { where: { status: 'ACTIVE' }, orderBy: { sequence: 'asc' } } } },
      responses: true,
      evidence: { where: { deletedAt: null }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } },
    },
  });
  const missing: MissingItem[] = [];
  for (const item of a.checklistVersion.items) {
    const r = a.responses.find((x) => x.itemId === item.id);
    const problems: string[] = [];
    if (item.responseMandatory && (!r || r.status === 'NOT_ASSESSED')) problems.push('Answer status is required');
    if (r?.status === 'NOT_APPLICABLE' && !r.justification?.trim()) problems.push('Justification required for Not Applicable');
    if (item.evidenceMandatory && r && (r.status === 'COMPLIANT' || r.status === 'PARTIALLY_COMPLIANT')) {
      const ev = a.evidence.filter((e) => e.itemId === item.id && e.verificationStatus !== 'REJECTED');
      if (!ev.length) problems.push('Evidence is required');
      else if (!ev.some((e) => e.versions[0]?.scanStatus === 'CLEAN')) problems.push('Evidence is awaiting or failed malware scanning');
    }
    if (problems.length) missing.push({ itemId: item.id, questionCode: item.questionCode, question: item.question, problems });
  }
  return missing;
}

/** IT owner submits (or re-submits after clarification). Captures an immutable snapshot of the answers. */
export async function submitAssessment(req: Request, id: string) {
  const a = await loadAssessment(req, id);
  const user = req.user!;
  if (!(a.ownerId === user.id || hasRole(user, 'IT_OWNER'))) throw forbidden('Only the department owner can submit this assessment');
  if (!['IN_PROGRESS', 'CLARIFICATION_REQUIRED'].includes(a.status)) {
    throw invalidState(a.status === 'ASSIGNED' ? 'Answer at least one question before submitting' : `Assessment is already ${a.status.replaceAll('_', ' ').toLowerCase()}`);
  }
  const missing = await validateForSubmission(id);
  if (missing.length) {
    await recordAuditSafe({ req, action: 'ASSESSMENT_SUBMISSION_BLOCKED', entityType: 'Assessment', entityId: id, siteId: a.siteId, outcome: 'FAILURE', metadata: { missing: missing.length } });
    throw validationError(`${missing.length} question(s) are incomplete`, { missing });
  }
  const isResubmission = a.status === 'CLARIFICATION_REQUIRED';
  await prisma.$transaction(async (tx) => {
    const responses = await tx.assessmentResponse.findMany({ where: { assessmentId: id }, include: { item: { select: { questionCode: true } } } });
    const evidence = await tx.evidence.findMany({ where: { assessmentId: id, deletedAt: null }, select: { id: true, itemId: true, code: true, currentVersion: true, verificationStatus: true } });
    const round = isResubmission ? a.round + 1 : a.round;
    if (isResubmission) {
      await tx.auditorReview.updateMany({ where: { assessmentId: id, round: a.round, resolvedAt: null, decision: { in: ['REJECTED', 'CLARIFICATION_REQUESTED'] } }, data: { resolvedAt: new Date() } });
    }
    await tx.assessmentSubmission.create({
      data: {
        assessmentId: id,
        round,
        submittedById: user.id,
        snapshot: {
          responses: responses.map((r) => ({ itemId: r.itemId, questionCode: r.item.questionCode, status: r.status, comment: r.comment, justification: r.justification, updatedAt: r.updatedAt.toISOString() })),
          evidence,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    await transition(tx, req, a, 'SUBMITTED_FOR_AUDIT', ['IN_PROGRESS', 'CLARIFICATION_REQUIRED'], { submittedAt: new Date(), round }, isResubmission ? 'Re-submitted after clarification' : null, 'ASSESSMENT_SUBMITTED');
  });
  await notify({
    userIds: await usersInUnit(['AUDITOR'], a),
    type: 'APPROVAL_REQUESTED',
    title: `Assessment ready for audit: ${a.code}`,
    body: `${a.title} (${a.periodLabel}) was ${isResubmission ? 're-submitted after clarification' : 'submitted'} for audit review.`,
    link: `/auditor/${a.id}`,
  });
  return prisma.assessment.findUniqueOrThrow({ where: { id } });
}

export async function startReview(req: Request, id: string) {
  const a = await loadAssessment(req, id);
  await assertSod(req.user!.id, a, 'audit');
  await prisma.$transaction((tx) => transition(tx, req, a, 'UNDER_REVIEW', ['SUBMITTED_FOR_AUDIT'], {}, null, 'AUDIT_REVIEW_STARTED'));
  return prisma.assessment.findUniqueOrThrow({ where: { id } });
}

/**
 * Auditor submits the overall review. Open clarifications send the assessment back to the
 * department; otherwise it becomes Reviewed and, when approval is configured, Pending Approval.
 */
export async function submitReview(req: Request, id: string, opinion: string) {
  const a = await loadAssessment(req, id);
  if (a.status !== 'UNDER_REVIEW') throw invalidState('Start the review before submitting it');
  await assertSod(req.user!.id, a, 'audit');
  const workflow = await getSetting('workflow.policy', a.organisationId);
  const open = await openClarificationItemIds(id, a.round);
  if (workflow.requireAuditorAcceptanceForNA) {
    // Every Not Applicable answer must carry an explicit auditor acceptance in this round (BRD §8).
    const na = await prisma.assessmentResponse.findMany({ where: { assessmentId: id, status: 'NOT_APPLICABLE' }, include: { item: { select: { questionCode: true } } } });
    // An explicit acceptance of the N/A answer itself, still valid (the answer has not changed since).
    const { acceptedAnswers } = await reviewCoverage(a);
    const pending = na.filter((r) => !open.has(r.itemId) && !acceptedAnswers.has(r.itemId));
    if (pending.length) {
      throw validationError(`${pending.length} Not Applicable answer(s) need your explicit acceptance before the review can be submitted`, { pendingNA: pending.map((r) => ({ itemId: r.itemId, questionCode: r.item.questionCode })) });
    }
  }
  // An audit review is only complete when the auditor has looked at every answer and every evidence file.
  const coverage = await reviewCoverage(a);
  if (coverage.pending.length) {
    throw validationError(`${coverage.pending.length} question(s) still need your decision before the review can be submitted`, { pendingReview: coverage.pending });
  }
  let next: AssessmentStatus;
  await prisma.$transaction(async (tx) => {
    await tx.auditorReview.create({ data: { assessmentId: id, auditorId: req.user!.id, decision: 'REVIEW_SUBMITTED', comments: opinion, round: a.round } });
    if (open.size && workflow.clarificationEnabled) {
      next = 'CLARIFICATION_REQUIRED';
      await transition(tx, req, a, next, ['UNDER_REVIEW'], {}, `${open.size} question(s) need clarification`, 'CLARIFICATION_REQUESTED');
    } else {
      await transition(tx, req, a, 'REVIEWED', ['UNDER_REVIEW'], { reviewedAt: new Date() }, opinion.slice(0, 500), 'AUDIT_REVIEW_SUBMITTED');
      next = 'REVIEWED';
      if (a.approvalRequired) {
        await transition(tx, req, { ...a, status: 'REVIEWED' }, 'PENDING_APPROVAL', ['REVIEWED'], {}, 'Approval required by workflow configuration', 'APPROVAL_REQUESTED');
        next = 'PENDING_APPROVAL';
      }
    }
  });
  if (next! === 'CLARIFICATION_REQUIRED') {
    const assignees = await prisma.assessmentAssignment.findMany({ where: { assessmentId: id, itemId: { in: [...open] } }, select: { assigneeId: true } });
    await notify({
      userIds: [a.ownerId, ...assignees.map((x) => x.assigneeId)],
      type: 'CLARIFICATION_REQUESTED',
      title: `Clarification required: ${a.code}`,
      body: `The auditor requested clarification on ${open.size} question(s) in ${a.title}.`,
      link: `/my-assessments/${a.id}`,
    });
  } else if (next! === 'PENDING_APPROVAL') {
    await notify({
      userIds: await usersInUnit(['ISMS_OWNER'], a),
      type: 'APPROVAL_REQUESTED',
      title: `Approval requested: ${a.code}`,
      body: `${a.title} has been reviewed by the auditor and awaits your approval.`,
      link: `/assessments/${a.id}`,
    });
  }
  return prisma.assessment.findUniqueOrThrow({ where: { id } });
}

/** Approver decision. Approval generates the final, versioned PDF report (FR-022, AT-09). */
export async function decideApproval(req: Request, id: string, decision: 'APPROVED' | 'REJECTED', comments?: string | null) {
  const a = await loadAssessment(req, id);
  if (a.status !== 'PENDING_APPROVAL') throw invalidState('Assessment is not awaiting approval');
  if (decision === 'REJECTED' && !comments?.trim()) throw validationError('A reason is required to reject the approval');
  await assertSod(req.user!.id, a, 'approve');
  await prisma.$transaction(async (tx) => {
    await tx.approval.create({ data: { assessmentId: id, approverId: req.user!.id, decision, comments, round: a.round } });
    if (decision === 'APPROVED') await transition(tx, req, a, 'APPROVED', ['PENDING_APPROVAL'], { approvedAt: new Date() }, comments, 'ASSESSMENT_APPROVED');
    else await transition(tx, req, a, 'UNDER_REVIEW', ['PENDING_APPROVAL'], {}, comments, 'APPROVAL_REJECTED');
  });
  let report = null;
  if (decision === 'APPROVED') {
    report = await generateFinalReport(req, id);
    await notify({
      userIds: [a.ownerId, ...(await usersInUnit(['AUDITOR', 'ISMS_OWNER', 'MANAGEMENT'], a))],
      type: 'ASSESSMENT_APPROVED',
      title: `Assessment approved: ${a.code}`,
      body: `${a.title} was approved. Final report ${report.code} is available.`,
      link: `/reports`,
    });
  }
  return { assessment: await prisma.assessment.findUniqueOrThrow({ where: { id } }), report };
}

/** When no separate approval is configured, the reviewed assessment is finalised directly. */
export async function finalise(req: Request, id: string) {
  const a = await loadAssessment(req, id);
  if (a.status !== 'REVIEWED' || a.approvalRequired) throw invalidState('Only reviewed assessments without a separate approval step can be finalised');
  await assertSod(req.user!.id, a, 'approve');
  await prisma.$transaction((tx) => transition(tx, req, a, 'APPROVED', ['REVIEWED'], { approvedAt: new Date() }, 'Finalised after audit review', 'ASSESSMENT_FINALISED'));
  const report = await generateFinalReport(req, id);
  return { assessment: await prisma.assessment.findUniqueOrThrow({ where: { id } }), report };
}

/** Privileged reopen with mandatory reason (FR-026). History, submissions and issued reports are preserved. */
export async function reopen(req: Request, id: string, reason: string) {
  const a = await loadAssessment(req, id);
  if (!REOPENABLE.includes(a.status)) throw invalidState(`A ${a.status} assessment cannot be reopened`);
  await prisma.$transaction((tx) =>
    transition(tx, req, a, 'IN_PROGRESS', REOPENABLE, { reopenCount: { increment: 1 }, round: { increment: 1 }, approvedAt: null, reviewedAt: null }, reason, 'ASSESSMENT_REOPENED'),
  );
  await notify({ userIds: [a.ownerId], type: 'ASSIGNMENT_CREATED', title: `Assessment reopened: ${a.code}`, body: `Reason: ${reason}`, link: `/my-assessments/${a.id}` });
  return prisma.assessment.findUniqueOrThrow({ where: { id } });
}

/** Server-computed action flags so the UI shows only what the backend will allow. */
export async function allowedActions(req: Request, a: { id: string; status: AssessmentStatus; ownerId: string; approvalRequired: boolean }) {
  const u = req.user!;
  const p = (k: string) => u.permissions.has(k as never);
  // Department work (answering, submitting) belongs to the department: the assessment owner, its IT
  // Department Owners and people assigned questions. System Administrators configure the system and
  // oversee assessments but do not fill them in (BRD §5), which also keeps them out of the preparers.
  const isOwner = a.ownerId === u.id || hasRole(u, 'IT_OWNER');
  const assignedToMe = !isOwner && (await prisma.assessmentAssignment.count({ where: { assessmentId: a.id, assigneeId: u.id } })) > 0;
  const participants = await assessmentParticipants(a);
  const auditBlock = sodBlockReason(u.id, participants, 'audit');
  const approveBlock = sodBlockReason(u.id, participants, 'approve');
  return {
    blocked: {
      ...(auditBlock && ['SUBMITTED_FOR_AUDIT', 'UNDER_REVIEW'].includes(a.status) && p('assessment:review') ? { review: auditBlock } : {}),
      ...(approveBlock && ['PENDING_APPROVAL', 'REVIEWED'].includes(a.status) && p('assessment:approve') ? { approve: approveBlock } : {}),
    } as Record<string, string>,
    edit: p('assessment:update') && ['DRAFT', 'ASSIGNED'].includes(a.status),
    changeOwner: p('assessment:update') && ['DRAFT', ...EDITABLE_STATUSES].includes(a.status),
    release: p('assessment:update') && a.status === 'DRAFT',
    assign: p('assessment:assign') && ['DRAFT', ...EDITABLE_STATUSES].includes(a.status),
    respond: p('response:update') && EDITABLE_STATUSES.includes(a.status) && (isOwner || assignedToMe),
    submit: p('assessment:submit') && isOwner && ['IN_PROGRESS', 'CLARIFICATION_REQUIRED'].includes(a.status),
    startReview: p('assessment:review') && a.status === 'SUBMITTED_FOR_AUDIT' && !auditBlock,
    review: p('assessment:review') && a.status === 'UNDER_REVIEW' && !auditBlock,
    approve: p('assessment:approve') && a.status === 'PENDING_APPROVAL' && !approveBlock,
    finalise: (p('assessment:approve') || p('assessment:review')) && a.status === 'REVIEWED' && !a.approvalRequired && !approveBlock,
    reopen: p('assessment:reopen') && REOPENABLE.includes(a.status),
    export: p('assessment:export'),
  };
}

export { assessmentMetrics };
