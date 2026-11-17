# Axiarix – Project Progress & Running History

> Living log. Updated after each phase. Last update: **2026-11-17** (multi-organisation governance, task-flow fixes, BRD/SRS traceability check).
> On this machine Postgres runs on **5434** and the web on **5174** (5433/5173 belong to another project); see README.
> Source of truth: `../prompt.md`, BRD, SRS and the Kauvery Excel checklist in the parent folder.
> UI/UX theme reference: `../Screenshot 2026-11-13 at 3.52.31 PM.png` (white canvas, icon-rail sidebar, vivid indigo `#4B10F0`, lavender tints, green/amber accents, KPI strip, clean tables).
> Handwritten requirements note (`../WhatsApp Image …jpeg`) — 8 points, all covered: central checklist, periodic updates, quarterly IA, central evidence, unit-wise (branch) reports, auditor verification, final PDF after auditor update, dashboard + central report storage.

---

## 1. How to resume / run

```bash
cd axiarix
docker compose up -d                 # postgres :5433, minio :9002/:9003, mailpit :1025/:8025
cd backend
npx prisma migrate deploy            # 3 migrations applied
npx tsx prisma/seed.ts               # idempotent; imports the real Excel checklist
npx tsx src/server.ts                # API on http://localhost:5050/api/v1  (health: /api/v1/health)
cd ../frontend && npm run dev        # http://localhost:5173 (proxies /api -> :5050)
```

**Port change:** backend runs on **5050**, not 5000 — macOS AirPlay (ControlCenter) holds :5000.
**npm 11 note:** install scripts are blocked by default; approved: `@prisma/client @prisma/engines prisma esbuild` (`npm install-scripts approve …`).

Dev-only accounts (password `Axiarix@Dev2026`, fictitious people):

| Email | Role | Scope |
|---|---|---|
| admin@axiarix.local | System Administrator | Org-wide |
| isms@axiarix.local | ISMS / Compliance Owner | Org-wide |
| itowner@axiarix.local | IT Department Owner | Vadapalani / IT |
| contributor@axiarix.local | IT Control Owner | Vadapalani / IT |
| auditor@axiarix.local | Auditor | Org-wide |
| management@axiarix.local | Management Viewer | Org-wide |
| itowner.alwarpet@axiarix.local | IT Owner | Alwarpet (demo branch) — for cross-branch tests (AT-10) |

---

## 2. Phase status

| Phase | Status | Verified by |
|---|---|---|
| 1 Foundation & auth | ✅ Completed (MFA enforcement = prompt only) | auth.test.ts, E2E |
| 2 Org & checklist library | ✅ Completed | AT-01, AT-02, E2E |
| 3 Excel import & assessment engine | ✅ Completed | parser unit test, import test, AT-03…AT-05, AT-11 |
| 4 Evidence | ✅ Completed (ClamAV adapter untested) | AT-03, malware tests, AT-10 |
| 5 Auditor & findings | ✅ Completed | AT-06…AT-08, E2E |
| 6 Dashboard & PDF | ✅ Completed | AT-09, AT-12, PDF inspected |
| 7 Security/audit/admin | ✅ Completed (retention/schedules untested) | audit trigger + chain tests, Mailpit delivery |
| 8 Integration/testing | ✅ Completed | 50 backend + 11 frontend + 2 E2E tests pass; lint/tsc/builds clean; prod start verified |

See `FINAL_IMPLEMENTATION_REPORT.md` for traceability and outstanding work.

## 3. What exists (backend `axiarix/backend`)

- `prisma/schema.prisma` — ~35 models (all entities from prompt §1.3 plus RolePermission, RefreshToken, IsoReference, StatusHistory, AssessmentSubmission, CorrectiveActionUpdate, DeletionRequest, AssessmentSchedule, SystemSetting).
- Migrations: `init`, `integrity_triggers` (AuditEvent append-only; published ChecklistItem/ControlMapping immutable; Report content immutable), `iso_reference_id`.
- `src/modules/*`: auth, organisations, users(+roles), checklists, imports, assessments, reviews, evidence, findings(+corrective actions), reports(+pdf), dashboard, audit-logs, notifications, admin (settings, scoring policies, retention, deletion requests, schedules, reminders).
- `src/services/*`: audit (hash chain + verify), scope (org/site/dept boundaries, DENIED audit), compliance (scoring + coverage), storage (S3/local), malware (builtin EICAR/PE/ELF/shebang heuristics or ClamAV INSTREAM), notification (in-app + SMTP via Mailpit, never throws), settings (typed, + atomic code counters), download-token (5-min signed URLs), workflow (status history).
- `src/constants/iso27001.ts` — clauses 4–10 + all 93 Annex A controls; `permissions.ts` — RBAC matrix for the 6 roles × 10 actions × 13 resources.
- `src/seed/seed-lib.ts` + `prisma/seed.ts` — imports the real workbook via the real import pipeline; publishes "Internal Audit -Checklist (2)" (mapping warnings acknowledged with recorded reason); creates demo assessment **ASM-2026-0001** (Q3 FY2026-27) released and 12 items assigned to contributor. **No responses/evidence/observations invented.**

