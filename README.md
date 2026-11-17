# Axiarix – ISO/IEC 27001:2022 Compliance Management System

Hospital IT pilot for **Kauvery Hospitals Group – Vadapalani – IT & IT Data Centre**.
A centralised, role-controlled platform for checklists, evidence, auditor review, findings, corrective actions, approvals and final PDF reports.

> The software supports the hospital's ISMS process. It does **not** by itself establish ISO/IEC 27001 conformity or certify the hospital.

| | |
|---|---|
| Frontend | React 19 · TypeScript · Vite 7 · Tailwind CSS 4 · shadcn-style Radix UI · TanStack Query · React Hook Form + Zod · Recharts |
| Backend | Node.js · Express 5 · TypeScript · Zod · JWT + rotating refresh tokens · Prisma 6 · PostgreSQL 16 |
| Storage | S3-compatible private storage (MinIO in dev) · SHA-256 checksums · versioning · malware scanning |
| Reports | Server-side PDF (pdfkit) · ExcelJS XLSX · CSV |
| Tests | Vitest · Supertest · React Testing Library · Playwright |

## Quick start (development)

Prerequisites: Node.js ≥ 20, Docker Desktop.

```bash
cd axiarix
docker compose up -d                          # Postgres :5433, MinIO :9002 (console :9003), Mailpit :1025 (UI :8025)

cd backend
cp .env.example .env                          # then set secrets (dev values are fine locally)
npm install
npx prisma migrate deploy
npm run db:seed                               # imports the real Kauvery workbook; creates dev accounts
npm run dev                                   # API → http://localhost:5050/api/v1

cd ../frontend
npm install
npm run dev                                   # Web → http://localhost:5173
```

If ports 5433 or 5173 are already used by another project, map Postgres to another port with a compose override (for example 5434), set `DATABASE_URL` to match, and start the web with `npx vite --port 5174 --strictPort` and `FRONTEND_ORIGIN=http://localhost:5174` for the API.

| URL | |
|---|---|
| Web app | http://localhost:5173 |
| API | http://localhost:5050/api/v1 |
| Health | http://localhost:5050/api/v1/health |
| Mail (dev SMTP inbox) | http://localhost:8025 |
| MinIO console | http://localhost:9003 |

**Port change:** the API uses **5050** instead of the proposed 5000 because macOS AirPlay Receiver occupies port 5000.

> npm 11 blocks dependency install scripts by default. If Prisma or esbuild fail after `npm install`, run
> `npm install-scripts approve @prisma/client @prisma/engines prisma esbuild` (backend) or `npm install-scripts approve esbuild` (frontend), then `npm rebuild`.

### Development accounts

All use the password **`Axiarix@Dev2026`** (development only; fictitious people).

| E-mail | Role | Scope |
|---|---|---|
| admin@axiarix.local | System Administrator | Organisation |
| isms@axiarix.local | Hospital ISMS / Compliance Owner | Organisation |
| itowner@axiarix.local | IT Department Owner | Vadapalani / IT |
| contributor@axiarix.local | IT Control Owner / Contributor | Vadapalani / IT |
| auditor@axiarix.local | Auditor | Organisation |
| management@axiarix.local | Management Viewer | Organisation |
| itowner.alwarpet@axiarix.local | IT Department Owner | Alwarpet (demo branch) |
| platform@axiarix.local | Platform owner | Creates and suspends organisations; sees no organisation's audit data |

The seed imports both worksheets of `backend/source-data/kauvery-vadapalani-it-ia-checklist.xlsx` (75 questions each), publishes the current internal-audit checklist and creates assessment **ASM-2026-0001 (Q3 FY2026-27)**, released to IT with 12 questions assigned to the contributor. No answers, evidence or observations are invented.

### Organisations, limits and separation of duties

