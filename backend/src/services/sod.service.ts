import { prisma, type Tx } from '../config/prisma.js';
import { AppError } from '../utils/errors.js';

/**
 * Separation of duties (ISO/IEC 27001:2022 A.5.3), enforced as a hard block.
 *
 *  - Whoever prepared an assessment (owner, anyone who answered, anyone who submitted) cannot audit it.
 *  - Whoever prepared or audited an assessment cannot approve or finalise it.
 *  - Whoever owns or submitted a corrective action cannot verify it.
 *  - Whoever created or submitted a checklist version cannot publish it.
 */
export const SOD_CODE = 'SEGREGATION_OF_DUTIES';

export function sodError(message: string) {
  return new AppError(403, SOD_CODE, message);
}

export interface AssessmentParticipants {
  ownerId: string;
  preparers: Set<string>;
  auditors: Set<string>;
}

export async function assessmentParticipants(a: { id: string; ownerId: string }, db: Tx = prisma): Promise<AssessmentParticipants> {
  const [responders, submitters, reviewers] = await Promise.all([
    db.assessmentResponse.findMany({ where: { assessmentId: a.id, responderId: { not: null } }, select: { responderId: true }, distinct: ['responderId'] }),
    db.assessmentSubmission.findMany({ where: { assessmentId: a.id }, select: { submittedById: true }, distinct: ['submittedById'] }),
    db.auditorReview.findMany({ where: { assessmentId: a.id }, select: { auditorId: true }, distinct: ['auditorId'] }),
  ]);
  const preparers = new Set<string>([a.ownerId, ...responders.map((r) => r.responderId!), ...submitters.map((s) => s.submittedById)]);
  return { ownerId: a.ownerId, preparers, auditors: new Set(reviewers.map((r) => r.auditorId)) };
}

/** Reason the user may not act at this stage, or null when allowed. */
export function sodBlockReason(userId: string, p: AssessmentParticipants, stage: 'audit' | 'approve'): string | null {
  if (p.preparers.has(userId)) {
    return stage === 'audit'
      ? 'You prepared this assessment (owner, answered questions or submitted it), so another auditor must review it.'
      : 'You prepared this assessment, so someone else must approve it.';
  }
  if (stage === 'approve' && p.auditors.has(userId)) return 'You audited this assessment, so someone else must approve it.';
  return null;
}

export async function assertSod(userId: string, a: { id: string; ownerId: string }, stage: 'audit' | 'approve', db: Tx = prisma) {
  const reason = sodBlockReason(userId, await assessmentParticipants(a, db), stage);
  if (reason) throw sodError(reason);
}