## 4. What exists (frontend `axiarix/frontend`)

- Vite 7 + React 19 + TS strict + Tailwind v4 + Radix (shadcn-style) + TanStack Query + RHF + Zod + Recharts 2 + sonner.
- Done: config, design tokens (`src/index.css`), `lib/utils.ts`, `constants/status.ts`, UI primitives (`components/ui/*`), `api/client.ts` (in-memory access token, single-flight refresh), `types/api.ts`, all `services/*.service.ts`.
- All screens built: Login/Forgot/Reset, Dashboard, Hospitals & Branches, Users & Access (+permission matrix), Checklist Library (+editor, import wizard, history), Assessment Periods (+new, detail), My Assessments + shared Workspace (IT respond / auditor review), Evidence Repository (+drawer, preview), Auditor Workspace, Findings, Corrective Actions, Reports & Analytics, Audit Trail, Settings (profile/MFA, workflow, scoring, retention, notifications, report config, schedules).
- Global search endpoint `GET /api/v1/search` added.

---

## 5. Key decisions & assumptions (document in final report)

1. **Ambiguous ISO mappings are flagged, never silently changed.** Rows 47–75 of both sheets put Annex A numbers in the "Clauses" column; those mappings get `needsReview=true`. Codes valid as both clause and control with an empty Controls column (e.g. row 75 "7.3, 7.5") are also flagged. 29 items per sheet flagged. Publishing requires review or an explicit acknowledgement with reason (audited).
2. Source auditor observations (Strengths, OFI, Observations, Closure, Remarks, Remarks observed on 05112026) are preserved verbatim in `ImportedChecklistRow.rawData` and shown to auditors as "previous observations" — not converted into findings automatically.
3. Scoring policy v1 = SRS proposal (C=1, PC=0.5, NC=0; N/A excluded; Not Assessed kept in denominator scoring 0). Marked as open stakeholder decision. Policies are versioned; assessments pin their policy; reports freeze metrics.
4. Retention default 7 years / ARCHIVE — placeholder pending hospital policy.
5. Approval step configurable (`workflow.policy.approvalRequiredByDefault=true`; per-assessment flag). If off, auditor review → "Finalise".
6. During clarification only flagged items are editable. Submitted assessments are locked (409 `ASSESSMENT_LOCKED`, audited) until formally reopened.
7. Infected uploads are never stored; scanner failures are stored but not downloadable.
8. Permissions are the union of a user's roles; scope is the union of role scopes (simplification documented).
9. "Alwarpet (demo branch)" is demo data only, to exercise branch comparison and cross-branch denial.
10. Routes files contain thin controller handlers; business logic lives in services. Prisma acts as the repository layer.

## 6. Open stakeholder decisions (from SRS §13)

Hosting, identity/SSO & MFA enforcement, exact quarterly calendar, checklist/SoA approver, evidence storage & size limits & retention, approval workflow, branches in scope, scoring formula, SLAs/RPO/RTO, report branding & sign-off fields.

---

## 7. Running history

- **S1 – 2026-11-13**
  - Read prompt.md, BRD, SRS, Excel (both sheets), screenshot theme, handwritten note.
  - Started Docker infra (postgres/minio/mailpit), chose non-conflicting ports.
  - Built full backend (Phases 1–7 API), migrations with integrity triggers, seed with real workbook import. Fixed: JSONB key-order in audit hashing (stable stringify), IsoReference PK collision (clause 5.1 vs A.5.1), report code uniqueness per version, Prisma filter overwrites in list endpoints, ambiguous clause/control detection.
  - Backend type-check clean; smoke test passed.
  - Frontend scaffold + design system + API layer written. Now building contexts, layout and pages.

