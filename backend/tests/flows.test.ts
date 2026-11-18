import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/modules/auth/auth.service.js';
import { ensureOrgRoles } from '../src/services/org-provisioning.service.js';
import { setSetting, settingDefaults } from '../src/services/settings.service.js';
import { totpCode } from '../src/utils/crypto.js';
import { login, PASSWORD, pdfBuffer, resetDatabase } from './helpers.js';

/**
 * Workflow branches outside the main happy path: approval rejection, finalising without approval,
 * returned closure evidence, checklist return-to-draft, unassigning, retention with two-person
 * deletion (kept inside one organisation), schedules, and enforced MFA for privileged roles.
 */
type Client = Awaited<ReturnType<typeof login>>;
let base: Awaited<ReturnType<typeof resetDatabase>>;
let admin: Client, isms: Client, itOwner: Client, contributor: Client, auditor: Client;
let versionId = '';
let templateId = '';
let itemId = '';
const state: Record<string, string> = {};

beforeAll(async () => {
  base = await resetDatabase();
  [admin, isms, itOwner, contributor, auditor] = await Promise.all(
    ['admin', 'isms', 'itowner', 'contributor', 'auditor'].map((n) => login(`${n}@axiarix.local`)),
  );
  const t = await prisma.checklistTemplate.create({ data: { organisationId: base.ctx.org.id, title: 'Flow check list' } });
  const v = await prisma.checklistVersion.create({ data: { templateId: t.id, versionNumber: 1 } });
  const item = await prisma.checklistItem.create({ data: { versionId: v.id, questionCode: 'FL-001', sequence: 1, question: 'Backups are restored and tested every quarter', evidenceMandatory: false } });
  await prisma.checklistVersion.update({ where: { id: v.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
  versionId = v.id;
  templateId = t.id;
  itemId = item.id;
});

/** Creates, releases, answers and submits an assessment, then starts the review and accepts the answer. */
async function assessmentUnderReview(title: string, approvalRequired = true) {
  const a = await isms.post('/api/v1/assessments', {
    title, siteId: base.ctx.primary.id, departmentId: base.ctx.primaryDept.id, checklistVersionId: versionId, approvalRequired, assignDefaultOwners: false,
    periodLabel: 'Q4 FY2026-27', startDate: '2027-01-02', dueDate: '2027-03-15', ownerId: base.users['itowner@axiarix.local'],
  });
  expect(a.status).toBe(201);
  const id = a.body.data.id as string;
  expect((await isms.post(`/api/v1/assessments/${id}/release`)).status).toBe(200);
  expect((await itOwner.put(`/api/v1/assessments/${id}/responses/${itemId}`, { status: 'COMPLIANT', comment: 'Restore test done in December' })).status).toBe(200);
  expect((await itOwner.post(`/api/v1/assessments/${id}/submit`)).status).toBe(200);
  expect((await auditor.post(`/api/v1/assessments/${id}/start-review`)).status).toBe(200);
  expect((await auditor.post(`/api/v1/assessments/${id}/items/${itemId}/review`, { decision: 'ACCEPTED' })).status).toBe(201);
  return id;
}

describe.sequential('workflow branches', () => {
  it('approval can be rejected with a reason; the auditor re-submits and the ISMS owner then approves', async () => {
    const id = await assessmentUnderReview('Approval rejection check');
    expect((await auditor.post(`/api/v1/assessments/${id}/review/submit`, { opinion: 'Backup restore control operating effectively.' })).body.data.status).toBe('PENDING_APPROVAL');
    expect((await isms.post(`/api/v1/assessments/${id}/approval`, { decision: 'REJECTED' })).status).toBe(422);
    const rej = await isms.post(`/api/v1/assessments/${id}/approval`, { decision: 'REJECTED', comments: 'Opinion must mention the restore sample size' });
    expect(rej.status).toBe(200);
    expect((await prisma.assessment.findUniqueOrThrow({ where: { id } })).status).toBe('UNDER_REVIEW');
    // Earlier decisions still count, so the auditor can re-submit straight away.
    expect((await auditor.post(`/api/v1/assessments/${id}/review/submit`, { opinion: 'Restore of 5 sampled servers succeeded; control effective.' })).body.data.status).toBe('PENDING_APPROVAL');
    expect((await isms.post(`/api/v1/assessments/${id}/approval`, { decision: 'APPROVED' })).status).toBe(200);
    expect(await prisma.report.count({ where: { assessmentId: id } })).toBe(1);
  });

  it('without a separate approval step the review is finalised into a report', async () => {
    const id = await assessmentUnderReview('Finalise check', false);
    expect((await auditor.post(`/api/v1/assessments/${id}/review/submit`, { opinion: 'Backup restore control operating effectively.' })).body.data.status).toBe('REVIEWED');
    expect((await prisma.report.count({ where: { assessmentId: id } }))).toBe(0);
    expect((await isms.post(`/api/v1/assessments/${id}/finalise`)).status).toBe(200);
    expect((await prisma.assessment.findUniqueOrThrow({ where: { id } })).status).toBe('APPROVED');
    expect(await prisma.report.count({ where: { assessmentId: id } })).toBe(1);
  });

  it('closure evidence can be returned with a comment; the owner fixes it and it is verified', async () => {
    const id = await assessmentUnderReview('Returned action check');
    const f = await auditor.post('/api/v1/findings', {
      assessmentId: id, itemId, category: 'OBSERVATION', severity: 'LOW', title: 'Restore log unsigned', description: 'The restore log has no reviewer signature.',
      ownerId: base.users['itowner@axiarix.local'], dueDate: '2027-03-31',
    });
    expect(f.status).toBe(201);
    const ca = await itOwner.post(`/api/v1/findings/${f.body.data.id}/actions`, { correctiveAction: 'Add a reviewer signature to the restore log', ownerId: base.users['contributor@axiarix.local'], targetDate: '2027-03-20' });
    expect(ca.status).toBe(201);
    state.actionId = ca.body.data.id;
    expect((await contributor.upload('/api/v1/evidence', pdfBuffer('restore-log'), 'restore-log.pdf', { correctiveActionId: state.actionId })).status).toBe(201);
    expect((await contributor.post(`/api/v1/corrective-actions/${state.actionId}/submit`, { closureNotes: 'Signed restore log attached' })).status).toBe(200);
    // Returning needs a comment.
    expect((await auditor.post(`/api/v1/corrective-actions/${state.actionId}/verify`, { decision: 'RETURNED' })).status).toBe(422);
    expect((await auditor.post(`/api/v1/corrective-actions/${state.actionId}/verify`, { decision: 'RETURNED', comment: 'Signature missing on page 2' })).status).toBe(200);
    expect((await prisma.correctiveAction.findUniqueOrThrow({ where: { id: state.actionId } })).status).toBe('RETURNED');
    expect((await prisma.finding.findUniqueOrThrow({ where: { id: f.body.data.id } })).status).toBe('ACTION_IN_PROGRESS');
    expect(await prisma.notification.count({ where: { userId: base.users['contributor@axiarix.local'], type: 'EVIDENCE_REJECTED' } })).toBeGreaterThan(0);
    // The owner uploads a corrected file and submits again; this time it is verified.
    expect((await contributor.upload('/api/v1/evidence', pdfBuffer('restore-log-v2'), 'restore-log-signed.pdf', { correctiveActionId: state.actionId })).status).toBe(201);
    expect((await contributor.post(`/api/v1/corrective-actions/${state.actionId}/submit`, { closureNotes: 'Both pages signed' })).status).toBe(200);
    expect((await auditor.post(`/api/v1/corrective-actions/${state.actionId}/verify`, { decision: 'VERIFIED' })).status).toBe(200);
    // Finish the assessment so its evidence falls under the retention policy in the next test.
    expect((await auditor.post(`/api/v1/assessments/${id}/review/submit`, { opinion: 'Control effective; one observation raised and closed.' })).body.data.status).toBe('PENDING_APPROVAL');
    expect((await isms.post(`/api/v1/assessments/${id}/approval`, { decision: 'APPROVED' })).status).toBe(200);
  });

  it('a checklist reviewer can return a version to draft with a reason; the author then edits it', async () => {
    const t = await isms.post('/api/v1/checklists', { title: 'Return to draft check' });
    const v = (await isms.get(`/api/v1/checklists/${t.body.data.id}`)).body.data.versions[0].id as string;
    const item = await isms.post(`/api/v1/checklists/versions/${v}/items`, { question: 'Encryption keys are rotated yearly', mappings: [{ type: 'ANNEX_A', reference: '8.24' }] });
    expect((await isms.post(`/api/v1/checklists/versions/${v}/submit-review`, { reviewerId: base.users['admin@axiarix.local'] })).status).toBe(200);
    // Locked while under review.
    expect((await isms.patch(`/api/v1/checklists/items/${item.body.data.id}`, { question: 'Changed while in review' })).status).toBe(409);
    expect((await admin.post(`/api/v1/checklists/versions/${v}/return-to-draft`, { reason: 'Add the rotation evidence expected' })).status).toBe(200);
    expect((await prisma.checklistVersion.findUniqueOrThrow({ where: { id: v } })).status).toBe('DRAFT');
    expect((await isms.patch(`/api/v1/checklists/items/${item.body.data.id}`, { evidenceExpected: 'Key rotation log' })).status).toBe(200);
  });

  it('questions can be assigned and then unassigned', async () => {
    const a = await isms.post('/api/v1/assessments', {
      title: 'Unassign check', siteId: base.ctx.primary.id, departmentId: base.ctx.primaryDept.id, checklistVersionId: versionId, assignDefaultOwners: false,
      periodLabel: 'Q4 FY2026-27', startDate: '2027-01-02', dueDate: '2027-03-15', ownerId: base.users['itowner@axiarix.local'],
    });
    const id = a.body.data.id as string;
    await isms.post(`/api/v1/assessments/${id}/release`);
    expect((await itOwner.post(`/api/v1/assessments/${id}/assign`, { itemIds: [itemId], assigneeId: base.users['contributor@axiarix.local'] })).status).toBe(200);
    expect(await prisma.assessmentAssignment.count({ where: { assessmentId: id } })).toBe(1);
    expect((await itOwner.post(`/api/v1/assessments/${id}/unassign`, { itemIds: [itemId] })).status).toBe(200);
    expect(await prisma.assessmentAssignment.count({ where: { assessmentId: id } })).toBe(0);
  });

  it('retention raises deletion requests that a second person approves, and other organisations cannot see or decide them', async () => {
    expect((await admin.put('/api/v1/admin/retention-policies/EVIDENCE', { retentionDays: 30, action: 'REQUEST_DELETION', isActive: true })).status).toBe(200);
    await prisma.evidence.updateMany({ where: { correctiveActionId: state.actionId }, data: { createdAt: new Date(Date.now() - 40 * 86_400_000) } });
    const run = await admin.post('/api/v1/admin/retention/run');
    expect(run.status).toBe(200);
    expect(run.body.data.deletionRequests).toBeGreaterThan(0);
    const list = (await admin.get('/api/v1/admin/deletion-requests')).body.data as { id: string }[];
    expect(list.length).toBe(run.body.data.deletionRequests);
    const requestId = list[0].id;
    expect((await prisma.deletionRequest.findUniqueOrThrow({ where: { id: requestId } })).organisationId).toBe(base.ctx.org.id);
    // The person who raised the requests cannot approve them.
    expect((await admin.post(`/api/v1/admin/deletion-requests/${requestId}/decision`, { decision: 'APPROVED' })).status).toBe(403);

    // An administrator of another organisation sees none of them and cannot decide them.
    const other = await prisma.organisation.create({ data: { name: 'Other Hospital (test)' } });
    await ensureOrgRoles(prisma, other.id);
    const role = await prisma.role.findFirstOrThrow({ where: { organisationId: other.id, key: 'SYSTEM_ADMIN' } });
    const u = await prisma.user.create({ data: { email: 'admin@other-hospital.test', name: 'Other Admin', organisationId: other.id, passwordHash: await hashPassword(PASSWORD), status: 'ACTIVE' } });
    await prisma.userRole.create({ data: { userId: u.id, roleId: role.id, organisationId: other.id } });
    const otherAdmin = await login('admin@other-hospital.test');
    expect((await otherAdmin.get('/api/v1/admin/deletion-requests')).body.data).toEqual([]);
    expect((await otherAdmin.post(`/api/v1/admin/deletion-requests/${requestId}/decision`, { decision: 'APPROVED' })).status).toBe(404);

    expect((await isms.post(`/api/v1/admin/deletion-requests/${requestId}/decision`, { decision: 'APPROVED' })).status).toBe(200);
    expect((await admin.post(`/api/v1/admin/deletion-requests/${requestId}/execute`)).status).toBe(200);
    expect((await prisma.deletionRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('EXECUTED');
  });

  it('an assessment schedule creates the next assessment and moves its next run date', async () => {
    const s = await isms.post('/api/v1/admin/schedules', {
      siteId: base.ctx.primary.id, departmentId: base.ctx.primaryDept.id, checklistTemplateId: templateId, frequency: 'QUARTERLY', nextRunDate: '2027-04-01', durationDays: 60,
    });
    expect(s.status).toBe(201);
    const run = await isms.post(`/api/v1/admin/schedules/${s.body.data.id}/run`);
    expect(run.status).toBe(201);
    const created = await prisma.assessment.findUniqueOrThrow({ where: { id: run.body.data.id } });
    expect(created.checklistVersionId).toBe(versionId);
    expect((await prisma.assessmentSchedule.findUniqueOrThrow({ where: { id: s.body.data.id } })).nextRunDate.toISOString().slice(0, 10)).toBe('2027-07-01');
  });
});

describe.sequential('enforced MFA for privileged roles (NFR-SEC-04)', () => {
  it('an administrator without MFA cannot switch enforcement on (it would lock them out)', async () => {
    const res = await admin.put('/api/v1/admin/settings/security.policy', { ...settingDefaults['security.policy'], enforceMfaForPrivileged: true });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/your own account first/);
  });

  it('blocks privileged accounts until they enrol, then lets them in; others are unaffected', async () => {
    await setSetting('security.policy', { ...settingDefaults['security.policy'], enforceMfaForPrivileged: true }, base.users['admin@axiarix.local'], base.ctx.org.id);
    try {
      const aud = await login('auditor@axiarix.local');
      const blocked = await aud.get('/api/v1/assessments');
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('MFA_ENROLMENT_REQUIRED');
      expect((await aud.get('/api/v1/auth/me')).body.data.mfaEnrolmentRequired).toBe(true);
      const setup = await aud.post('/api/v1/auth/mfa/setup');
      expect(setup.status).toBe(200);
      expect((await aud.post('/api/v1/auth/mfa/enable', { code: totpCode(setup.body.data.secret) })).status).toBe(200);
      expect((await aud.get('/api/v1/assessments')).status).toBe(200);
      expect((await aud.get('/api/v1/auth/me')).body.data.mfaEnrolmentRequired).toBe(false);
      // While the policy is on, a privileged user cannot switch MFA off.
      expect((await aud.post('/api/v1/auth/mfa/disable', { password: PASSWORD, code: totpCode(setup.body.data.secret) })).status).toBe(403);
      // A contributor is not a privileged role and keeps working without MFA.
      expect((await (await login('contributor@axiarix.local')).get('/api/v1/assessments')).status).toBe(200);
    } finally {
      await setSetting('security.policy', settingDefaults['security.policy'], base.users['admin@axiarix.local'], base.ctx.org.id);
    }
  });
});
