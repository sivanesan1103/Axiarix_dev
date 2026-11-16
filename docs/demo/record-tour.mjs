// Full feature tour of Axiarix, recorded as video with on-screen captions.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '/Users/siva/amalraj sir/axiarix_demo/frontend/node_modules/playwright/index.mjs';

const BASE = 'http://localhost:5174';
const PW = 'Axiarix@Dev2026';
const OUT = process.argv[2];
const SAMPLE = '/Users/siva/amalraj sir/axiarix_demo/sample-org/01-organisation-setup.xlsx';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ slowMo: 250 });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } });
const p = await ctx.newPage();
const log = (...a) => console.log('·', ...a);

async function caption(text, ms = 2600) {
  await p.evaluate((t) => {
    let el = document.getElementById('__tour');
    if (!el) {
      el = document.createElement('div');
      el.id = '__tour';
      Object.assign(el.style, { position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)', zIndex: 2147483647, background: 'rgba(20,16,40,.92)', color: '#fff', font: '600 18px Inter, system-ui, sans-serif', padding: '14px 22px', borderRadius: '12px', maxWidth: '1100px', textAlign: 'center', boxShadow: '0 8px 30px rgba(0,0,0,.25)', pointerEvents: 'none' });
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
  await p.waitForTimeout(ms);
}
async function settle() {
  // Drop the previous caption so it never sits over the next screen.
  await p.evaluate(() => document.getElementById('__tour')?.remove()).catch(() => {});
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(500);
}
async function login(email, password = PW) {
  await p.context().clearCookies();
  await p.goto(BASE + '/login');
  await settle();
  await p.fill('#email', email);
  await p.fill('#password', password);
  await p.click('button[type=submit]');
  await p.waitForSelector('aside nav', { timeout: 15000 });
  await settle();
}
async function go(url) {
  await p.goto(BASE + url);
  await settle();
}

// ── 1. Sign in and roles ──
await go('/login');
await caption('Axiarix · ISO/IEC 27001:2022 compliance management · feature tour', 3000);

// ── 2. Platform owner: organisations + wizard ──
await login('platform@axiarix.local');
await caption('Platform owner: every organisation, with counts, administrators and status');
await p.click('text=New organisation');
await settle();
await caption('New organisation: 5 steps, or load everything from a setup workbook');
await p.setInputFiles('input[type=file][accept=".xlsx"] >> nth=0', SAMPLE);
await p.waitForSelector('text=Loaded 3 branches');
await caption('Loaded 3 branches, 5 departments and 14 users from sample-org/01-organisation-setup.xlsx');
await p.click('button:has-text("Next: Branches")');
await caption('Step 2: branches and departments, with department owners');
await p.click('button:has-text("Next: Users")');
await caption('Step 3: users with role, branch scope and per-user restricted permissions');
await p.click('button:has-text("Next: Checklist")');
await p.click('button:has-text("Next: Review")');
await settle();
await caption('Step 5: the server re-checks everything (Sunrise already exists, so it refuses a duplicate)', 3200);

// ── 3. Administrator ──
await login('admin@axiarix.local');
await go('/admin');
await caption('Admin Home: setup progress, people by role, and the rules the system enforces');
await go('/organisation');
await caption('Hospitals & Branches: branches, departments and their owners');
await go('/users');
await caption('Users & Access Control: roles with organisation, branch or department scope');
await p.click('button[aria-label="Actions for Rahul Varma"]');
await p.click('text=Restrict permissions');
await p.waitForSelector('text=Restrict permissions · Rahul Varma');
await p.click('[aria-label="finding:create"]');
await caption('Restrict permissions: remove one power from one person; their role stays the same', 3200);
await p.keyboard.press('Escape');
await settle();

// ── 4. ISMS owner: dashboard, scope, filters ──
await login('isms@axiarix.local');
await caption('Dashboard: compliance score, evidence coverage, findings and approvals');
await p.click('button[aria-label="Choose branch and period"]');
await settle();
await caption('Scope button: one branch and one period for the dashboard and every list');
await p.selectOption('#scope-site', { label: 'Vadapalani' });
const periods = await p.$$eval('#scope-period option', (o) => o.map((x) => x.value).filter(Boolean));
if (periods.length) await p.selectOption('#scope-period', periods[0]);
await p.keyboard.press('Escape');
await go('/assessments?status=ASSIGNED');
await caption('Filters show as chips, follow the Scope button, and are saved in the page link', 3200);
await p.click('text=Clear all');
await settle();

// ── 5. Checklist four-eyes review ──
await go('/checklists');
await caption('Checklist Library: import from Excel, versions, status filter on the current version');
await p.click('text=Kauvery Vadapalani IT – IA Checklist (Last Year)');
await settle();
await p.locator('a[href*="/versions/"]').first().click();
await settle();
const versionUrl = new URL(p.url()).pathname;
await caption('The author submitted it to a named reviewer, so the author cannot publish it', 3200);

await login('admin@axiarix.local');
await go(versionUrl);
await caption('The named reviewer: Publish stays off until every flagged ISO mapping is resolved', 3200);
const confirm = p.locator('button:has-text("Confirm as correct")').first();
if (await confirm.count()) {
  await confirm.click();
  await settle();
  await caption('Confirming a flagged mapping as correct (recorded in the audit trail)');
}
await p.click('button:has-text("Add review comment")');
await p.fill('#rc-body', 'Please check the scope of the uptime evidence for Q3.');
await caption('Review comments on the version or on a single question');
await p.click('[role=dialog] button:has-text("Add comment")');
await settle();
await caption('Open comments also block publishing until they are resolved or returned');

// ── 6. Assessment with period picker ──
await login('isms@axiarix.local');
await go('/assessments/new');
await caption('New assessment: period chosen from fixed Indian financial-year options, dates derived', 3200);

// ── 7. Department workspace ──
await login('itowner@axiarix.local');
await go('/my-assessments');
await caption('My Assessments: assessments and question assignments for this person');
await p.click('text=ASM-2026-0001');
await settle();
await caption('Workspace: answer, see previous audit observations, upload evidence, submit for audit', 3200);

// ── 8. Auditor ──
await login('auditor@axiarix.local');
await go('/auditor');
await caption('Auditor Workspace: review queue, evidence to verify, findings and actions to verify');
await go('/findings');
await caption('Findings: filters by status, severity, owner and overdue; export exactly the rows shown');

// ── 9. Reports and audit trail ──
await go('/reports');
await caption('Reports & Analytics: immutable, versioned final PDF reports and data exports');
await login('admin@axiarix.local');
await go('/audit-trail');
await caption('Audit Trail: append-only, hash-chained log of every security and business action');
await go('/settings');
await caption('Settings: per-organisation workflow, scoring, retention, notifications, reports and schedules', 3200);
await caption('End of tour · full guide in the Axiarix User Guide doc', 2500);

const video = p.video();
await ctx.close();
await browser.close();
const src = await video.path();
const dest = path.join(OUT, 'axiarix-feature-tour.webm');
fs.renameSync(src, dest);
log('video', dest, (fs.statSync(dest).size / 1e6).toFixed(1) + ' MB');
