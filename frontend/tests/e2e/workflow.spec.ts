import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Full hospital IT audit workflow through the real UI:
 * Administrator → Checklist → IT Assessment → Evidence Upload → Auditor Review →
 * Finding → Corrective Action → Approval → Final PDF Report.
 * Screenshots are saved to docs/screenshots as the delivery evidence.
 */
const PASSWORD = process.env.E2E_PASSWORD ?? 'Axiarix@Dev2026';
const SHOTS = '../docs/screenshots';
const stamp = Date.now().toString().slice(-6);
const CHECKLIST = `E2E Backup controls ${stamp}`;
const ASSESSMENT = `E2E Quarterly IA ${stamp}`;
const pdf = (label: string) => ({ name: `${label}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${label} ${stamp}\n%%EOF`) });

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
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });

test('complete ISO 27001 audit workflow', async ({ browser }) => {
  // ── Login page ──
  const anon = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await anon.goto('/login');
  await expect(anon.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await shot(anon, '01-login');
  await anon.close();

  // ── ISMS owner: dashboard, checklist creation and publication ──
  const isms = await loginAs(browser, 'isms@axiarix.local');
  await expect(isms.getByText('Overall compliance')).toBeVisible();
  await isms.waitForTimeout(800);
  await shot(isms, '02-dashboard');

  await isms.goto('/checklists');
  await expect(isms.getByText('Kauvery Vadapalani IT – Internal Audit Checklist')).toBeVisible();
  await shot(isms, '03-checklist-library');
  await isms.getByRole('button', { name: 'New checklist' }).click();
  await isms.locator('#c-title').fill(CHECKLIST);
  await dialog(isms).getByRole('button', { name: 'Create' }).click();
  await expect(isms).toHaveURL(/\/versions\//);

  await isms.getByRole('button', { name: 'Add question' }).click();
  await isms.locator('#i-q').fill('Backup restoration is tested quarterly for file servers and databases');
  await isms.locator('#i-d').fill('Evidence of successful restore tests with sign-off');
  await dialog(isms).getByLabel('Reference', { exact: true }).selectOption('8.13');
  await dialog(isms).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog(isms).getByText('A.8.13', { exact: true })).toBeVisible();
  await dialog(isms).getByRole('button', { name: 'Add question' }).click();
  await expect(isms.getByText('Backup restoration is tested quarterly')).toBeVisible();
  await shot(isms, '04-checklist-editor');

  // Four-eyes: the author names a reviewer and cannot publish; the reviewer publishes.
  await isms.getByRole('button', { name: 'Submit for review' }).click();
  await expect(dialog(isms).locator('#v-reviewer option', { hasText: 'Arjun Mehta' })).toHaveCount(1);
  const reviewer = await dialog(isms).locator('#v-reviewer option', { hasText: 'Arjun Mehta' }).getAttribute('value');
  await dialog(isms).locator('#v-reviewer').selectOption(reviewer!);
  await dialog(isms).getByRole('button', { name: 'Submit' }).click();
  await expect(isms.getByText('Under review', { exact: true }).first()).toBeVisible();
  await expect(isms.getByText('the named reviewer must publish or return it')).toBeVisible();
  await expect(isms.getByRole('button', { name: 'Publish' })).toHaveCount(0);
  const checklistUrl = new URL(isms.url()).pathname;
  const admin = await loginAs(browser, 'admin@axiarix.local');
  await admin.goto(checklistUrl);
  await admin.getByRole('button', { name: 'Publish' }).click();
  await dialog(admin).getByRole('button', { name: 'Publish' }).click();
  await expect(admin.getByText('Published versions are immutable')).toBeVisible();

  // ── ISMS owner: create and release the assessment ──
  await isms.goto('/assessments/new');
  await isms.locator('#a-title').fill(ASSESSMENT);
  await isms.locator('#a-site').selectOption({ label: 'Vadapalani' });
  await isms.locator('#a-dept').selectOption({ label: 'IT & IT Data Centre' });
  const versionValue = await isms.locator('#a-ver option', { hasText: CHECKLIST }).getAttribute('value');
  await isms.locator('#a-ver').selectOption(versionValue!);
  await expect(isms.locator('#a-owner')).not.toHaveValue('');
  await isms.getByRole('button', { name: 'Create assessment' }).click();
  await expect(isms).toHaveURL(/\/assessments\/[0-9a-f-]{36}$/);
  const assessmentUrl = isms.url();
  const assessmentId = assessmentUrl.split('/').pop()!;
  await isms.getByRole('button', { name: 'Assign to department' }).click();
  await dialog(isms).getByRole('button', { name: 'Assign' }).click();
  await expect(isms.getByText('Assigned', { exact: true }).first()).toBeVisible();

  // ── IT owner: answer, upload evidence, submit ──
  const it = await loginAs(browser, 'itowner@axiarix.local');
  await it.goto(`/my-assessments/${assessmentId}`);
  await it.getByRole('radio', { name: 'Compliant', exact: true }).click();
  await it.locator('#r-comment').fill('Quarterly restore drill performed on 02-Nov; logs attached.');
  await it.getByRole('button', { name: 'Save answer' }).click();
  await expect(it.getByText(/saved/).first()).toBeVisible();
  await it.getByRole('button', { name: 'Upload evidence' }).click();
  await dialog(it).locator('[data-testid=file-input]').setInputFiles(pdf('restore-drill-q3'));
  await dialog(it).getByRole('button', { name: 'Upload' }).click();
  await expect(it.getByText('restore-drill-q3.pdf').first()).toBeVisible();
  await shot(it, '05-assessment-workspace');
  await it.getByRole('button', { name: 'Submit for audit' }).click();
  await expect(dialog(it).getByText('All mandatory answers')).toBeVisible();
  await dialog(it).getByRole('button', { name: 'Submit' }).click();
  await expect(it.getByText('Submitted for audit').first()).toBeVisible();
  // Submitted assessments are read-only for the department.
  await expect(it.getByText(/read-only/).first()).toBeVisible();

  // ── Auditor: review, accept evidence, raise finding, submit review ──
  const auditor = await loginAs(browser, 'auditor@axiarix.local');
  await auditor.goto('/auditor');
  await expect(auditor.getByText(ASSESSMENT)).toBeVisible();
  await shot(auditor, '07-auditor-workspace');
  await auditor.goto(`/auditor/${assessmentId}`);
  await auditor.getByRole('button', { name: 'Start review' }).click();
  await expect(auditor.getByText('Under review').first()).toBeVisible();
  await auditor.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(auditor.getByText('Accepted').first()).toBeVisible();
  await auditor.getByRole('button', { name: 'Raise finding' }).click();
  await dialog(auditor).locator('#f-sev').selectOption('MEDIUM');
  await dialog(auditor).locator('#f-title').fill(`File-server restore not yet in DR plan ${stamp}`);
  await dialog(auditor).locator('#f-desc').fill('Restore drill covers databases; file-server restore is not documented in the DR plan.');
  await dialog(auditor).getByRole('button', { name: 'Raise finding' }).click();
  await expect(auditor.getByText(/Finding FND-/).first()).toBeVisible();
  await auditor.getByRole('button', { name: 'Submit review' }).click();
  await dialog(auditor).locator('#opinion').fill('Backup control operating effectively; one observation raised for DR plan coverage.');
  await dialog(auditor).getByRole('button', { name: 'Submit review' }).click();
  await expect(auditor.getByText('Pending approval').first()).toBeVisible();

  // ── IT owner: corrective action with closure evidence ──
  await it.goto('/findings');
  await it.getByText(`File-server restore not yet in DR plan ${stamp}`).click();
  await it.getByRole('button', { name: 'Plan corrective action' }).click();
  await dialog(it).locator('#ca-rc').fill('DR plan template omitted file shares');
  await dialog(it).locator('#ca-ca').fill('Add file-server restore steps to the DR plan and include in quarterly drill');
  const caOwner = await dialog(it).locator('#ca-owner option', { hasText: 'Divya Sundar' }).getAttribute('value');
  await dialog(it).locator('#ca-owner').selectOption(caOwner!);
  await dialog(it).getByRole('button', { name: 'Save' }).click();
  const caRow = it.getByRole('row', { name: /CA-\d{4}-\d{4}/ });
  await expect(caRow).toBeVisible();
  await caRow.click();
  await expect(it).toHaveURL(/corrective-actions\//);
  // Route transitions keep the previous page visible until the next one has loaded.
  await expect(it.getByRole('heading', { name: /Corrective action CA-/ })).toBeVisible();
  await it.getByRole('button', { name: 'Upload' }).click();
  await dialog(it).locator('[data-testid=file-input]').setInputFiles(pdf('dr-plan-v2'));
  await dialog(it).getByRole('button', { name: 'Upload' }).click();
  await expect(it.getByText('dr-plan-v2.pdf').first()).toBeVisible();
  await it.getByRole('button', { name: 'Submit for verification' }).click();
  await dialog(it).getByRole('textbox').fill('DR plan v2 approved; includes file-server restore.');
  await dialog(it).getByRole('button', { name: 'Submit' }).click();
  await expect(it.getByText('Awaiting verification').first()).toBeVisible();
  await shot(it, '09-corrective-action');

  // ── Auditor: verify closure and close the finding ──
  await auditor.goto(new URL(it.url()).pathname);
  await expect(auditor.getByRole('heading', { name: /Corrective action CA-/ })).toBeVisible();
  await auditor.getByRole('button', { name: 'Verify closure' }).click();
  await dialog(auditor).getByRole('button', { name: 'Verify' }).click();
  await expect(auditor.getByText('Verified', { exact: true }).first()).toBeVisible();
  await auditor.getByRole('link', { name: /Finding FND-/ }).click();
  await expect(auditor.getByRole('button', { name: 'Verify & close' })).toBeVisible();
  await auditor.getByRole('button', { name: 'Verify & close' }).click();
  await dialog(auditor).getByRole('textbox').fill('Updated DR plan reviewed; observation closed.');
  await dialog(auditor).getByRole('button', { name: 'Close finding' }).click();
  await expect(auditor.getByText('Verified / closed').first()).toBeVisible();
  await auditor.goto('/findings');
  await shot(auditor, '08-findings');

  // ── ISMS owner: approve → final PDF report ──
  await isms.goto(new URL(assessmentUrl).pathname);
  await isms.getByRole('button', { name: 'Approve & issue report' }).click();
  await dialog(isms).getByRole('button', { name: 'Approve' }).click();
  await expect(isms.getByText('Approved / closed').first()).toBeVisible();
  await isms.goto('/evidence');
  await expect(isms.getByText('restore-drill-q3.pdf').first()).toBeVisible();
  await shot(isms, '06-evidence-repository');
  await isms.goto('/reports');
  const row = isms.getByRole('row', { name: new RegExp(ASSESSMENT) });
  await expect(row).toBeVisible();
  await shot(isms, '10-reports');

  // The final PDF is served through a short-lived signed URL.
  const signed = await isms.evaluate(async (title) => {
    const token = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'X-Requested-With': 'axiarix' } }).then((r) => r.json() as Promise<{ data: { accessToken: string } }>);
    const auth = { Authorization: `Bearer ${token.data.accessToken}`, 'Content-Type': 'application/json' };
    const list = await fetch(`/api/v1/reports?search=${encodeURIComponent(title)}`, { headers: auth }).then((r) => r.json() as Promise<{ data: { id: string }[] }>);
    const url = await fetch(`/api/v1/reports/${list.data[0].id}/download-url`, { method: 'POST', headers: auth, body: '{}' }).then((r) => r.json() as Promise<{ data: { url: string } }>);
    const pdfRes = await fetch(url.data.url);
    const head = new TextDecoder().decode((await pdfRes.arrayBuffer()).slice(0, 5));
    return { status: pdfRes.status, type: pdfRes.headers.get('content-type'), head };
  }, ASSESSMENT);
  expect(signed).toEqual({ status: 200, type: 'application/pdf', head: '%PDF-' });
});

test('cross-branch user cannot open another branch assessment (AT-10 in the UI)', async ({ browser }) => {
  const isms = await loginAs(browser, 'isms@axiarix.local');
  await isms.goto('/assessments');
  await isms.getByText('ASM-2026-0001').click();
  const id = isms.url().split('/').pop()!;
  const other = await loginAs(browser, 'itowner.alwarpet@axiarix.local');
  await other.goto(`/my-assessments/${id}`);
  await expect(other.getByText(/outside your access scope/)).toBeVisible();
});
