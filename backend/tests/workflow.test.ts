/**
 * End-to-end API workflow covering the SRS acceptance scenarios AT-01 … AT-12:
 * Administrator → Checklist → IT Assessment → Evidence → Auditor Review → Finding →
 * Corrective Action → Approval → Final PDF report.
 */
import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { login, pdfBuffer, resetDatabase } from './helpers.js';

type Session = Awaited<ReturnType<typeof login>>;
let admin: Session, isms: Session, itOwner: Session, contributor: Session, auditor: Session, mgmt: Session, otherBranch: Session;
let base: Awaited<ReturnType<typeof resetDatabase>>;

const state: Record<string, string> = {};

beforeAll(async () => {
  base = await resetDatabase();
  [admin, isms, itOwner, contributor, auditor, mgmt, otherBranch] = await Promise.all([
    login('admin@axiarix.local'),
    login('isms@axiarix.local'),
    login('itowner@axiarix.local'),
    login('contributor@axiarix.local'),
    login('auditor@axiarix.local'),
    login('management@axiarix.local'),
    login('itowner.alwarpet@axiarix.local'),
  ]);
});

describe.sequential('ISO 27001 assessment workflow', () => {
  it('AT-01: administrator creates a site, IT department and scoped users', async () => {
    const site = await admin.post('/api/v1/organisations/sites', { name: 'Test Branch', code: 'TST' });
    expect(site.status).toBe(201);
    const dept = await admin.post('/api/v1/organisations/departments', { siteId: site.body.data.id, name: 'IT & IT Data Centre' });
    expect(dept.status).toBe(201);
    const user = await admin.post('/api/v1/users', {
      name: 'Scoped Contributor',
      email: 'scoped@axiarix.local',
      password: 'Scoped-User-Pass-2026',
      sendInvite: false,
      roles: [{ roleKey: 'CONTRIBUTOR', siteId: site.body.data.id, departmentId: dept.body.data.id }],
    });
    expect(user.status).toBe(201);
    expect(user.body.data.roles[0].site.name).toBe('Test Branch');
    // Duplicate site codes are rejected by the unique constraint.
    expect((await admin.post('/api/v1/organisations/sites', { name: 'Dup', code: 'TST' })).status).toBe(409);
    expect(await prisma.auditEvent.count({ where: { action: { in: ['SITE_CREATED', 'DEPARTMENT_CREATED', 'USER_CREATED'] } } })).toBe(3);
  });

  it('imports both worksheets of the Kauvery workbook with original content preserved', async () => {
    const buf = fs.readFileSync('source-data/kauvery-vadapalani-it-ia-checklist.xlsx');
    const up = await isms.upload('/api/v1/imports', buf, 'kauvery.xlsx');
    expect(up.status).toBe(201);
    expect(up.body.data.sheetSummary).toHaveLength(2);
    const rows = await isms.get(`/api/v1/imports/${up.body.data.id}/rows?sheetName=${encodeURIComponent('Internal Audit -Checklist (2)')}&filter=review&pageSize=100`);
    expect(rows.body.meta.total).toBe(29);
    const confirm = await isms.post(`/api/v1/imports/${up.body.data.id}/confirm`, {
      sheets: [
        { sheetName: 'Last Year - IA -Checklist', templateTitle: 'Last year IA' },
        { sheetName: 'Internal Audit -Checklist (2)', templateTitle: 'Current IA' },
      ],
    });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.map((c: { items: number }) => c.items)).toEqual([75, 75]);
    const item = await prisma.checklistItem.findFirst({ where: { versionId: confirm.body.data[1].versionId, sequence: 1 }, include: { sourceRow: true } });
    expect(item?.sourceRow?.rowNumber).toBe(7);
    expect((item?.sourceRow?.rawData as Record<string, string>)['Remarks observed on 05112026']).toMatch(/centralised AV report/);
    // Re-uploading the same file is detected as a duplicate and needs explicit confirmation.
    const again = await isms.upload('/api/v1/imports', buf, 'kauvery.xlsx');
    expect(again.body.data.errorSummary.duplicateFile).toBeTruthy();
    const blocked = await isms.post(`/api/v1/imports/${again.body.data.id}/confirm`, { sheets: [{ sheetName: 'Last Year - IA -Checklist', templateTitle: 'Dup' }] });
    expect(blocked.status).toBe(422);
  });

  it('AT-02: publishes checklist version 1 and creates an assessment bound to it', async () => {
    const t = await isms.post('/api/v1/checklists', { title: 'Pilot IT checklist' });
    expect(t.status).toBe(201);
    const detail = await isms.get(`/api/v1/checklists/${t.body.data.id}`);
    const versionId = detail.body.data.versions[0].id;
    state.templateId = t.body.data.id;
    state.versionId = versionId;
    const q = (question: string, mappings: object[], evidenceMandatory = true) => isms.post(`/api/v1/checklists/versions/${versionId}/items`, { question, mappings, evidenceMandatory });
    const i1 = await q('Threat intelligence reports reviewed', [{ type: 'ANNEX_A', reference: '5.7' }, { type: 'ISO_CLAUSE', reference: '9.1' }]);
    const i2 = await q('Backup restoration tested', [{ type: 'ANNEX_A', reference: '8.13' }]);
    const i3 = await q('Software licence register maintained', [{ type: 'ANNEX_A', reference: '5.32' }], false);
    expect([i1.status, i2.status, i3.status]).toEqual([201, 201, 201]);
    state.item1 = i1.body.data.id;
    state.item2 = i2.body.data.id;
    state.item3 = i3.body.data.id;
    // Invalid ISO references are rejected.
    expect((await q('Bad', [{ type: 'ANNEX_A', reference: '9.9' }])).status).toBe(422);

    // Four-eyes: the author submits with a named reviewer; only that reviewer publishes.
    expect((await isms.post(`/api/v1/checklists/versions/${versionId}/submit-review`, { reviewerId: base.users['admin@axiarix.local'] })).status).toBe(200);
    expect((await isms.post(`/api/v1/checklists/versions/${versionId}/publish`)).status).toBe(403);
    expect((await admin.post(`/api/v1/checklists/versions/${versionId}/publish`)).status).toBe(200);

    // Published versions are immutable (service layer and DB trigger).
    expect((await isms.patch(`/api/v1/checklists/items/${state.item1}`, { question: 'changed' })).status).toBe(409);
    await expect(prisma.checklistItem.update({ where: { id: state.item1 }, data: { question: 'tamper' } })).rejects.toThrow(/cannot be modified/);

    const a = await isms.post('/api/v1/assessments', {
      title: 'Q3 pilot assessment',
      siteId: base.ctx.primary.id,
      departmentId: base.ctx.primaryDept.id,
      checklistVersionId: versionId,
      periodLabel: 'Q3 FY2026-27',
      periodStart: '2026-10-01',
      periodEnd: '2026-12-31',
      startDate: '2026-11-01',
      dueDate: '2026-12-15',
      ownerId: base.users['itowner@axiarix.local'],
      approvalRequired: true,
    });
    expect(a.status).toBe(201);
    expect(a.body.data.checklistVersionId).toBe(versionId);
    expect(a.body.data.periodLabel).toBe('Q3 FY2026-27');
    state.assessmentId = a.body.data.id;
    expect((await isms.post(`/api/v1/assessments/${state.assessmentId}/release`)).body.data.status).toBe('ASSIGNED');
  });

  it('AT-03: IT users answer questions and upload evidence with metadata', async () => {
    const id = state.assessmentId;
    expect((await itOwner.post(`/api/v1/assessments/${id}/assign`, { itemIds: [state.item1, state.item2], assigneeId: base.users['contributor@axiarix.local'] })).status).toBe(200);
    // Contributors may only answer questions assigned to them.
    expect((await contributor.put(`/api/v1/assessments/${id}/responses/${state.item3}`, { status: 'COMPLIANT' })).status).toBe(403);
    const r1 = await contributor.put(`/api/v1/assessments/${id}/responses/${state.item1}`, { status: 'COMPLIANT', comment: 'Weekly Zscaler/AV reports reviewed' });
    expect(r1.status).toBe(200);
    expect((await isms.get(`/api/v1/assessments/${id}`)).body.data.status).toBe('IN_PROGRESS');

    const up = await contributor.upload('/api/v1/evidence', pdfBuffer('threat-intel'), 'threat-intel.pdf', { assessmentId: id, itemId: state.item1, classification: 'CONFIDENTIAL' });
    expect(up.status).toBe(201);
    const v = up.body.data.versions[0];
    expect(v.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(v.scanStatus).toBe('CLEAN');
    expect(v.mimeType).toBe('application/pdf');
    state.evidence1 = up.body.data.id;
    const visible = await auditor.get(`/api/v1/evidence/${state.evidence1}`);
    expect(visible.status).toBe(200);
    expect(visible.body.data.uploader.name).toBe('Divya Sundar');
  });

  it('rejects malware, executables and disguised files at upload', async () => {
    const id = state.assessmentId;
    const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
    const csv = await contributor.upload('/api/v1/evidence', eicar, 'eicar.csv', { assessmentId: id, itemId: state.item1 });
    expect(csv.status).toBe(422);
    expect(csv.body.error.code).toBe('MALWARE_DETECTED');
    expect((await contributor.upload('/api/v1/evidence', Buffer.from('MZ...'), 'tool.exe', { assessmentId: id, itemId: state.item1 })).status).toBe(422);
    expect((await contributor.upload('/api/v1/evidence', Buffer.from('<html>'), 'fake.pdf', { assessmentId: id, itemId: state.item1 })).status).toBe(422);
    expect(await prisma.auditEvent.count({ where: { action: 'EVIDENCE_MALWARE_BLOCKED' } })).toBe(1);
  });

  it('AT-04: submission with missing mandatory answers is blocked and the gaps are listed', async () => {
    const res = await itOwner.post(`/api/v1/assessments/${state.assessmentId}/submit`);
    expect(res.status).toBe(422);
    const missing = res.body.error.details.missing as { itemId: string; problems: string[] }[];
    expect(missing.map((m) => m.itemId).sort()).toEqual([state.item2, state.item3].sort());
    // Not Applicable requires a justification.
    expect((await itOwner.put(`/api/v1/assessments/${state.assessmentId}/responses/${state.item3}`, { status: 'NOT_APPLICABLE' })).status).toBe(422);
  });

  it('AT-05: IT owner submits a complete assessment; it becomes protected from ordinary editing', async () => {
    const id = state.assessmentId;
    await contributor.put(`/api/v1/assessments/${id}/responses/${state.item2}`, { status: 'PARTIALLY_COMPLIANT', comment: 'Restore drill done for DB only' });
    await contributor.upload('/api/v1/evidence', pdfBuffer('backup'), 'backup-restore.pdf', { assessmentId: id, itemId: state.item2 });
    await itOwner.put(`/api/v1/assessments/${id}/responses/${state.item3}`, { status: 'NOT_APPLICABLE', justification: 'Licences managed at group level per SoA v3' });
    const res = await itOwner.post(`/api/v1/assessments/${id}/submit`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SUBMITTED_FOR_AUDIT');
    // Repeated clicks do not double-submit.
    expect((await itOwner.post(`/api/v1/assessments/${id}/submit`)).status).toBe(409);
    expect(await prisma.assessmentSubmission.count({ where: { assessmentId: id } })).toBe(1);
  });

  it('AT-11: answers cannot change after submission without a formal reopen; history is retained', async () => {
    const id = state.assessmentId;
    const blocked = await contributor.put(`/api/v1/assessments/${id}/responses/${state.item1}`, { status: 'NON_COMPLIANT' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('ASSESSMENT_LOCKED');
    expect(await prisma.auditEvent.count({ where: { action: 'RESPONSE_EDIT_BLOCKED', entityId: id } })).toBe(1);
    // Contributors cannot reopen; reopening requires permission and a reason.
    expect((await contributor.post(`/api/v1/assessments/${id}/reopen`, { reason: 'I want to change it' })).status).toBe(403);
    expect((await isms.post(`/api/v1/assessments/${id}/reopen`, {})).status).toBe(422);
    const reopened = await isms.post(`/api/v1/assessments/${id}/reopen`, { reason: 'Contributor reported an incorrect status on Q1' });
    expect(reopened.body.data.status).toBe('IN_PROGRESS');
    expect(reopened.body.data.reopenCount).toBe(1);
    expect((await itOwner.post(`/api/v1/assessments/${id}/submit`)).status).toBe(200);
    expect(await prisma.assessmentSubmission.count({ where: { assessmentId: id } })).toBe(2);
    const history = await isms.get(`/api/v1/assessments/${id}/history`);
    expect(history.body.data.some((h: { toStatus: string; reason: string }) => h.toStatus === 'IN_PROGRESS' && /incorrect status/.test(h.reason))).toBe(true);
  });

  it('AT-06: auditor rejects evidence and requests clarification; the owner is notified', async () => {
    const id = state.assessmentId;
    expect((await auditor.post(`/api/v1/assessments/${id}/start-review`)).body.data.status).toBe('UNDER_REVIEW');
    // A reason is mandatory.
    expect((await auditor.post(`/api/v1/assessments/${id}/items/${state.item1}/review`, { decision: 'REJECTED', evidenceId: state.evidence1 })).status).toBe(422);
    const rej = await auditor.post(`/api/v1/assessments/${id}/items/${state.item1}/review`, { decision: 'REJECTED', evidenceId: state.evidence1, reason: 'Report is from last year; provide the current quarter' });
    expect(rej.status).toBe(201);
    expect((await prisma.evidence.findUniqueOrThrow({ where: { id: state.evidence1 } })).verificationStatus).toBe('REJECTED');
    const notes = await prisma.notification.findMany({ where: { type: 'EVIDENCE_REJECTED', userId: { in: [base.users['contributor@axiarix.local'], base.users['itowner@axiarix.local']] } } });
    expect(notes.length).toBeGreaterThan(0);

    // The review cannot be submitted while answered questions or evidence still lack a decision.
    const early = await auditor.post(`/api/v1/assessments/${id}/review/submit`, { opinion: 'Current-period threat intelligence evidence required.' });
    expect(early.status).toBe(422);
    expect(early.body.error.details.pendingReview.map((p: { itemId: string }) => p.itemId).sort()).toEqual([state.item2, state.item3].sort());
    const ev2 = await prisma.evidence.findFirstOrThrow({ where: { assessmentId: id, itemId: state.item2, deletedAt: null } });
    expect((await auditor.post(`/api/v1/assessments/${id}/items/${state.item2}/review`, { decision: 'ACCEPTED', evidenceId: ev2.id })).status).toBe(201);
    expect((await auditor.post(`/api/v1/assessments/${id}/items/${state.item3}/review`, { decision: 'ACCEPTED', comments: 'SoA exclusion confirmed' })).status).toBe(201);
    // Accepting a file is not a decision on the answer: question 2 still waits for one.
    const still = await auditor.post(`/api/v1/assessments/${id}/review/submit`, { opinion: 'Current-period threat intelligence evidence required.' });
    expect(still.status).toBe(422);
    expect(still.body.error.details.pendingReview.map((p: { itemId: string }) => p.itemId)).toEqual([state.item2]);
    expect((await auditor.post(`/api/v1/assessments/${id}/items/${state.item2}/review`, { decision: 'ACCEPTED' })).status).toBe(201);
    const sub = await auditor.post(`/api/v1/assessments/${id}/review/submit`, { opinion: 'Current-period threat intelligence evidence required.' });
    expect(sub.body.data.status).toBe('CLARIFICATION_REQUIRED');
    // Only the flagged question is editable during clarification.
    expect((await itOwner.put(`/api/v1/assessments/${id}/responses/${state.item2}`, { status: 'COMPLIANT' })).status).toBe(409);
    const ver = await contributor.upload(`/api/v1/evidence/${state.evidence1}/versions`, pdfBuffer('current-quarter'), 'threat-intel-q3.pdf', { note: 'Q3 report' });
    expect(ver.status).toBe(201);
    expect(ver.body.data.version).toBe(2);
    expect((await contributor.post(`/api/v1/assessments/${id}/comments`, { itemId: state.item1, body: 'Uploaded the Q3 report.' })).status).toBe(201);
    expect((await itOwner.post(`/api/v1/assessments/${id}/submit`)).body.data.status).toBe('SUBMITTED_FOR_AUDIT');
    await auditor.post(`/api/v1/assessments/${id}/start-review`);
    expect((await auditor.post(`/api/v1/assessments/${id}/items/${state.item1}/review`, { decision: 'ACCEPTED', evidenceId: state.evidence1 })).status).toBe(201);
    // Round 2: the new file is accepted, and so is the answer it supports.
    expect((await auditor.post(`/api/v1/assessments/${id}/items/${state.item1}/review`, { decision: 'ACCEPTED' })).status).toBe(201);
  });

  it('AT-07: auditor raises a finding and a corrective action is assigned; it shows on the dashboard', async () => {
    const id = state.assessmentId;
    const f = await auditor.post('/api/v1/findings', {
      assessmentId: id,
      itemId: state.item2,
      category: 'MINOR_NONCONFORMITY',
      severity: 'HIGH',
      title: 'Backup restoration not tested for file servers',
      description: 'Restore evidence covers the database only.',
      ownerId: base.users['itowner@axiarix.local'],
      dueDate: '2026-12-31',
    });
    expect(f.status).toBe(201);
    expect(f.body.data.status).toBe('ASSIGNED');
    state.findingId = f.body.data.id;
    const ca = await itOwner.post(`/api/v1/findings/${state.findingId}/actions`, {
      rootCause: 'File server restore not in the DR test plan',
      immediateCorrection: 'Ad-hoc restore of a sample share',
      correctiveAction: 'Add file-server restore to quarterly DR drill',
      ownerId: base.users['contributor@axiarix.local'],
      targetDate: '2026-12-20',
    });
    expect(ca.status).toBe(201);
    state.actionId = ca.body.data.id;
    const dash = await mgmt.get('/api/v1/dashboard/summary');
    expect(dash.body.data.kpis.openFindings).toBe(1);
    expect(dash.body.data.findingsBySeverity.find((s: { severity: string }) => s.severity === 'HIGH').count).toBe(1);

    // A contributor who owns a finding can plan its corrective action (the auditor still verifies it).
    const own = await auditor.post('/api/v1/findings', {
      assessmentId: id, itemId: state.item2, category: 'OBSERVATION', severity: 'LOW',
      title: 'Restore log not signed', description: 'The restore log has no reviewer signature.',
      ownerId: base.users['contributor@axiarix.local'], dueDate: '2026-12-31',
    });
    expect(own.status).toBe(201);
    const planned = await contributor.post(`/api/v1/findings/${own.body.data.id}/actions`, {
      correctiveAction: 'Add a reviewer signature line to the restore log', ownerId: base.users['contributor@axiarix.local'], targetDate: '2026-12-20',
    });
    expect(planned.status).toBe(201);
    // Not the owner: refused.
    const other = await auditor.post('/api/v1/findings', {
      assessmentId: id, category: 'OBSERVATION', severity: 'LOW', title: 'Owner check', description: 'Owned by the IT owner.',
      ownerId: base.users['itowner@axiarix.local'], dueDate: '2026-12-31',
    });
    expect((await contributor.post(`/api/v1/findings/${other.body.data.id}/actions`, { correctiveAction: 'Not mine', ownerId: base.users['contributor@axiarix.local'], targetDate: '2026-12-20' })).status).toBe(403);
    // Remove these two so the later counts are unchanged.
    await prisma.correctiveAction.deleteMany({ where: { findingId: { in: [own.body.data.id, other.body.data.id] } } });
    await prisma.finding.deleteMany({ where: { id: { in: [own.body.data.id, other.body.data.id] } } });
  });

  it('AT-08: closure evidence is submitted and the finding closes only after authorised verification', async () => {
    // Submission without closure evidence is blocked.
    expect((await contributor.post(`/api/v1/corrective-actions/${state.actionId}/submit`, { closureNotes: 'Done' })).status).toBe(422);
    expect((await contributor.post(`/api/v1/corrective-actions/${state.actionId}/updates`, { note: 'DR plan updated', progressPercent: 60 })).status).toBe(201);
    expect((await contributor.upload('/api/v1/evidence', pdfBuffer('dr-drill'), 'dr-drill.pdf', { correctiveActionId: state.actionId })).status).toBe(201);
    expect((await contributor.post(`/api/v1/corrective-actions/${state.actionId}/submit`, { closureNotes: 'Quarterly DR drill now includes file server restore' })).status).toBe(200);
    expect((await prisma.finding.findUniqueOrThrow({ where: { id: state.findingId } })).status).toBe('READY_FOR_VERIFICATION');
    // Contributors cannot verify; closing before verification is blocked.
    expect((await contributor.post(`/api/v1/corrective-actions/${state.actionId}/verify`, { decision: 'VERIFIED' })).status).toBe(403);
    expect((await auditor.post(`/api/v1/findings/${state.findingId}/close`, { closureRecommendation: 'Close' })).status).toBe(409);
    expect((await auditor.post(`/api/v1/corrective-actions/${state.actionId}/verify`, { decision: 'VERIFIED', comment: 'Drill log reviewed' })).status).toBe(200);
    const closed = await auditor.post(`/api/v1/findings/${state.findingId}/close`, { closureRecommendation: 'Evidence of drill reviewed; close.' });
    expect(closed.body.data.status).toBe('CLOSED');
  });

  it('AT-09: approver approves and the final PDF is generated and stored centrally', async () => {
    const id = state.assessmentId;
    // N/A acceptance is enforced; the N/A answer (item 3) was explicitly accepted during the review.
    const wf = await admin.get('/api/v1/admin/settings');
    expect((await admin.put('/api/v1/admin/settings/workflow.policy', { ...wf.body.data['workflow.policy'], requireAuditorAcceptanceForNA: true })).status).toBe(200);
    const rev = await auditor.post(`/api/v1/assessments/${id}/review/submit`, { opinion: 'Controls operating; one minor NC closed.' });
    expect(rev.body.data.status).toBe('PENDING_APPROVAL');
    // The final report cannot be generated before approval.
    expect((await isms.post('/api/v1/reports/generate', { assessmentId: id })).status).toBe(409);
    // Auditors cannot approve.
    expect((await auditor.post(`/api/v1/assessments/${id}/approval`, { decision: 'APPROVED' })).status).toBe(403);
    const ap = await isms.post(`/api/v1/assessments/${id}/approval`, { decision: 'APPROVED', comments: 'Approved for Q3' });
    expect(ap.status).toBe(200);
    expect(ap.body.data.assessment.status).toBe('APPROVED');
    const report = ap.body.data.report;
    expect(report.version).toBe(1);
    expect(report.summary.metrics.compliancePercent).toBe(75);

    const url = await mgmt.post(`/api/v1/reports/${report.id}/download-url`, {});
    expect(url.status).toBe(200);
    const pdf = await mgmt.agent.get(url.body.data.url).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    // Issued reports are immutable at the database layer.
    await expect(prisma.report.update({ where: { id: report.id }, data: { checksum: 'x' } })).rejects.toThrow(/immutable/);
  });

  it('AT-10: a user from another branch is denied access to evidence and the attempt is logged', async () => {
    const res = await otherBranch.get(`/api/v1/evidence/${state.evidence1}`);
    expect(res.status).toBe(403);
    const denied = await prisma.auditEvent.findFirst({ where: { action: 'ACCESS_DENIED', entityId: state.evidence1, outcome: 'DENIED' } });
    expect(denied?.actorEmail).toBe('itowner.alwarpet@axiarix.local');
    // Signed download URLs cannot be obtained either, and listings exclude the other branch.
    expect((await otherBranch.post(`/api/v1/evidence/${state.evidence1}/download-url`, {})).status).toBe(403);
    expect((await otherBranch.get('/api/v1/evidence')).body.meta.total).toBe(0);
    expect((await otherBranch.get(`/api/v1/assessments/${state.assessmentId}`)).status).toBe(403);
  });

  it('AT-12: dashboard filtered by period and site reconciles with database records', async () => {
    const res = await mgmt.get(`/api/v1/dashboard/summary?siteId=${base.ctx.primary.id}&periodLabel=${encodeURIComponent('Q3 FY2026-27')}`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    const responses = await prisma.assessmentResponse.findMany({ where: { assessment: { siteId: base.ctx.primary.id, periodLabel: 'Q3 FY2026-27' } } });
    const c = (s: string) => responses.filter((r) => r.status === s).length;
    expect(d.kpis.counts.COMPLIANT).toBe(c('COMPLIANT'));
    expect(d.kpis.counts.NOT_APPLICABLE).toBe(c('NOT_APPLICABLE'));
    const expected = Math.round(((c('COMPLIANT') + 0.5 * c('PARTIALLY_COMPLIANT')) / (c('COMPLIANT') + c('PARTIALLY_COMPLIANT') + c('NON_COMPLIANT') + c('NOT_ASSESSED'))) * 1000) / 10;
    expect(d.kpis.compliancePercent).toBe(expected);
    expect(d.kpis.totalQuestions).toBe(responses.length);
    // A different period returns nothing; another branch user sees nothing from this site.
    expect((await mgmt.get('/api/v1/dashboard/summary?periodLabel=Q1%202020')).body.data.assessmentsCount).toBe(0);
    expect((await otherBranch.get('/api/v1/dashboard/summary')).body.data.assessmentsCount).toBe(0);
  });

  it('exports responses as CSV with formula-injection protection and audits the export', async () => {
    await prisma.$executeRaw`UPDATE "AssessmentResponse" SET comment = '=HYPERLINK("x")' WHERE "itemId" = ${state.item3}`;
    const res = await isms.get(`/api/v1/assessments/${state.assessmentId}/export?format=csv`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`"'=HYPERLINK(""x"")"`);
    expect(await prisma.auditEvent.count({ where: { action: 'EXPORT', entityId: state.assessmentId } })).toBe(1);
  });

  it('keeps the audit hash chain valid after the full workflow', async () => {
    const res = await admin.get('/api/v1/audit-logs/verify');
    expect(res.body.data.valid).toBe(true);
  });
});
