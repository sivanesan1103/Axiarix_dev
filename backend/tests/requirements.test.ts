import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { login, resetDatabase } from './helpers.js';

/**
 * SRS requirements that the acceptance scenarios (AT-01 … AT-12) do not exercise directly:
 * search of checklist questions (FR-027), department filters (FR-021), the display time zone
 * (SRS 2.3 / NFR-10) and protection against repeated submissions (SRS §10).
 */
type Client = Awaited<ReturnType<typeof login>>;
let base: Awaited<ReturnType<typeof resetDatabase>>;
let admin: Client, isms: Client, itOwner: Client;
let versionId = '';

beforeAll(async () => {
  base = await resetDatabase();
  [admin, isms, itOwner] = await Promise.all([login('admin@axiarix.local'), login('isms@axiarix.local'), login('itowner@axiarix.local')]);
  // A small published checklist: one question that needs an answer but no evidence.
  const t = await prisma.checklistTemplate.create({ data: { organisationId: base.ctx.org.id, title: 'Requirements check list' } });
  const v = await prisma.checklistVersion.create({ data: { templateId: t.id, versionNumber: 1 } });
  await prisma.checklistItem.create({ data: { versionId: v.id, questionCode: 'RQ-001', sequence: 1, question: 'Quarterly firewall rule recertification is performed', evidenceMandatory: false } });
  await prisma.checklistVersion.update({ where: { id: v.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
  versionId = v.id;
});

async function newAssessment(title: string) {
  const a = await isms.post('/api/v1/assessments', {
    title, siteId: base.ctx.primary.id, departmentId: base.ctx.primaryDept.id, checklistVersionId: versionId,
    periodLabel: 'Q4 FY2026-27', startDate: '2027-01-02', dueDate: '2027-03-15', ownerId: base.users['itowner@axiarix.local'], assignDefaultOwners: false,
  });
  expect(a.status).toBe(201);
  expect((await isms.post(`/api/v1/assessments/${a.body.data.id}/release`)).status).toBe(200);
  return a.body.data.id as string;
}

describe.sequential('SRS requirements beyond the acceptance scenarios', () => {
  it('FR-027: search finds checklist questions within the organisation', async () => {
    const res = await isms.get('/api/v1/search?q=firewall rule recert');
    expect(res.status).toBe(200);
    const hit = res.body.data.find((r: { type: string }) => r.type === 'question');
    expect(hit.title).toMatch(/^RQ-001 · Quarterly firewall rule recertification/);
    expect(hit.link).toBe(`/checklists/${(await prisma.checklistVersion.findUniqueOrThrow({ where: { id: versionId } })).templateId}/versions/${versionId}?search=RQ-001`);
    // The platform owner's organisation does not see it.
    const platform = await login('platform@axiarix.local');
    const other = await platform.get('/api/v1/search?q=firewall rule recert');
    expect((other.body.data ?? []).some((r: { type: string }) => r.type === 'question')).toBe(false);
  });

  it('SRS 2.3 / NFR-10: dates are shown in the organisation time zone, which administrators can change', async () => {
    expect((await isms.get('/api/v1/auth/me')).body.data.timeZone).toBe('Asia/Kolkata');
    expect((await admin.put('/api/v1/admin/settings/locale.config', { timeZone: 'Mars/Olympus' })).status).toBeGreaterThanOrEqual(400);
    expect((await admin.put('/api/v1/admin/settings/locale.config', { timeZone: 'Asia/Dubai' })).status).toBe(200);
    expect((await isms.get('/api/v1/auth/me')).body.data.timeZone).toBe('Asia/Dubai');
    // Non-administrators cannot change it.
    expect((await itOwner.put('/api/v1/admin/settings/locale.config', { timeZone: 'UTC' })).status).toBe(403);
    await admin.put('/api/v1/admin/settings/locale.config', { timeZone: 'Asia/Kolkata' });
  });

  it('SRS §10: a repeated submission is accepted only once', async () => {
    const id = await newAssessment('Double submit check');
    const item = await prisma.checklistItem.findFirstOrThrow({ where: { versionId } });
    expect((await itOwner.put(`/api/v1/assessments/${id}/responses/${item.id}`, { status: 'COMPLIANT', comment: 'Recertified in October' })).status).toBe(200);
    const results = await Promise.all([itOwner.post(`/api/v1/assessments/${id}/submit`), itOwner.post(`/api/v1/assessments/${id}/submit`)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.auditEvent.count({ where: { action: 'ASSESSMENT_SUBMITTED', entityId: id } })).toBe(1);
  });

  it('FR-021 / BRD §9: the dashboard filters by department and reports compliance per department', async () => {
    const all = (await isms.get('/api/v1/dashboard/summary')).body.data;
    expect(all.departmentComparison.length).toBeGreaterThan(0);
    const row = all.departmentComparison.find((d: { departmentId: string }) => d.departmentId === base.ctx.primaryDept.id);
    expect(row).toMatchObject({ siteId: base.ctx.primary.id, compliancePercent: 100 });
    const filtered = (await isms.get(`/api/v1/dashboard/summary?departmentId=${base.ctx.primaryDept.id}`)).body.data;
    expect(filtered.departmentComparison.every((d: { departmentId: string }) => d.departmentId === base.ctx.primaryDept.id)).toBe(true);
    expect(filtered.assessmentsCount).toBe(await prisma.assessment.count({ where: { departmentId: base.ctx.primaryDept.id } }));
  });
});
