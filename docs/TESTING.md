# Testing

## Suites

| Suite | Tool | Location | What it covers |
|---|---|---|---|
| Backend unit | Vitest | `backend/tests/unit.test.ts` | ISO catalogue completeness; Clauses/Controls parsing incl. ambiguous-mapping flags; scoring rules; evidence coverage; file validation (signature, double extension, size, traversal); AES-GCM; RFC 6238 TOTP vector; parsing the real Kauvery workbook (both layouts, 75 rows each, verbatim cells) |
| Backend integration – security | Vitest + Supertest | `backend/tests/auth.test.ts` | Health; 401 without token; login failure audit and no user enumeration; cookie flags; refresh rotation and reuse detection; CSRF header; tampered token; lock-out; forgot/reset password; logout; immediate deactivation; RBAC denials (audited); admin protection; append-only audit trigger; hash-chain verification |
| Backend integration – governance | Vitest + Supertest | `backend/tests/governance.test.ts` | Platform owner creates an organisation from the setup workbook; organisations kept apart; per-user restrictions; branch administrators; separation of duties for checklists and assessments; assignees limited to the record's department; Change owner; reviewer list and comment resolution |
| Backend integration – requirements | Vitest + Supertest | `backend/tests/requirements.test.ts` | SRS items outside AT-01 … AT-12: checklist question search (FR-027), display time zone (SRS 2.3, NFR-10), repeated submission accepted once (SRS §10), department filter and breakdown (FR-021) |
| Backend integration – flows | Vitest + Supertest | `backend/tests/flows.test.ts` | Branches outside the main path: approval rejected and re-approved, finalise without approval, closure evidence returned and fixed, checklist returned to draft, unassigning, retention → two-person deletion kept inside one organisation, schedules, enforced MFA (blocked until enrolled; cannot switch off; admin must enrol before enabling) |
| Backend integration – real time | Vitest + live HTTP server | `backend/tests/realtime.test.ts` | Stream requires sign-in; changes reach the organisation only (another organisation hears nothing); only area and ids are sent; notifications and access changes reach the right user |
| End-to-end – flows | Playwright (Chromium) | `frontend/tests/e2e/flows.spec.ts` | Through the UI: evidence rejected → clarification → new version → re-submitted → accepted; approval rejected → review revised → approved; formal reopen; corrective action returned → owner fixes → verified → finding closed |
| Load (NFR-01) | Node script | `backend/scripts/load-test.mjs` (`npm run test:load`) | Simultaneous users load the API behind the main pages; reports p50/p95/p99 and whether 95 % finish under 3 s |
| Backend integration – workflow | Vitest + Supertest | `backend/tests/workflow.test.ts` | AT-01 … AT-12 (every answer and file needs an auditor decision; a contributor who owns a finding plans its action), Excel import incl. duplicate detection, published-version immutability (service and DB trigger), malware/executable/disguised upload rejection, N/A acceptance rule, report immutability, CSV formula-injection protection, audit chain after the full workflow |
| Frontend unit | Vitest + React Testing Library | `frontend/tests/unit` | Formatting helpers, empty-param cleaning, password policy, status badges, confirm dialog mandatory reason and error display, lifecycle stepper conditional stages, mapping chips |
| End-to-end | Playwright (Chromium) | `frontend/tests/e2e/workflow.spec.ts` | Full UI workflow across four roles: create and publish checklist → create and release assessment → answer and upload evidence → submit → auditor review, accept evidence and answer, raise finding → plan corrective action with closure evidence → verify and close → approve → final PDF via signed URL; cross-branch denial in the UI. Captures `docs/screenshots/*` |

## Running

```bash
# Backend (needs docker compose services; uses database axiarix_test)
# On this machine Postgres runs on port 5434:
#   export TEST_DATABASE_URL='postgresql://axiarix:axiarix_dev_only@localhost:5434/axiarix_test?schema=public'
cd backend
npm run lint && npx tsc --noEmit && npm test && npm run build
npx prisma validate && npx prisma migrate status

# Frontend
cd frontend
npm run lint && npm run typecheck && npm test && npm run build

# Load test (run the API with a high API_RATE_LIMIT, or from several machines, since one address is rate-limited)
# PASSWORD='<test password>' CONCURRENCY=50 DURATION=30 npm run test:load

# End-to-end (dev API on :5050 and web running, dev database seeded; on this machine the web runs on :5174)
# E2E_BASE_URL=http://localhost:5174 npm run test:e2e
npx playwright install chromium   # first time only
npm run test:e2e
```

The E2E test creates uniquely named records (`E2E … <stamp>`) in the development database. Reset afterwards with `npm run db:reset` in `backend/` (destroys development data only).

## Acceptance scenario mapping

| ID | Scenario | Test |
|---|---|---|
| AT-01 | Admin creates hospital site, IT department, scoped users | `workflow.test.ts › AT-01` |
| AT-02 | Publish checklist v1 and create an assessment linked to it | `workflow.test.ts › AT-02`; E2E |
| AT-03 | IT user answers and uploads evidence; metadata saved and visible | `workflow.test.ts › AT-03`; E2E |
| AT-04 | Submission with missing mandatory answers blocked, gaps listed | `workflow.test.ts › AT-04` |
| AT-05 | Complete submission moves to audit and is protected | `workflow.test.ts › AT-05`; E2E |
| AT-06 | Auditor rejects evidence, requests clarification, owner notified | `workflow.test.ts › AT-06` |
| AT-07 | Finding raised, corrective action assigned, visible on dashboard | `workflow.test.ts › AT-07`; E2E |
| AT-08 | Closure evidence submitted; closed only after authorised verification | `workflow.test.ts › AT-08`; E2E |
| AT-09 | Approval generates and stores the final PDF | `workflow.test.ts › AT-09`; E2E |
| AT-10 | Cross-branch evidence access denied and logged | `workflow.test.ts › AT-10`; E2E (UI) |
| AT-11 | Edits after submission blocked unless reopened; history retained | `workflow.test.ts › AT-11` |
| AT-12 | Dashboard filtered by period and site reconciles with records | `workflow.test.ts › AT-12` |

## Requirements traceability

Every BRD and SRS requirement is mapped to code, tests and results in [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md).

## Latest results (2026-11-17, executed locally)

| Check | Result |
|---|---|
| Backend tests | **81 passed**, 0 failed, 0 skipped (7 files) |
| Load test (50 users, 30 s) | 23,849 requests, 0 errors, p95 104 ms, max 328 ms (200 users: p95 424 ms) |
| Frontend unit tests | **11 passed**, 0 failed |
| Playwright E2E | **4 passed**, 0 failed (run twice) |
| Page sweep | Every page opened as each of 17 accounts at desktop width (387 pages) and 6 accounts at phone width (147 pages): no console errors, no server errors, no sideways scrolling |
| Backend ESLint / `tsc --noEmit` | 0 errors / 0 errors |
| Frontend ESLint / `tsc -b` | 0 errors / 0 errors |
| Manual run in Chrome | Whole workflow with five Meridian users (16 Nov); department filter, question search and time-zone setting (17 Nov) |