- **S1 (continued) – 2026-11-13**
  - Built all frontend screens per the screenshot theme; verified rendering with headless Playwright (Chrome extension not connected).
  - Fixed: empty filter params → 422; Radix tooltip Slot dropping NavLink classes; preview iframe → blob URL; report heading orphan; policy weights in the PDF scoring line; made the auth rate limit configurable (`AUTH_RATE_LIMIT`).
  - Implemented the previously inert "Auditor acceptance of N/A" rule (default off) with an item-level "Accept answer" action and a test.
  - Tests: backend 50/50, frontend unit 11/11, Playwright E2E 2/2 (full workflow + cross-branch denial). Lint and tsc clean; builds OK; production start verified; 38 notification e-mails observed in Mailpit.
  - Docs written: README, docs/{ARCHITECTURE, DATABASE, API_DOCUMENTATION, ROLE_PERMISSIONS, TESTING, DEPLOYMENT, USER_GUIDE}.md, FINAL_IMPLEMENTATION_REPORT.md; 10 real screenshots in docs/screenshots.
  - Added per-account dev addresses (`<name>.localhost:5173`) with `?email=` prefill so several accounts can be signed in side by side in one Chrome profile.
  - Added dark mode (Light / Dark / System): token remap, top-bar toggle, Settings → Appearance, pre-paint script, themed charts and toasts. Verified in a dark render; frontend unit 11/11; E2E 2/2 in 3 of 4 runs (one intermittent visibility timeout).
  - Not done automatically: dev DB reset (Prisma requires explicit user consent) – dev DB still contains "E2E" records; run `cd backend && npm run db:reset` to restore clean demo data.

- **S2 – 2026-11-16**
  - Full dev DB reset (with consent). Added several organisations per installation (platform owner, wizard, setup workbook), per-user restrictions, branch administrators and separation of duties; per-organisation settings and roles (migration `multi_org_restrictions_review`).
  - UI: grouped sidebar, Scope button, URL filters, Admin Home, period pickers, checklist review with named reviewer and comments.
  - Created Meridian Diagnostics (Sample) through the wizard in Chrome; 9 users accepted invitations; fixed 5 bugs found during onboarding.
  - Fixed review and task flow: every answer and file needs a decision; assignees limited to the record's department; Change owner; Pending tasks for every role; finding owners plan actions; restricted buttons hidden; dialog buttons visible on short screens. Whole workflow run in Chrome with five Meridian users.
  - Pushed to GitHub (`main`, then branch `fix/task-flow-and-audit-review`).

- **S3 – 2026-11-17**
  - Checked every BRD and SRS requirement against the app: `docs/REQUIREMENTS_TRACEABILITY.md`.
  - Closed three gaps: checklist question search (FR-027), dashboard department filter and comparison (FR-021), configurable display time zone for screens and PDF (SRS 2.3, NFR-10). New `backend/tests/requirements.test.ts`.
  - Updated API, roles, database, architecture, testing, short user guide and final report docs.
  - Tests: backend 69/69, frontend 11/11, E2E 2/2.
  - Later the same day: checked untested workflow branches (`flows.test.ts`, 9 tests). Fixed deletion requests leaking across organisations (migration `deletion_request_organisation`) and a production proxy setting that would have made all users share one rate limit (`TRUST_PROXY`, `API_RATE_LIMIT`). Added enforced MFA for privileged roles (with a guard so an administrator cannot lock themselves out) and a load test (`npm run test:load`: 50 users p95 104 ms). Tests: backend 78/78, frontend 11/11, E2E 2/2.
  - Real-time updates (Server-Sent Events): every open screen refreshes the affected data about a second after anyone saves a change; Live indicator in the top bar. Fixed along the way: refresh bursts could hit the per-address rate limit when many users share one address (tab-own changes skipped, background tabs refresh on return, bursts combined, 429 on renewal retried, higher limit in development, rate-limited requests now logged). E2E made independent of list length. Tests: backend 81/81, frontend 11/11, E2E 2/2 (twice).
  - Flow bug hunt: opened every page as all 17 Kauvery/Meridian accounts plus the platform owner (387 pages) and at phone width (147 pages). Fixed: checklist, finding and corrective-action detail pages scrolled sideways on phones (single-column layouts sized to their tables); refusal and not-found screens now say so and offer "Go back" instead of a useless "Try again". New UI browser tests (`flows.spec.ts`) for clarification round, rejected approval, reopen and returned corrective action — all pass. Tests: backend 81, frontend 11, E2E 4/4 (twice).
