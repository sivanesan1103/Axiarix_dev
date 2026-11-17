import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Workflow branches driven through the UI: clarification round (evidence rejected, new version,
 * re-submitted, accepted), approval rejected and re-approved, and a formal reopen.
 * Setup that is not under test (checklist, assessment, first answer) goes through the API.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? 'Axiarix@Dev2026';
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5174';
const stamp = Date.now().toString().slice(-6);
const pdf = (label: string) => ({ name: `${label}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${label} ${stamp}\n%%EOF`) });

async function apiAs(email: string) {
  const ctx = await playwrightRequest.newContext({ baseURL: `${BASE}/api/v1/` });
  const res = await ctx.post('auth/login', { data: { email, password: PASSWORD } });
  const token = (await res.json()).data.accessToken as string;
  return { ctx, headers: { Authorization: `Bearer ${token}` } };
}
type Api = Awaited<ReturnType<typeof apiAs>>;
const call = async (api: Api, method: 'get' | 'post' | 'put', url: string, data?: object) => {
  const r = await (api.ctx[method] as APIRequestContext['post'])(url, { headers: api.headers, data });
  expect(r.ok(), `${method.toUpperCase()} ${url} → ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()).data;
};

async function loginAs(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
  return page;
}
const dialog = (page: Page) => page.getByRole('dialog');
const status = (page: Page, text: string) => expect(page.locator('h1')).toContainText(text);

test('clarification round, rejected approval and reopen work through the UI', async ({ browser }) => {
  // ── Setup through the API ──
  const [isms, admin, itOwnerApi] = await Promise.all([apiAs('isms@axiarix.local'), apiAs('admin@axiarix.local'), apiAs('itowner@axiarix.local')]);
  const t = await call(isms, 'post', 'checklists', { title: `E2E Flow checklist ${stamp}` });
  const versionId = (await call(isms, 'get', `checklists/${t.id}`)).versions[0].id as string;
  const item = await call(isms, 'post', `checklists/versions/${versionId}/items`, { question: 'Backup media is encrypted', mappings: [{ type: 'ANNEX_A', reference: '8.13' }] });
  await call(isms, 'post', `checklists/versions/${versionId}/submit-review`, { reviewerId: (await call(admin, 'get', 'auth/me')).id });
  await call(admin, 'post', `checklists/versions/${versionId}/publish`, {});
  const org = await call(isms, 'get', 'organisations/current');
  const site = org.sites.find((s: { code: string }) => s.code === 'KVP');
  const dept = site.departments[0];
  const a = await call(isms, 'post', 'assessments', {
    title: `E2E Flow assessment ${stamp}`, siteId: site.id, departmentId: dept.id, checklistVersionId: versionId,
    periodLabel: 'Q3 FY2026-27', startDate: '2026-11-17', dueDate: '2026-12-31', ownerId: dept.ownerId, assignDefaultOwners: false,
  });
  await call(isms, 'post', `assessments/${a.id}/release`);
  await call(itOwnerApi, 'put', `assessments/${a.id}/responses/${item.id}`, { status: 'COMPLIANT', comment: 'All backup tapes use AES-256' });
  const up = await itOwnerApi.ctx.post('evidence', { headers: itOwnerApi.headers, multipart: { assessmentId: a.id, itemId: item.id, file: pdf('encryption-config') } });
  expect(up.ok()).toBeTruthy();
  await call(itOwnerApi, 'post', `assessments/${a.id}/submit`);

  // ── Auditor rejects the evidence; the assessment goes back for clarification ──
  const auditor = await loginAs(browser, 'auditor@axiarix.local');
  await auditor.goto(`/auditor/${a.id}`);
  await auditor.getByRole('button', { name: 'Start review' }).click();
  await status(auditor, 'Under review');
  await auditor.getByRole('button', { name: 'Reject', exact: true }).click();
  await dialog(auditor).getByRole('textbox').fill('Screenshot does not show the encryption setting');
  await dialog(auditor).getByRole('button', { name: 'Reject' }).click();
  await expect(auditor.getByText('Rejected evidence').first()).toBeVisible();
  await auditor.getByRole('button', { name: 'Submit review' }).click();
  await dialog(auditor).locator('#opinion').fill('Evidence for backup encryption is insufficient; clarification requested.');
  await dialog(auditor).getByRole('button', { name: 'Submit review' }).click();
  await status(auditor, 'Clarification required');

  // ── IT owner uploads a new version and re-submits ──
  const it = await loginAs(browser, 'itowner@axiarix.local');
  await it.goto(`/my-assessments/${a.id}`);
  await status(it, 'Clarification required');
  await it.getByRole('button', { name: 'New version' }).click();
  await dialog(it).locator('[data-testid=file-input]').setInputFiles(pdf('encryption-config-v2'));
  await dialog(it).getByRole('button', { name: 'Upload' }).click();
  await expect(it.getByText(/v2/).first()).toBeVisible();
  await it.getByRole('button', { name: 'Re-submit' }).click();
  await dialog(it).getByRole('button', { name: 'Submit' }).click();
  await status(it, 'Submitted for audit');

  // ── Auditor accepts the new evidence and the answer ──
  await auditor.goto(`/auditor/${a.id}`);
  await auditor.getByRole('button', { name: 'Start review' }).click();
  await status(auditor, 'Under review');
  await auditor.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(auditor.getByText('Accepted evidence').first()).toBeVisible();
  await auditor.getByRole('button', { name: /^Accept answer/ }).click();
  await expect(auditor.getByRole('button', { name: 'Answer accepted' })).toBeDisabled();
  await auditor.getByRole('button', { name: 'Submit review' }).click();
  await dialog(auditor).locator('#opinion').fill('Encryption setting now evidenced; control operating effectively.');
  await dialog(auditor).getByRole('button', { name: 'Submit review' }).click();
  await status(auditor, 'Pending approval');

  // ── ISMS owner rejects the approval with a reason; the auditor revises; then it is approved ──
  const ismsUi = await loginAs(browser, 'isms@axiarix.local');
  await ismsUi.goto(`/assessments/${a.id}`);
  await ismsUi.getByRole('button', { name: 'Reject', exact: true }).click();
  await dialog(ismsUi).getByRole('textbox').fill('Opinion should name the backup system checked');
  await dialog(ismsUi).getByRole('button', { name: 'Reject' }).click();
  await status(ismsUi, 'Under review');
  await auditor.goto(`/auditor/${a.id}`);
  await auditor.getByRole('button', { name: 'Submit review' }).click();
  await dialog(auditor).locator('#opinion').fill('Veeam backup encryption (AES-256) evidenced; control operating effectively.');
  await dialog(auditor).getByRole('button', { name: 'Submit review' }).click();
  await status(auditor, 'Pending approval');
  await ismsUi.goto(`/assessments/${a.id}`);
  await ismsUi.getByRole('button', { name: 'Approve & issue report' }).click();
  await dialog(ismsUi).getByRole('button', { name: 'Approve' }).click();
  await expect(ismsUi.getByText('Approved — final report generated')).toBeVisible();
  await status(ismsUi, 'Approved');

  // ── Formal reopen with a reason; the department can answer again ──
  await ismsUi.getByRole('button', { name: 'Reopen' }).click();
  await dialog(ismsUi).getByRole('textbox').fill('Backup scope extended to the DR site');
  await dialog(ismsUi).getByRole('button', { name: 'Reopen' }).click();
  await status(ismsUi, 'In progress');
  await it.goto(`/my-assessments/${a.id}`);
  await status(it, 'In progress');
  await expect(it.getByRole('button', { name: 'Save answer' })).toBeVisible();
});

test('returned closure evidence is fixed by the action owner and then verified, through the UI', async ({ browser }) => {
  // ── Setup through the API: an assessment under review with a finding and a submitted action ──
  const [isms, admin, itOwnerApi, auditorApi, contribApi] = await Promise.all(
    ['isms', 'admin', 'itowner', 'auditor', 'contributor'].map((n) => apiAs(`${n}@axiarix.local`)),
  );
  const t = await call(isms, 'post', 'checklists', { title: `E2E Action checklist ${stamp}` });
  const versionId = (await call(isms, 'get', `checklists/${t.id}`)).versions[0].id as string;
  const item = await call(isms, 'post', `checklists/versions/${versionId}/items`, { question: 'Firewall rules are reviewed', mappings: [{ type: 'ANNEX_A', reference: '8.20' }], evidenceMandatory: false });
  await call(isms, 'post', `checklists/versions/${versionId}/submit-review`, { reviewerId: (await call(admin, 'get', 'auth/me')).id });
  await call(admin, 'post', `checklists/versions/${versionId}/publish`, {});
  const org = await call(isms, 'get', 'organisations/current');
  const site = org.sites.find((s: { code: string }) => s.code === 'KVP');
  const dept = site.departments[0];
  const a = await call(isms, 'post', 'assessments', {
    title: `E2E Action assessment ${stamp}`, siteId: site.id, departmentId: dept.id, checklistVersionId: versionId,
    periodLabel: 'Q3 FY2026-27', startDate: '2026-11-17', dueDate: '2026-12-31', ownerId: dept.ownerId, assignDefaultOwners: false,
  });
  await call(isms, 'post', `assessments/${a.id}/release`);
  await call(itOwnerApi, 'put', `assessments/${a.id}/responses/${item.id}`, { status: 'PARTIALLY_COMPLIANT', comment: 'Reviewed yearly, not quarterly' });
  await call(itOwnerApi, 'post', `assessments/${a.id}/submit`);
  await call(auditorApi, 'post', `assessments/${a.id}/start-review`);
  const finding = await call(auditorApi, 'post', 'findings', {
    assessmentId: a.id, itemId: item.id, category: 'MINOR_NONCONFORMITY', severity: 'MEDIUM', title: `Firewall review only yearly ${stamp}`,
    description: 'Rules reviewed once a year instead of quarterly.', ownerId: dept.ownerId, dueDate: '2026-12-31',
  });
  const contributorId = (await call(contribApi, 'get', 'auth/me')).id;
  const action = await call(itOwnerApi, 'post', `findings/${finding.id}/actions`, { correctiveAction: 'Schedule a quarterly firewall rule review', ownerId: contributorId, targetDate: '2026-12-20' });
  const up = await contribApi.ctx.post('evidence', { headers: contribApi.headers, multipart: { correctiveActionId: action.id, file: pdf('review-calendar') } });
  expect(up.ok()).toBeTruthy();
  await call(contribApi, 'post', `corrective-actions/${action.id}/submit`, { closureNotes: 'Quarterly review added to the calendar' });

  // ── Auditor returns the closure evidence with a reason ──
  const auditor = await loginAs(browser, 'auditor@axiarix.local');
  await auditor.goto(`/corrective-actions/${action.id}`);
  await auditor.getByRole('button', { name: 'Return' }).click();
  await dialog(auditor).getByRole('textbox').fill('Calendar entry has no owner or date');
  await dialog(auditor).getByRole('button', { name: 'Return' }).click();
  await status(auditor, 'Returned');

  // ── Action owner sees it returned, uploads a better file and submits again ──
  const contributor = await loginAs(browser, 'contributor@axiarix.local');
  await contributor.goto(`/corrective-actions/${action.id}`);
  await status(contributor, 'Returned');
  await expect(contributor.getByText('Calendar entry has no owner or date').first()).toBeVisible();
  await contributor.getByRole('button', { name: 'Upload' }).click();
  await dialog(contributor).locator('[data-testid=file-input]').setInputFiles(pdf('review-calendar-with-owner'));
  await dialog(contributor).getByRole('button', { name: 'Upload' }).click();
  await expect(contributor.getByText('review-calendar-with-owner.pdf').first()).toBeVisible();
  await contributor.getByRole('button', { name: 'Submit for verification' }).click();
  await dialog(contributor).getByRole('textbox').fill('Calendar entry now names the owner and the review dates');
  await dialog(contributor).getByRole('button', { name: 'Submit' }).click();
  await status(contributor, 'Awaiting verification');

  // ── Auditor verifies the action and closes the finding ──
  await auditor.goto(`/corrective-actions/${action.id}`);
  await auditor.getByRole('button', { name: 'Verify closure' }).click();
  await dialog(auditor).getByRole('button', { name: 'Verify' }).click();
  await status(auditor, 'Verified');
  await auditor.goto(`/findings/${finding.id}`);
  await auditor.getByRole('button', { name: 'Verify & close' }).click();
  await dialog(auditor).getByRole('textbox').fill('Quarterly review scheduled with owner; closed.');
  await dialog(auditor).getByRole('button', { name: 'Close finding' }).click();
  await status(auditor, 'Verified / closed');
});
