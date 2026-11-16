# Testing

## Suites

| Suite | Tool | Location | What it covers |
|---|---|---|---|
| Backend unit | Vitest | `backend/tests/unit.test.ts` | ISO catalogue completeness; Clauses/Controls parsing incl. ambiguous-mapping flags; scoring rules; evidence coverage; file validation (signature, double extension, size, traversal); AES-GCM; RFC 6238 TOTP vector; parsing the real Kauvery workbook (both layouts, 75 rows each, verbatim cells) |
| Backend integration – security | Vitest + Supertest | `backend/tests/auth.test.ts` | Health; 401 without token; login failure audit and no user enumeration; cookie flags; refresh rotation and reuse detection; CSRF header; tampered token; lock-out; forgot/reset password; logout; immediate deactivation; RBAC denials (audited); admin protection; append-only audit trigger; hash-chain verification |
| Backend integration – workflow | Vitest + Supertest | `backend/tests/workflow.test.ts` | AT-01 … AT-12, Excel import incl. duplicate detection, published-version immutability (service and DB trigger), malware/executable/disguised upload rejection, N/A acceptance rule, report immutability, CSV formula-injection protection, audit chain after the full workflow |
| Frontend unit | Vitest + React Testing Library | `frontend/tests/unit` | Formatting helpers, empty-param cleaning, password policy, status badges, confirm dialog mandatory reason and error display, lifecycle stepper conditional stages, mapping chips |
| End-to-end | Playwright (Chromium) | `frontend/tests/e2e/workflow.spec.ts` | Full UI workflow across four roles: create and publish checklist → create and release assessment → answer and upload evidence → submit → auditor review, accept evidence, raise finding → plan corrective action with closure evidence → verify and close → approve → final PDF via signed URL; cross-branch denial in the UI. Captures `docs/screenshots/*` |

## Running

```bash
# Backend (needs docker compose services; uses database axiarix_test)
cd backend
npm run lint && npx tsc --noEmit && npm test && npm run build
npx prisma validate && npx prisma migrate status

# Frontend
cd frontend
npm run lint && npm run typecheck && npm test && npm run build

# End-to-end (dev API on :5050 and web on :5173 running, dev database seeded)
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

## Latest results (2026-11-13, executed locally)

| Check | Result |
|---|---|
| Backend tests | **50 passed**, 0 failed, 0 skipped (3 files) |
| Frontend unit tests | **11 passed**, 0 failed |
| Playwright E2E | **2 passed**, 0 failed |
| Backend ESLint / `tsc --noEmit` | 0 errors / 0 errors |
| Frontend ESLint / `tsc -b` | 0 errors, 0 warnings / 0 errors |
| Backend build / frontend build | Success / success |
| `prisma validate` / migrations | Valid / 3 migrations applied |
