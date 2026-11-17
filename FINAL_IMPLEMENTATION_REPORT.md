# Final Implementation Report – Axiarix ISO/IEC 27001:2022 Compliance Management System

Hospital IT pilot · Kauvery Hospitals Group – Vadapalani – IT & IT Data Centre · Report date 2026-11-13

All results below were produced by commands executed on the local development stack in this session. Nothing is marked complete without a test or a verified run, and limitations are stated explicitly in section G.

## Update – 17 November 2026

Since this report was first written (13 November), the following has been added and checked. The full, current requirement-by-requirement check against the BRD and SRS is [docs/REQUIREMENTS_TRACEABILITY.md](docs/REQUIREMENTS_TRACEABILITY.md); where it differs from section C below, the traceability document is current.

- **Several organisations per installation** with a platform owner, a 5-step creation wizard and Excel setup workbook; suspend and reactivate.
- **Governance:** per-user permission restrictions; branch-scoped administrators; nobody changes their own access; separation of duties (named checklist reviewer, preparers cannot audit, preparers and auditors cannot approve, action owners cannot verify).
- **Task flow:** work can only be given to people in the record's branch and department; **Change owner** for open assessments; Pending tasks cover every kind of work; finding owners of any role plan corrective actions.
- **Audit review:** every answer and evidence file needs a decision before the review can be submitted; accepting a file does not accept the answer.
- **Requirement gaps closed on 17 Nov:** search covers checklist questions (FR-027); dashboard department filter and per-department comparison (FR-021, BRD §9); configurable display time zone used on screens and in PDF reports (SRS 2.3, NFR-10).
- **Tests now:** backend 69 passed (5 files), frontend unit 11, Playwright 2 (run twice); lint and type checks clean. Whole workflow run by hand in Chrome with five users of a second organisation (Meridian Diagnostics).
- **NFR-01 measurement:** 12,133 API reads on the local server — median 12 ms, 95th percentile 49 ms, slowest 753 ms.

---

## A. Development summary

| Item | Detail |
|---|---|
| Architecture | Separate React SPA and Express REST API (`/api/v1`) on one origin; PostgreSQL via Prisma; S3-compatible private object storage; SMTP; server-side PDF/XLSX/CSV. See `docs/ARCHITECTURE.md`. |
| Frontend | React 19, TypeScript (strict), Vite 7, React Router 7, Tailwind CSS 4, shadcn-style Radix components, Lucide, Recharts, TanStack Query, React Hook Form, Zod, Axios, sonner. 55 source files / ~9.1k lines. |
| Backend | Node.js, Express 5, TypeScript (strict), Zod, JWT + rotating refresh tokens, bcrypt, Helmet, CORS, express-rate-limit, multer, ExcelJS, pdfkit, nodemailer, AWS S3 SDK. 51 source files / ~6.8k lines. |
| Database | PostgreSQL 16, Prisma 6, 37 models, 3 migrations including integrity triggers. See `docs/DATABASE.md`. |
| Infra (dev) | `docker-compose.yml`: Postgres (:5433), MinIO (:9002/:9003), Mailpit (:1025/:8025). Production: `backend/Dockerfile`, `frontend/Dockerfile` + `nginx.conf`. |
| Modules | auth, organisations, users/roles, checklists, Excel import, assessments, reviews, evidence, findings, corrective actions, reports, dashboard, audit logs, notifications, admin (settings, scoring, retention, deletion, schedules), search |
| API | 100+ endpoints, consistent `{ data, meta }` / `{ error }` envelopes, Zod validation, central error handler. See `docs/API_DOCUMENTATION.md`. |
| UI/UX | Matches the provided reference screen (white canvas, indigo `#4B10F0` icon-rail sidebar, top bar with search, site and period selectors, KPI strip, indigo/lavender charts, grey-header tables). Every screen has loading, empty and error states, toasts, confirmation dialogs (with mandatory reasons for controlled actions), filters, search and pagination. |

## B. Module completion