- **Several organisations per installation.** A platform owner creates each one at *Organisations → New organisation* (5 steps, or load `sample-org/01-organisation-setup.xlsx`). Each organisation gets its own roles, settings, branches, users and data.
- **Branch administrators** (a System Administrator role scoped to a branch) can only manage people and departments in that branch. Nobody can change their own roles or restrictions.
- **Limit one person's power:** *Users → ⋯ → Restrict permissions* removes chosen permissions from that user only (with a reason and optional end date). The role is unchanged and the API enforces it.
- **Separation of duties (hard block, ISO/IEC 27001 A.5.3):** a checklist version is submitted with a named reviewer, who alone can publish it, after every import-flagged ISO mapping is confirmed or corrected. Whoever prepared an assessment cannot audit it, whoever prepared or audited it cannot approve it, and a corrective action's owner cannot verify it.
- **Periods** are fixed formats on the Indian financial year: `Q3 FY2026-27`, `H1 FY2026-27`, `FY2026-27`. Dates are derived from the label.
- **Filters:** the *Scope* button in the top bar (branch · period) applies to the dashboard and every list. List filters are kept in the page link, so refresh, Back and shared links keep the same view.

See `sample-org/README.md` for the fictitious *Sunrise Care Hospitals (Sample)* organisation and checklist workbooks, and `docs/DEMO_WALKTHROUGH.md` for *Green Valley Clinic (Demo)*, a one-person-per-role organisation for walking the whole workflow in Chrome.

### Try the full workflow

1. **isms@** – Checklist Library → open a checklist → *Submit for review* naming **admin@** as reviewer; **admin@** confirms flagged mappings and publishes. Then **isms@**: Assessment Periods → New assessment → *Assign to department*.
2. **itowner@ / contributor@** – My Assessments → answer questions, upload evidence → *Submit for audit*.
3. **auditor@** – Auditor Workspace → *Start review* → accept/reject evidence, request clarification, raise findings → *Submit review*.
4. **itowner@** – Findings → *Plan corrective action* → upload closure evidence → *Submit for verification*.
5. **auditor@** – verify the action and *Verify & close* the finding.
6. **isms@** – open the assessment → *Approve & issue report* → Reports & Analytics → view/download the PDF.

## Commands

| Backend (`axiarix/backend`) | |
|---|---|
| `npm run dev` | API with reload |
| `npm run build && npm start` | Production build / start |
| `npm run lint` · `npx tsc --noEmit` | Lint / type-check |
| `npm test` | Unit + integration tests (uses database `axiarix_test`) |
| `npx prisma validate` · `npx prisma migrate status` | Schema / migration checks |
| `npm run db:seed` | Seed development data |
| `npm run db:reset` | **Destroys** the dev database and re-seeds |

| Frontend (`axiarix/frontend`) | |
|---|---|
| `npm run dev` | Vite dev server (proxies `/api` → `:5050`) |
| `npm run build` · `npm run preview` | Production build / preview |
| `npm run lint` · `npm run typecheck` | Lint / type-check |
| `npm test` | Component/unit tests |
| `npm run test:e2e` | Playwright end-to-end workflow (needs the dev stack running) |

## Documentation

- [docs/USER_GUIDE_AND_WORKFLOW.md](docs/USER_GUIDE_AND_WORKFLOW.md) – full user guide: logins, roles, tutorials, governance rules, feature reference, Meridian onboarding run, release notes
- [docs/WALKTHROUGH_PROMPT.md](docs/WALKTHROUGH_PROMPT.md) – 47-step test walkthrough with accounts and record IDs
- [docs/review/axiarix-fix-plan.html](docs/review/axiarix-fix-plan.html) – review findings and fix plan with mockups
- [docs/demo/](docs/demo/) – captioned feature tour video and Chrome recordings
- [sample-files/](sample-files/README.md) – fictitious Excel workbooks and business evidence documents for testing
- [docs/REQUIREMENTS_TRACEABILITY.md](docs/REQUIREMENTS_TRACEABILITY.md) – every BRD and SRS requirement mapped to code, tests and results
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) – architecture, modules, security design
- [docs/DATABASE.md](docs/DATABASE.md) – data model, integrity triggers, migrations, seeding
- [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) – REST endpoints
- [docs/ROLE_PERMISSIONS.md](docs/ROLE_PERMISSIONS.md) – RBAC matrix and scope rules
- [docs/TESTING.md](docs/TESTING.md) – test strategy and results
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) – production deployment, backup and restore
- [docs/USER_GUIDE.md](docs/USER_GUIDE.md) – guide per role
- [FINAL_IMPLEMENTATION_REPORT.md](FINAL_IMPLEMENTATION_REPORT.md) – completion status, traceability, outstanding work
- [PROJECT_PROGRESS.md](PROJECT_PROGRESS.md) – running history
