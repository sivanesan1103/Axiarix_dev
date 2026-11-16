import type { Request } from 'express';
import { assertSod } from '../../services/sod.service.js';
import { prisma } from '../../config/prisma.js';
import { recordAudit } from '../../services/audit.service.js';
import { notify } from '../../services/notification.service.js';
import { badRequest, invalidState, notFound, validationError } from '../../utils/errors.js';
import { EDITABLE_STATUSES, loadAssessment } from '../assessments/assessments.service.js';

export type ItemDecision = 'ACCEPTED' | 'REJECTED' | 'CLARIFICATION_REQUESTED' | 'COMMENT';

/**
 * Records an auditor decision on a question and/or one evidence file (FR-014).
 * Rejection and clarification require a reason; the item owner is notified (AT-06).
 * Accepting or rejecting evidence updates its verification status, which drives
 * the verified-evidence coverage metric.
 */
export async function reviewItem(
  req: Request,
  assessmentId: string,
  itemId: string,
  input: { decision: ItemDecision; evidenceId?: string | null; reason?: string | null; comments?: string | null },
) {
  const a = await loadAssessment(req, assessmentId);
  if (a.status !== 'UNDER_REVIEW') throw invalidState('Item decisions can only be recorded while the assessment is under review');
  await assertSod(req.user!.id, a, 'audit');
  const item = await prisma.checklistItem.findFirst({ where: { id: itemId, versionId: a.checklistVersionId } });
  if (!item) throw notFound('Question');
  if ((input.decision === 'REJECTED' || input.decision === 'CLARIFICATION_REQUESTED') && !input.reason?.trim()) {
    throw validationError('A reason is required for rejection or clarification requests', { fieldErrors: { reason: ['Required'] } });
  }
  if (input.decision === 'COMMENT' && !input.comments?.trim()) throw validationError('Comment text is required');
  let evidence = null;
  if (input.evidenceId) {
    evidence = await prisma.evidence.findFirst({ where: { id: input.evidenceId, assessmentId, itemId, deletedAt: null }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
    if (!evidence) throw notFound('Evidence for this question');
    if (input.decision === 'ACCEPTED' && evidence.versions[0]?.scanStatus !== 'CLEAN') throw badRequest('Evidence that has not passed malware scanning cannot be accepted');
  }

  const review = await prisma.$transaction(async (tx) => {
    const r = await tx.auditorReview.create({
      data: { assessmentId, itemId, evidenceId: input.evidenceId ?? null, auditorId: req.user!.id, decision: input.decision, reason: input.reason, comments: input.comments, round: a.round },
    });
    if (evidence && input.decision !== 'COMMENT') {
      await tx.evidence.update({
        where: { id: evidence.id },
        data: {
          verificationStatus: input.decision,
          verificationNote: input.reason ?? input.comments ?? null,
          verifiedById: req.user!.id,
          verifiedAt: new Date(),
        },
      });
    }
    await recordAudit(
      {
        req,
        action: evidence ? `EVIDENCE_${input.decision}` : `REVIEW_${input.decision}`,
        entityType: evidence ? 'Evidence' : 'ChecklistItem',
        entityId: evidence?.id ?? itemId,
        siteId: a.siteId,
        metadata: { assessmentId, itemId, questionCode: item.questionCode, reason: input.reason ?? null },
      },
      tx,
    );
    return r;
  });

  if (input.decision === 'REJECTED' || input.decision === 'CLARIFICATION_REQUESTED') {
    const assignment = await prisma.assessmentAssignment.findUnique({ where: { assessmentId_itemId: { assessmentId, itemId } } });
    await notify({
      userIds: [a.ownerId, assignment?.assigneeId ?? '', evidence?.uploaderId ?? ''],
      type: input.decision === 'REJECTED' ? 'EVIDENCE_REJECTED' : 'CLARIFICATION_REQUESTED',
      title: input.decision === 'REJECTED' ? `Evidence rejected – ${item.questionCode}` : `Clarification requested – ${item.questionCode}`,
      body: `${a.code}: ${input.reason}`,
      link: `/my-assessments/${a.id}?item=${itemId}`,
    });
  }
  return review;
}

/** Clarification thread shared by the auditor and the department (assessment- or item-level). */
export async function addComment(req: Request, assessmentId: string, itemId: string | null, body: string) {
  const a = await loadAssessment(req, assessmentId);
  if (itemId) {
    const item = await prisma.checklistItem.findFirst({ where: { id: itemId, versionId: a.checklistVersionId } });
    if (!item) throw notFound('Question');
  }
  const canComment = req.user!.permissions.has('response:update') || req.user!.permissions.has('assessment:review');
  if (!canComment) throw badRequest('Your role cannot comment on assessments');
  const comment = await prisma.reviewComment.create({
    data: { assessmentId, itemId, authorId: req.user!.id, body },
    include: { author: { select: { id: true, name: true } } },
  });
  await recordAudit({ req, action: 'COMMENT_ADDED', entityType: 'Assessment', entityId: assessmentId, siteId: a.siteId, metadata: { itemId } });
  // Department replies during clarification notify the auditors who requested it.
  if (EDITABLE_STATUSES.includes(a.status) && itemId) {
    const auditors = await prisma.auditorReview.findMany({ where: { assessmentId, itemId, round: a.round }, select: { auditorId: true } });
    if (auditors.length) {
      await notify({
        userIds: auditors.map((x) => x.auditorId).filter((id) => id !== req.user!.id),
        type: 'CLARIFICATION_REQUESTED',
        title: `Clarification response – ${a.code}`,
        body: body.slice(0, 200),
        link: `/auditor/${a.id}?item=${itemId}`,
      });
    }
  }
  return comment;
}