| Module | Status | Evidence |
|---|---|---|
| Project foundation (monorepo, configs, Docker) | Completed | Builds and runs; `docs/DEPLOYMENT.md` |
| Authentication (login, logout, refresh rotation, expiry, reset, lock-out) | Completed | `auth.test.ts` (11 tests) |
| MFA (TOTP) | Partially completed | Setup/enable/disable/login verified by unit vector + UI; enforcement is a sign-in prompt, not a hard block |
| RBAC + organisation/site/department scope | Completed | `auth.test.ts` RBAC tests, AT-10 |
| Organisation, branch, department management | Completed | AT-01, UI screenshot |
| User administration (invite, roles with scope, deactivate) | Completed | AT-01, deactivation test |
| Checklist library (CRUD, editor, reorder, mapping, search/filter) | Completed | AT-02, E2E |
| Checklist versioning (Draft → Review → Published → Archived, immutability) | Completed | AT-02 (service + DB trigger), E2E |
| ISO 27001:2022 mapping (clauses 4–10, Annex A 5–8, policy, risk) | Completed | Unit tests, AT-02 invalid reference rejected |
| Kauvery Excel import (both worksheets, column mapping, preview, validation, duplicates, history, error report) | Completed | Unit parser test, workflow import test |
| Assessment management and assignments | Completed | AT-02, AT-03 |
| Assessment lifecycle incl. clarification, approval, reopen | Completed | AT-04, 05, 06, 09, 11 |
| Evidence repository (upload, validation, checksum, versioning, private storage, signed downloads, preview) | Completed | AT-03, AT-06, AT-10, malware tests, E2E |
| Malware scanning | Partially completed | Built-in scanner tested (EICAR, PE/ELF, scripts); ClamAV adapter implemented but not tested against a real clamd |
| Auditor workspace and review | Completed | AT-06, E2E |
| Findings | Completed | AT-07, AT-08, E2E |
| Corrective actions | Completed | AT-07, AT-08, E2E |
| Dashboard and analytics (live) | Completed | AT-07, AT-12 reconciliation |
| PDF reporting and report repository (versioned, immutable) | Completed | AT-09, E2E PDF download, visual check |
| CSV/XLSX exports | Completed | Export test (formula-injection protection); findings/actions/audit/checklist exports implemented |
| Audit trail (append-only, hash-chained, export, verify) | Completed | `auth.test.ts` trigger + chain tests; workflow chain check |
| Notifications (in-app + SMTP, reminders) | Completed | AT-06 notification assertion; 38 e-mails delivered to Mailpit during runs |
| Retention and secure deletion (two-person rule) | Partially completed | Implemented with UI; no automated test |
| Assessment schedules | Partially completed | Implemented with UI; no automated test |
| System administration screens | Completed | Settings tabs; N/A-acceptance rule tested |
| Global search | Partially completed | Implemented; no automated test |
| Unit, integration and E2E tests | Completed | Section D |
| Documentation | Completed | README, docs/*, this report |
| Development seed data | Completed | Real workbook import; no invented evidence |

## C. Requirements traceability

### Business requirements

| BRD | SRS | Frontend | Backend API / service | Entities | Tests | Result |
|---|---|---|---|---|---|---|
| BR-01 Central checklist library | FR-005, FR-006 | ChecklistsPage, ChecklistEditorPage, ImportWizardPage | `/checklists`, `/imports`; checklists.service, imports.service | ChecklistTemplate, ChecklistItem, ControlMapping, ImportedChecklist(Row) | AT-02, import test, unit parser | Pass |
| BR-02 Version control; no silent change | FR-007 | ChecklistDetailPage, editor lock banner | transitionVersion, createNewVersion; DB trigger | ChecklistVersion | AT-02 (409 + trigger), AT-11 | Pass |
| BR-03 Periodic (quarterly) assessments | FR-008 | NewAssessmentPage (FY quarter default), Settings → Schedules | `/assessments`, `/admin/schedules` | Assessment, AssessmentSchedule | AT-02 | Pass (schedules untested) |
| BR-04 Evidence per item, central repository | FR-010, FR-011 | WorkspacePage, EvidencePage | `/evidence`; evidence.service, storage | Evidence, EvidenceVersion | AT-03, malware tests, E2E | Pass |
| BR-05 Auditor verify / clarify / findings | FR-014, FR-015 | AuditorPage, AuditorReviewPage, FindingDialog | reviews.service, `/findings` | AuditorReview, ReviewComment, Finding | AT-06, AT-07, E2E | Pass |
| BR-06 Corrective actions with closure evidence | FR-016, FR-017 | FindingDetailPage, ActionDetailPage | findings.service (actions) | CorrectiveAction, CorrectiveActionUpdate | AT-08, E2E | Pass |
| BR-07 Final PDF after review/approval | FR-022 | AssessmentDetailPage, ReportsPage | decideApproval, generateFinalReport | Approval, Report | AT-09, E2E | Pass |
| BR-08 Dashboards | FR-020, FR-021 | DashboardPage, AuditorPage | `/dashboard/summary`, `/dashboard/tasks` | (aggregates) | AT-07, AT-12 | Pass |
| BR-09 Consolidated and branch-wise | FR-021 | Site selector, branch comparison | dashboard scope and site filter | Site | AT-12, AT-10 | Pass |
| BR-10 Auditable history | FR-018, FR-025 | AuditTrailPage, timelines | audit.service, StatusHistory | AuditEvent, StatusHistory, AssessmentSubmission | Audit chain tests, AT-11 | Pass |
| BR-11 Export of reports and data | FR-023, FR-024 | Export menus, ReportsPage | export endpoints, signed report download | Report | Export test, AT-09 | Pass |

### Functional requirements

| SRS | Requirement | Implementation | Test | Result |
|---|---|---|---|---|
| FR-001 | Authenticate before protected functions | `authenticate` middleware, login | auth tests | Pass |
| FR-002 | RBAC with org/site/department scope | `requirePermission`, scope.service | RBAC tests, AT-10 | Pass |
| FR-003 | Create, invite, deactivate, assign roles | users routes, UsersPage | AT-01, deactivation test | Pass |
| FR-004 | Configure hospital, branches, departments | organisations routes, OrganisationPage | AT-01 | Pass |
| FR-005 | Checklist templates and questions | checklists.service, editor | AT-02 | Pass |
| FR-006 | ISO clause / Annex A / policy / risk mapping | ControlMapping, validateMappings | AT-02, unit | Pass |
| FR-007 | Immutable published versions | service + trigger | AT-02 | Pass |
| FR-008 | Assessment periods per department/site | createAssessment | AT-02 | Pass |
| FR-009 | Save responses with statuses, comments, justifications | saveResponse | AT-03, AT-04 | Pass |
| FR-010 | Upload permitted file types, link to item or finding | evidence upload | AT-03, AT-08, malware tests | Pass |
| FR-011 | Evidence metadata | EvidenceVersion | AT-03 | Pass |
| FR-012 | Submission validation | validateForSubmission | AT-04 | Pass |
| FR-013 | Department owner submits | submitAssessment | AT-05 | Pass |
| FR-014 | Auditor accept/reject/clarify/comment | reviewItem, submitReview | AT-06 | Pass |
| FR-015 | Findings with category, severity, owner, due | createFinding | AT-07 | Pass |
| FR-016 | Corrective action RCA, correction, target, progress | createAction, addProgress | AT-07, AT-08 | Pass |
| FR-017 | Closure verification (accept/return) | verifyAction, closeFinding | AT-08 | Pass |
| FR-018 | Lifecycle statuses with timestamps and actors | StatusHistory | AT-11 history check | Pass |
| FR-019 | Notifications | notification.service, reminders | AT-06; Mailpit delivery observed | Pass |
| FR-020 | Dashboard | dashboard routes | AT-07, AT-12 | Pass |
| FR-021 | Filters by period, site, department, clause, status | dashboard and list filters; dashboard department filter and per-department comparison added 17 Nov | AT-12; `requirements.test › FR-021` | Pass |
| FR-022 | Final PDF after approval | generateFinalReport | AT-09 | Pass |
| FR-023 | Central report repository | `/reports`, ReportsPage | AT-09 | Pass |
| FR-024 | CSV/XLSX export | export endpoints | Export test | Pass |
| FR-025 | Audit log of critical actions | recordAudit across services | audit tests | Pass |
| FR-026 | Reopen with mandatory reason and audit | reopen | AT-11 | Pass |
| FR-027 | Search within access scope | `/search` (incl. checklist questions since 17 Nov), list searches | `requirements.test › FR-027` | Pass |
| FR-028 | Retention and archival rules | admin.service applyRetention, deletion workflow | Not automated | Implemented, untested |

### Non-functional and security requirements

| ID | Implementation | Verification | Result |
|---|---|---|---|
| NFR-SEC-01 HTTPS | HSTS in production, `COOKIE_SECURE`, TLS at ingress (DEPLOYMENT.md) | Production header check (HSTS present) | Configured; TLS is deployment-time |
| NFR-SEC-02 No plaintext secrets | bcrypt passwords; hashed refresh/reset tokens; AES-GCM MFA secrets; env secrets | Unit (AES), auth tests | Pass |
| NFR-SEC-03 Least privilege, server-side authorisation | RBAC matrix, scope checks on every record and file | RBAC tests, AT-10 | Pass |
| NFR-SEC-04 MFA for privileged users | TOTP; enforcement prompt | Unit TOTP vector | Partial (no hard block) |
| NFR-SEC-05 Encryption at rest | S3 SSE (AES256 on AWS); DB/bucket encryption is infrastructure | — | Deployment-time |
| NFR-SEC-06 Tamper-resistant logs | Append-only trigger + hash chain + export | Audit tests | Pass |
| NFR-SEC-07 Upload validation and scanning | Allow-list, signature, size, executables, scan before storage | Unit + malware tests | Pass (built-in scanner) |
| NFR-SEC-08 Sessions, CSRF, validation, encoding | Short JWT, rotation, SameSite=Strict + CSRF header, Zod, React output encoding, CSV neutralisation, Prisma parameterisation | Auth tests, export test | Pass |
| NFR-SEC-09 Backup and restore | Documented procedures | Not executed | Documented only |
| NFR-SEC-10 Admin access recorded | All admin actions audited | Audit tests | Pass (DB access is infra) |
| NFR-SEC-11 Retention and secure deletion | Policies + two-person deletion | Not automated | Implemented, untested |
| NFR-SEC-12 No PHI as evidence | Upload dialog warning; classification field | — | Guidance only |
| NFR-01 Performance | Indexed queries; code-split SPA | 17 Nov: 12,133 local API reads, p95 49 ms, max 753 ms | Measured locally; not load-tested |
| NFR-03 Scalability | Multi-site/department data model | AT-01, AT-12 | Pass |
| NFR-04 Usability | Guided workspace, inline validation, jump-to-missing on submit | E2E | Pass |
| NFR-05 Compatibility | Chromium verified | E2E (Chromium only) | Partial |
| NFR-08 Auditability | Every transition attributed to user and time | AT-11, audit tests | Pass |
| NFR-09 Accessibility | Labels, keyboard-operable Radix controls, focus rings, radio-group semantics, contrast tokens | Component tests use accessible queries | Partial (no formal audit) |
| NFR-10 Localisation | English; organisation time zone in Settings → Regional settings (since 17 Nov), used by screens and PDF | `requirements.test › NFR-10` | Pass |

## D. Test results (executed 2026-11-13)

| Check | Result |
|---|---|
| Total automated tests | **63 passed**, 0 failed, 0 skipped |
| Backend (Vitest + Supertest) | 50 passed (unit 17, auth/RBAC/audit 17, workflow AT-01…AT-12 16) |
| Frontend unit (Vitest + RTL) | 11 passed |
| E2E (Playwright, Chromium) | 2 passed (full workflow across 4 roles; cross-branch denial). After the dark-mode change: 3 of 4 runs fully green; one run hit an intermittent visibility timeout in the long workflow test (not reproduced in 3 re-runs) |
| TypeScript | Backend `tsc --noEmit`: 0 errors · Frontend `tsc -b`: 0 errors |
| Lint | Backend ESLint: 0 problems · Frontend ESLint: 0 problems |
| Frontend build | Success (`vite build`, code-split) |
| Backend build | Success (`tsc`); production start verified (`node dist/server.js`, health 200, HSTS/CSP present) |
| Database | `prisma validate` OK; `prisma migrate status`: up to date (3 migrations) |
| Browser verification | Real UI driven by Playwright; screenshots captured; generated PDF opened and inspected; notification e-mails observed in Mailpit |

## E. Application access

| | |
|---|---|
| Frontend | http://localhost:5173 |
| Backend | http://localhost:5050 (5000 is occupied by macOS AirPlay – documented change) |
| API health | http://localhost:5050/api/v1/health |
| Dev mail inbox / object storage | http://localhost:8025 · http://localhost:9003 |
| Development start | `docker compose up -d` → `cd backend && npx prisma migrate deploy && npm run db:seed && npm run dev` → `cd frontend && npm run dev` |
| Production start | `docker build` both images (see DEPLOYMENT.md) or `npm run build && npx prisma migrate deploy && npm start` (API) and serve `frontend/dist` behind a proxy for `/api` |
| Database setup | PostgreSQL 16; `DATABASE_URL`; `npx prisma migrate deploy` |
| Demo accounts | admin@, isms@, itowner@, contributor@, auditor@, management@, itowner.alwarpet@ `axiarix.local` – development password documented in README (fictitious users; never use in production) |
| Required environment variables | See `.env.example` (DATABASE_URL, JWT/download/MFA secrets, S3_*, SMTP_*, FRONTEND_ORIGIN, COOKIE_SECURE, MALWARE_SCANNER) |

## F. Screenshots (real application, captured by Playwright)

`docs/screenshots/`: `01-login`, `02-dashboard`, `03-checklist-library`, `04-checklist-editor`, `05-assessment-workspace`, `06-evidence-repository`, `07-auditor-workspace`, `08-findings`, `09-corrective-action`, `10-reports`. They show records created by the E2E run (named "E2E …") alongside the imported Kauvery checklist.

## G. Outstanding work

**Missing or partial functionality**
- MFA enforcement for privileged roles is a prompt at sign-in, not a hard block until enrolment.
- Retention runs, secure deletion and assessment schedules are implemented but have no automated tests (global search is now tested).
- The ClamAV adapter has not been exercised against a running clamd; only the built-in heuristic scanner is verified. The built-in scanner is not a substitute for an AV engine in production.
- Permissions are the union across a user's roles (not per scope); see ROLE_PERMISSIONS.md.
- SSO (SAML/OIDC) is not implemented; out of scope until the hospital confirms its identity provider.
- No load/performance test (NFR-01) and E2E covers Chromium only (NFR-05: Edge/Firefox untested).
- Frontend unit tests cover shared components and helpers; page-level behaviour is covered by E2E rather than unit tests.

**Known issues / data notes**
- The local development database contains records created by E2E runs (prefixed "E2E"). Reset with `cd backend && npm run db:reset` (destroys development data only, then re-seeds). The reset was not run automatically because Prisma requires explicit user consent for destructive resets run by an AI agent.
- Objects uploaded during E2E runs remain in the MinIO dev bucket after a database reset (harmless orphans in development).

**External services not configured**
- Production SMTP relay, ClamAV, production object storage with SSE and versioning, TLS certificates, secrets manager, backup tooling.

**Stakeholder decisions pending (SRS §13)**
- Hosting and data residency; identity/SSO and mandatory MFA; exact quarterly calendar and reminders; who approves the checklist and SoA mapping, **including review of the 29 import-flagged mappings per worksheet** (the demo seed acknowledged them for development only); evidence repository, size limit, formats and retention period (placeholders: 25 MB, 7 years); whether ISMS approval is required in addition to auditor review (default: required); branches in scope (an *Alwarpet (demo branch)* exists only for demonstration); scoring formula and N/A / Not Assessed treatment (default v1: N/A excluded, Not Assessed counted as 0); SLAs, RPO/RTO; report branding and sign-off fields.

**Security items to complete before production**
- Enable TLS and `COOKIE_SECURE=true`; enable encryption at rest for the database and bucket; deploy ClamAV; move secrets to a secrets manager; configure backups and perform a restore test; enable MFA enforcement and enrol privileged users; archive audit-log exports to protected storage.

**Deployment limitations**
- Docker images are defined but were not built or run in this session (local Node.js production start was verified instead).
- The in-process reminder scheduler assumes a single API instance; move it to a scheduled job if the API is scaled out.
