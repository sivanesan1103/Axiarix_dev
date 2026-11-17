import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/modules/auth/auth.service.js';
import { parsePeriod, periodLabelFor } from '../src/utils/period.js';
import { login, PASSWORD, resetDatabase } from './helpers.js';

/**
 * Governance rules added in the November 2026 review:
 * multi-organisation provisioning, branch-scoped administration, per-user restrictions,
 * separation of duties (checklists, assessments) and fixed-format assessment periods.
 */
type Client = Awaited<ReturnType<typeof login>>;
let base: Awaited<ReturnType<typeof resetDatabase>>;
let admin: Client, isms: Client, auditor: Client, platform: Client;
const SETUP = '../sample-org/01-organisation-setup.xlsx';
const CHECKLIST = '../sample-org/02-checklist-internal-audit.xlsx';
const state: Record<string, string> = {};

async function setPassword(email: string) {
  await prisma.user.update({ where: { email }, data: { passwordHash: await hashPassword(PASSWORD) } });
}

beforeAll(async () => {
  base = await resetDatabase();
  [admin, isms, auditor, platform] = await Promise.all([login('admin@axiarix.local'), login('isms@axiarix.local'), login('auditor@axiarix.local'), login('platform@axiarix.local')]);
});

describe('assessment periods', () => {
  it('parses Indian financial-year periods and rejects malformed ones', () => {
    expect(parsePeriod('Q3 FY2026-27')).toMatchObject({ start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-12-31T00:00:00Z') });
    expect(parsePeriod('Q4 FY2026-27')).toMatchObject({ start: new Date('2027-01-01T00:00:00Z'), end: new Date('2027-03-31T00:00:00Z') });
    expect(parsePeriod('H2 FY2026-27')).toMatchObject({ start: new Date('2026-10-01T00:00:00Z'), end: new Date('2027-03-31T00:00:00Z') });
    expect(parsePeriod('FY2026-27')).toMatchObject({ start: new Date('2026-04-01T00:00:00Z'), end: new Date('2027-03-31T00:00:00Z') });
    expect(parsePeriod('Nov 2026')).toMatchObject({ end: new Date('2026-11-30T00:00:00Z') });
    for (const bad of ['Q3 FY2026-28', 'Q5 FY2026-27', 'Quarter 3', '2026-Q3', '']) expect(parsePeriod(bad)).toBeNull();
    expect(periodLabelFor(new Date('2027-02-10T00:00:00Z'), 'QUARTERLY')).toBe('Q4 FY2026-27');
    expect(periodLabelFor(new Date('2026-04-01T00:00:00Z'), 'YEARLY')).toBe('FY2026-27');
  });
});

describe.sequential('platform owner creates a new organisation', () => {
  it('only platform owners can reach the platform API', async () => {
    expect((await admin.get('/api/v1/platform/organisations')).status).toBe(403);
    const list = await platform.get('/api/v1/platform/organisations');
    expect(list.status).toBe(200);
    expect(list.body.data.map((o: { name: string }) => o.name)).toEqual(['Kauvery Hospitals Group']);
    // The old single-tenant endpoint no longer creates organisations.
    expect((await admin.post('/api/v1/organisations', { name: 'Another org' })).status).toBe(400);
  });

  it('reads the sample setup workbook and creates the organisation with roles, scope and restrictions', async () => {
    const parsed = await platform.upload('/api/v1/platform/organisations/parse-setup', fs.readFileSync(SETUP), 'setup.xlsx');
    expect(parsed.status).toBe(200);
    expect(parsed.body.data.problems).toEqual([]);
    const draft = parsed.body.data.draft;
    expect([draft.branches.length, draft.departments.length, draft.users.length]).toEqual([3, 5, 14]);

    const bad = await platform.post('/api/v1/platform/organisations/validate', { ...draft, users: draft.users.filter((u: { roleKey: string }) => u.roleKey !== 'SYSTEM_ADMIN') });
    expect(bad.body.data.problems.some((p: string) => /organisation-wide System Administrator/.test(p))).toBe(true);

    const created = await platform.post('/api/v1/platform/organisations', { ...draft, sendInvites: false });
    expect(created.status).toBe(201);
    expect(created.body.data.users).toBe(14);
    state.orgId = created.body.data.organisation.id;
    expect(await prisma.role.count({ where: { organisationId: state.orgId } })).toBe(6);
    const deputy = await prisma.user.findUniqueOrThrow({ where: { email: 'isms.deputy@sunrise-sample.example.org' }, include: { restrictions: { include: { permission: true } } } });
    expect(deputy.restrictions.map((r) => r.permission.key).sort()).toEqual(['assessment:approve', 'report:approve', 'settings:update']);
    // Creating the same organisation twice is refused with a readable problem list.
    const dup = await platform.post('/api/v1/platform/organisations', { ...draft, sendInvites: false });
    expect(dup.status).toBe(422);
  });

  it('keeps organisations apart: roles, users and data', async () => {
    await setPassword('admin@sunrise-sample.example.org');
    const sAdmin = await login('admin@sunrise-sample.example.org');
    const roles = await sAdmin.get('/api/v1/roles');
    expect(roles.body.data).toHaveLength(6);
    // Changing a role in one organisation does not change the same role elsewhere.
    const auditorRole = roles.body.data.find((r: { key: string }) => r.key === 'AUDITOR');
    expect((await sAdmin.put(`/api/v1/roles/${auditorRole.id}/permissions`, { permissions: ['dashboard:read'] })).status).toBe(200);
    const kauveryAuditor = await prisma.role.findFirstOrThrow({ where: { organisationId: base.ctx.org.id, key: 'AUDITOR' }, include: { _count: { select: { permissions: true } } } });
    expect(kauveryAuditor._count.permissions).toBeGreaterThan(1);
    const sunriseUser = await prisma.user.findUniqueOrThrow({ where: { email: 'ceo@sunrise-sample.example.org' } });
    expect((await admin.get(`/api/v1/users/${sunriseUser.id}`)).status).toBe(404);
    expect((await sAdmin.get('/api/v1/users?pageSize=100')).body.data.every((u: { email: string }) => u.email.endsWith('example.org'))).toBe(true);
    // Settings are per organisation.
    const before = (await admin.get('/api/v1/admin/settings')).body.data['report.config'].headerTitle;
    expect((await sAdmin.put('/api/v1/admin/settings/report.config', { headerTitle: 'Sunrise ISMS Report', footerText: '', signOffRoles: ['ISMS Manager'], includeEvidenceList: true })).status).toBe(200);
    expect((await admin.get('/api/v1/admin/settings')).body.data['report.config'].headerTitle).toBe(before);
  });

  it('restricted users lose exactly the removed permissions', async () => {
    await setPassword('isms.deputy@sunrise-sample.example.org');
    const deputy = await login('isms.deputy@sunrise-sample.example.org');
    const me = (await deputy.get('/api/v1/auth/me')).body.data;
    expect(me.permissions).not.toContain('assessment:approve');
    expect(me.permissions).toContain('assessment:create');
    expect(me.restrictions.map((r: { permission: string }) => r.permission)).toContain('settings:update');
    expect((await deputy.put('/api/v1/admin/settings/report.config', { headerTitle: 'x', footerText: '', signOffRoles: [], includeEvidenceList: true })).status).toBe(403);
  });

  it('a branch administrator stays inside their branch', async () => {
    await setPassword('branchadmin.north@sunrise-sample.example.org');
    const north = await login('branchadmin.north@sunrise-sample.example.org');
    const sites = await prisma.site.findMany({ where: { organisationId: state.orgId } });
    const nor = sites.find((s) => s.code === 'SCH-NOR')!;
    const cen = sites.find((s) => s.code === 'SCH-CEN')!;
    const newUser = (email: string, siteId: string | null) => north.post('/api/v1/users', { name: 'New Person', email, password: 'Branch-User-Pass-2026', sendInvite: false, roles: [{ roleKey: 'CONTRIBUTOR', siteId }] });
    expect((await newUser('orgwide@sunrise-sample.example.org', null)).status).toBe(403);
    expect((await newUser('central@sunrise-sample.example.org', cen.id)).status).toBe(403);
    const ok = await newUser('north.new@sunrise-sample.example.org', nor.id);
    expect(ok.status).toBe(201);
    expect(ok.body.data.canManage).toBe(true);
    // Cannot manage organisation-wide people, other branches, structure, or themselves.
    const ceo = await prisma.user.findUniqueOrThrow({ where: { email: 'ceo@sunrise-sample.example.org' } });
    expect((await north.post(`/api/v1/users/${ceo.id}/status`, { status: 'INACTIVE', reason: 'test' })).status).toBe(403);
    expect((await north.post('/api/v1/organisations/sites', { name: 'Rogue branch', code: 'RGE' })).status).toBe(403);
    const selfId = (await north.get('/api/v1/auth/me')).body.data.id;
    expect((await north.put(`/api/v1/users/${selfId}/roles`, { roles: [{ roleKey: 'SYSTEM_ADMIN', siteId: null }] })).status).toBe(403);
    expect((await north.post('/api/v1/organisations/departments', { siteId: nor.id, name: 'Pharmacy' })).status).toBe(201);
    expect((await north.post('/api/v1/organisations/departments', { siteId: cen.id, name: 'Pharmacy' })).status).toBe(403);
    // The users list only shows people in the North branch.
    const list = (await north.get('/api/v1/users?pageSize=100')).body.data as { roles: { siteId: string | null }[] }[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((u) => u.roles.some((r) => r.siteId === nor.id))).toBe(true);
  });

  it('imports checklist worksheets into the new organisation as drafts', async () => {
    const res = await platform.upload(`/api/v1/platform/organisations/${state.orgId}/checklists`, fs.readFileSync(CHECKLIST), 'checklist.xlsx');
    expect(res.status).toBe(200);
    expect(res.body.data.checklists.map((c: { items: number }) => c.items)).toEqual([28, 8]);
    const versions = await prisma.checklistVersion.findMany({ where: { template: { organisationId: state.orgId } } });
    expect(versions.every((v) => v.status === 'DRAFT')).toBe(true);
  });

  it('suspending an organisation blocks its sign-ins', async () => {
    expect((await platform.patch(`/api/v1/platform/organisations/${state.orgId}`, { status: 'INACTIVE', reason: 'Contract paused' })).status).toBe(200);
    await expect(login('admin@sunrise-sample.example.org')).rejects.toThrow(/401/);
    expect((await platform.patch(`/api/v1/platform/organisations/${state.orgId}`, { status: 'ACTIVE', reason: 'Contract resumed' })).status).toBe(200);
    await expect(login('admin@sunrise-sample.example.org')).resolves.toBeTruthy();
  });
});

describe.sequential('per-user restrictions in the pilot organisation', () => {
  it('admins restrict others (with a reason) but never themselves', async () => {
    const id = base.users['auditor@axiarix.local'];
    expect((await admin.put(`/api/v1/users/${id}/restrictions`, { restrictions: [{ permission: 'finding:create' }] })).status).toBe(422);
    const r = await admin.put(`/api/v1/users/${id}/restrictions`, { restrictions: [{ permission: 'finding:create' }], reason: 'Trainee period' });
    expect(r.status).toBe(200);
    expect(r.body.data.restrictions.map((x: { permission: string }) => x.permission)).toEqual(['finding:create']);
    const fresh = await login('auditor@axiarix.local');
    expect((await fresh.get('/api/v1/auth/me')).body.data.permissions).not.toContain('finding:create');
    expect((await admin.put(`/api/v1/users/${base.users['admin@axiarix.local']}/restrictions`, { restrictions: [], reason: 'self' })).status).toBe(403);
    expect(await prisma.auditEvent.count({ where: { action: 'USER_RESTRICTIONS_CHANGED' } })).toBe(1);
    // Lift it again for the separation-of-duties tests below.
    expect((await admin.put(`/api/v1/users/${id}/restrictions`, { restrictions: [], reason: 'Trainee period over' })).status).toBe(200);
  });
});

describe.sequential('separation of duties', () => {
  it('checklists: a named reviewer who is not the author publishes, after every flagged mapping is resolved', async () => {
    const up = await isms.upload('/api/v1/imports', fs.readFileSync(CHECKLIST), 'sunrise.xlsx');
    const confirm = await isms.post(`/api/v1/imports/${up.body.data.id}/confirm`, { sheets: [{ sheetName: 'IT - IA Checklist', templateTitle: 'Sample IT IA' }] });
    const versionId = confirm.body.data[0].versionId as string;
    state.versionId = versionId;
    const submit = (c: Client, body: object) => c.post(`/api/v1/checklists/versions/${versionId}/submit-review`, body);
    expect((await submit(isms, {})).status).toBe(422);
    expect((await submit(isms, { reviewerId: base.users['isms@axiarix.local'] })).body.error.code).toBe('SEGREGATION_OF_DUTIES');
    expect((await submit(isms, { reviewerId: base.users['auditor@axiarix.local'] })).status).toBe(422); // auditors cannot approve checklists
    expect((await submit(isms, { reviewerId: base.users['admin@axiarix.local'] })).status).toBe(200);

    expect((await isms.post(`/api/v1/checklists/versions/${versionId}/publish`)).body.error.code).toBe('SEGREGATION_OF_DUTIES');
    const blocked = await admin.post(`/api/v1/checklists/versions/${versionId}/publish`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.details.mappingReview).toHaveLength(1);

    const detail = await admin.get(`/api/v1/checklists/versions/${versionId}`);
    expect(detail.body.data.review).toMatchObject({ canPublish: true, canConfirmMappings: true, reviewer: { name: 'Arjun Mehta' } });
    const flaggedItem = detail.body.data.items.find((i: { mappings: { needsReview: boolean }[] }) => i.mappings.some((m) => m.needsReview));
    // Only the named reviewer confirms while under review.
    expect((await isms.post(`/api/v1/checklists/items/${flaggedItem.id}/mappings/confirm`, {})).status).toBe(403);
    const c = await admin.post(`/api/v1/checklists/versions/${versionId}/review-comments`, { itemId: flaggedItem.id, body: 'Confirm SoA maps to clause 6.1.3' });
    expect(c.status).toBe(201);
    expect((await admin.post(`/api/v1/checklists/items/${flaggedItem.id}/mappings/confirm`, { note: 'Clause 6.1 (SoA, 6.1.3 d)' })).status).toBe(200);
    // Open comments also block publishing until resolved.
    expect((await admin.post(`/api/v1/checklists/versions/${versionId}/publish`)).status).toBe(422);
    expect((await admin.post(`/api/v1/checklists/review-comments/${c.body.data.id}/resolve`)).status).toBe(200);
    expect((await admin.post(`/api/v1/checklists/versions/${versionId}/publish`)).status).toBe(200);
  });

  it('checklist status filter matches the latest version only', async () => {
    const t = (await prisma.checklistVersion.findUniqueOrThrow({ where: { id: state.versionId } })).templateId;
    const v2 = await isms.post(`/api/v1/checklists/${t}/versions`, { changeSummary: 'Second revision' });
    expect(v2.status).toBe(201);
    const drafts = (await isms.get('/api/v1/checklists?status=DRAFT')).body.data.map((x: { id: string }) => x.id);
    const published = (await isms.get('/api/v1/checklists?status=PUBLISHED')).body.data.map((x: { id: string }) => x.id);
    expect(drafts).toContain(t);
    expect(published).not.toContain(t);
  });

  it('assessments: preparers cannot audit, auditors and preparers cannot approve', async () => {
    const a = await isms.post('/api/v1/assessments', {
      title: 'SoD test',
      siteId: base.ctx.primary.id,
      departmentId: base.ctx.primaryDept.id,
      checklistVersionId: state.versionId,
      periodLabel: 'Q3 FY2026-28',
      startDate: '2026-11-01',
      dueDate: '2026-12-15',
      ownerId: base.users['itowner@axiarix.local'],
    });
    expect(a.status).toBe(422); // malformed financial year
    const ok = await isms.post('/api/v1/assessments', {
      title: 'SoD test',
      siteId: base.ctx.primary.id,
      departmentId: base.ctx.primaryDept.id,
      checklistVersionId: state.versionId,
      periodLabel: 'Q3 FY2026-27',
      startDate: '2026-11-01',
      dueDate: '2026-12-15',
      ownerId: base.users['itowner@axiarix.local'],
      approvalRequired: true,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.periodStart).toBe('2026-10-01T00:00:00.000Z');
    expect(ok.body.data.periodEnd).toBe('2026-12-31T00:00:00.000Z');
    const id = ok.body.data.id as string;
    await isms.post(`/api/v1/assessments/${id}/release`);
    const items = await prisma.checklistItem.findMany({ where: { versionId: state.versionId } });
    // System Administrators oversee assessments but do not fill them in.
    const adminFlags = (await admin.get(`/api/v1/assessments/${id}`)).body.data.actions;
    expect(adminFlags.respond).toBe(false);
    expect((await admin.put(`/api/v1/assessments/${id}/responses/${items[0].id}`, { status: 'COMPLIANT' })).status).toBe(403);

    // Someone who is the department's IT owner and also an auditor and ISMS owner prepares it…
    const roleId = async (key: string) => (await prisma.role.findFirstOrThrow({ where: { organisationId: base.ctx.org.id, key } })).id;
    const dual = await prisma.user.create({ data: { email: 'dual.role@axiarix.local', name: 'Dual Role', organisationId: base.ctx.org.id, passwordHash: await hashPassword(PASSWORD), status: 'ACTIVE' } });
    await prisma.userRole.createMany({
      data: [
        { userId: dual.id, roleId: await roleId('IT_OWNER'), organisationId: base.ctx.org.id, siteId: base.ctx.primary.id, departmentId: base.ctx.primaryDept.id },
        { userId: dual.id, roleId: await roleId('AUDITOR'), organisationId: base.ctx.org.id },
        { userId: dual.id, roleId: await roleId('ISMS_OWNER'), organisationId: base.ctx.org.id },
      ],
    });
    const dualClient = await login('dual.role@axiarix.local');
    for (const i of items) {
      const r = await dualClient.put(`/api/v1/assessments/${id}/responses/${i.id}`, { status: 'NOT_APPLICABLE', justification: 'Out of scope for this test' });
      expect(r.status).toBe(200);
    }
    expect((await dualClient.post(`/api/v1/assessments/${id}/submit`)).status).toBe(200);
    // …so they can neither audit nor approve it.
    const flags = (await dualClient.get(`/api/v1/assessments/${id}`)).body.data.actions;
    expect(flags.startReview).toBe(false);
    expect(flags.blocked.review).toMatch(/prepared this assessment/);
    expect((await dualClient.post(`/api/v1/assessments/${id}/start-review`)).body.error.code).toBe('SEGREGATION_OF_DUTIES');
    expect((await auditor.post(`/api/v1/assessments/${id}/start-review`)).status).toBe(200);
    for (const i of items) await auditor.post(`/api/v1/assessments/${id}/items/${i.id}/review`, { decision: 'ACCEPTED' });
    expect((await auditor.post(`/api/v1/assessments/${id}/review/submit`, { opinion: 'All answers and evidence reviewed; controls operating.' })).body.data.status).toBe('PENDING_APPROVAL');
    expect((await dualClient.post(`/api/v1/assessments/${id}/approval`, { decision: 'APPROVED' })).body.error.code).toBe('SEGREGATION_OF_DUTIES');
    expect((await isms.post(`/api/v1/assessments/${id}/approval`, { decision: 'APPROVED' })).status).toBe(200);
  });
});

describe.sequential('tasks go only to people who can do them', () => {
  it('questions, findings and assessment owners must work in the record\'s branch and department', async () => {
    const itOwner = await login('itowner@axiarix.local');
    const alwarpet = base.users['itowner.alwarpet@axiarix.local'];
    // An owner from another branch is refused when creating an assessment.
    const wrongOwner = await isms.post('/api/v1/assessments', {
      title: 'Owner scope test', siteId: base.ctx.primary.id, departmentId: base.ctx.primaryDept.id, checklistVersionId: state.versionId,
      periodLabel: 'Q4 FY2026-27', startDate: '2027-01-02', dueDate: '2027-03-15', ownerId: alwarpet,
    });
    expect(wrongOwner.status).toBe(400);
    expect(wrongOwner.body.error.message).toMatch(/no access to this branch and department/);
    const a = await isms.post('/api/v1/assessments', {
      title: 'Task scope test', siteId: base.ctx.primary.id, departmentId: base.ctx.primaryDept.id, checklistVersionId: state.versionId,
      periodLabel: 'Q4 FY2026-27', startDate: '2027-01-02', dueDate: '2027-03-15', ownerId: base.users['itowner@axiarix.local'],
    });
    expect(a.status).toBe(201);
    state.taskAssessment = a.body.data.id;
    await isms.post(`/api/v1/assessments/${a.body.data.id}/release`);
    const item = await prisma.checklistItem.findFirstOrThrow({ where: { versionId: state.versionId } });
    // Question assignment: someone from another branch is refused, a colleague in the department is accepted.
    expect((await itOwner.post(`/api/v1/assessments/${a.body.data.id}/assign`, { itemIds: [item.id], assigneeId: alwarpet })).status).toBe(400);
    expect((await itOwner.post(`/api/v1/assessments/${a.body.data.id}/assign`, { itemIds: [item.id], assigneeId: base.users['contributor@axiarix.local'] })).status).toBe(200);
    // The contributor sees the work in their task list.
    const contributor = await login('contributor@axiarix.local');
    const tasks = (await contributor.get('/api/v1/dashboard/tasks')).body.data;
    expect(tasks.myQuestions.some((t: { id: string; assignedToMe: number }) => t.id === a.body.data.id && t.assignedToMe === 1)).toBe(true);
  });

  it('an open assessment can be handed to another owner in the same department, with a recorded reason', async () => {
    const id = state.taskAssessment as string;
    const alwarpet = base.users['itowner.alwarpet@axiarix.local'];
    // Someone from another branch is refused; the current owner is refused; a reason is required.
    expect((await isms.post(`/api/v1/assessments/${id}/owner`, { ownerId: alwarpet, reason: 'Moving work' })).status).toBe(400);
    expect((await isms.post(`/api/v1/assessments/${id}/owner`, { ownerId: base.users['itowner@axiarix.local'], reason: 'Same person' })).status).toBe(400);
    expect((await isms.post(`/api/v1/assessments/${id}/owner`, { ownerId: base.users['admin@axiarix.local'], reason: '' })).status).toBe(422);
    const ok = await isms.post(`/api/v1/assessments/${id}/owner`, { ownerId: base.users['admin@axiarix.local'], reason: 'Owner on leave this quarter' });
    expect(ok.status).toBe(200);
    expect((await isms.get(`/api/v1/assessments/${id}`)).body.data).toMatchObject({ ownerId: base.users['admin@axiarix.local'], ownerHasAccess: true });
    expect(await prisma.auditEvent.count({ where: { action: 'ASSESSMENT_OWNER_CHANGED', entityId: id } })).toBe(1);
    // Contributors cannot change the owner.
    const contributor = await login('contributor@axiarix.local');
    expect((await contributor.post(`/api/v1/assessments/${id}/owner`, { ownerId: base.users['itowner@axiarix.local'], reason: 'Try' })).status).toBe(403);
    await isms.post(`/api/v1/assessments/${id}/owner`, { ownerId: base.users['itowner@axiarix.local'], reason: 'Owner back' });
  });

  it('the review list is based on approval permission, and only the reviewer or comment author resolves comments', async () => {
    const t = await isms.post('/api/v1/checklists', { title: 'Reviewer list test' });
    const v = (await isms.get(`/api/v1/checklists/${t.body.data.id}`)).body.data.versions[0].id as string;
    await isms.post(`/api/v1/checklists/versions/${v}/items`, { question: 'Access reviews are performed quarterly', mappings: [{ type: 'ANNEX_A', reference: '5.18' }] });
    const names = (await isms.get(`/api/v1/checklists/versions/${v}/eligible-reviewers`)).body.data.map((u: { name: string }) => u.name);
    expect(names).toContain('Arjun Mehta'); // administrator: has checklist:approve
    expect(names).not.toContain('Lakshmi Iyer'); // the author
    expect(names).not.toContain('Rahul Varma'); // auditors cannot approve checklists
    await isms.post(`/api/v1/checklists/versions/${v}/submit-review`, { reviewerId: base.users['admin@axiarix.local'] });
    const c = await admin.post(`/api/v1/checklists/versions/${v}/review-comments`, { body: 'Add the review frequency to the evidence requirement' });
    expect(c.status).toBe(201);
    // The author cannot dismiss the reviewer's comment; the reviewer can resolve it.
    expect((await isms.post(`/api/v1/checklists/review-comments/${c.body.data.id}/resolve`)).status).toBe(403);
    const list = (await isms.get(`/api/v1/checklists/versions/${v}/review-comments`)).body.data;
    expect(list[0].canResolve).toBe(false);
    // The named reviewer sees the review in their task list.
    expect((await admin.get('/api/v1/dashboard/tasks')).body.data.checklistReviews.some((x: { id: string }) => x.id === v)).toBe(true);
    expect((await admin.post(`/api/v1/checklists/review-comments/${c.body.data.id}/resolve`)).status).toBe(200);
  });
});
