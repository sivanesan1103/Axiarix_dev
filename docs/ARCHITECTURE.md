# Architecture

## Overview

```
Browser (React SPA)
   │  HTTPS, same origin: /  → static SPA,  /api → reverse proxy
   ▼
nginx (prod) / Vite dev proxy
   │
   ▼
Express API  /api/v1 ─── Prisma ─── PostgreSQL 16  (relational data, audit chain, triggers)
   │
   ├── Storage adapter ─── S3-compatible private bucket (MinIO dev / S3 prod) or private disk
   ├── Malware scanner ─── built-in heuristics or ClamAV (clamd INSTREAM)
   ├── Mailer ──────────── SMTP (Mailpit dev)
   └── PDF / XLSX / CSV ── pdfkit, ExcelJS
```

The SPA and API share one origin, so the refresh-token cookie can be `HttpOnly; SameSite=Strict; Path=/api/v1/auth`.

## Backend layering (`backend/src`)

| Layer | Location | Responsibility |
|---|---|---|
| Routes / controllers | `modules/*/*.routes.ts` | HTTP wiring, Zod validation, permission guard, thin handlers that call services and format the `{ data, meta }` envelope |
| Services | `modules/*/*.service.ts`, `services/*` | Business rules: lifecycle transitions, scope checks, scoring, evidence security, report generation |
| Data access | Prisma client (`config/prisma.ts`) | Prisma acts as the repository layer; complex queries live in services, never in route files |
| Middleware | `middleware/` | Authentication, permission guard, validation, request id, logging, central error handler |
| Constants | `constants/` | RBAC matrix, ISO 27001:2022 catalogue (clauses 4–10, all 93 Annex A controls) |

Modules: `auth, platform, organisations, users (+roles, restrictions), checklists, imports, assessments, reviews, evidence, findings (+corrective actions), reports, dashboard, audit-logs, notifications, admin, search`.

### Key design decisions

- **Several organisations per installation**: every query is limited to the caller's organisation. A platform owner (`modules/platform`, `services/org-provisioning.service.ts`) creates organisations from a 5-step wizard or a setup workbook; each organisation gets its own roles, policies and settings.
- **Scope enforcement** (`services/scope.service.ts`): every record carries `organisationId/siteId/departmentId`. Lists use `unitWhere(user)`; single-record access uses `assertUnitAccess`, which returns 403 and records an `ACCESS_DENIED` audit event (AT-10). `assertUserCoversUnit` makes sure anyone given work (assessment owner, question assignee, finding or action owner) can open that record.
- **Per-user restrictions**: `UserPermissionRestriction` rows are subtracted from the person's role permissions at authentication, so a restricted permission is denied everywhere; the frontend hides the matching buttons.
- **Separation of duties** (`services/sod.service.ts`): preparers cannot audit; preparers and auditors cannot approve; action owners cannot verify; checklist authors cannot publish their own checklist. Blocked actions come back with a reason the UI shows.
- **Administration scope** (`services/admin-scope.service.ts`): branch administrators manage only users in their branch; nobody changes their own access.
- **Lifecycle transitions** use conditional `updateMany(where status in allowed)` inside a transaction, so concurrent or repeated clicks cannot double-submit; each transition writes `StatusHistory` and an audit event.
- **Immutability**: published checklist versions, issued reports and audit events are protected both in services and by PostgreSQL triggers.
- **Pinning**: assessments pin their checklist version and scoring policy; reports freeze their metrics in `Report.summary`, so later changes never alter issued results.
- **Evidence security**: allow-list plus magic-byte check, size limit, executable/double-extension rejection, malware scan *before* storage (infected files are never stored), SHA-256 checksum, private object keys generated server-side, 5-minute signed download tokens redeemed through the API, which re-checks the user and scope and logs every download.
- **Audit trail**: append-only (DB trigger) and hash-chained (each event stores the previous hash). `GET /audit-logs/verify` recomputes the chain.
- **Real-time updates** (`services/realtime.service.ts`, `frontend/src/hooks/useRealtime.ts`): each signed-in browser keeps one Server-Sent Events stream (`GET /api/v1/events`). After every successful change (on response `finish`, i.e. after commit) the API announces the area that changed to everyone in the organisation — never record data — and personal events (new notification, own access changed) to one user. The browser re-reads only the affected screens through the normal permission-checked API, combining bursts into one refresh; background tabs refresh when reopened. The hub is in memory (single API instance); several instances would need PostgreSQL LISTEN/NOTIFY or Redis.
- **Notifications** never throw: failures are recorded on the `Notification` row so business workflows never break.
- **Configuration** (`SystemSetting`) is typed and validated with Zod, stored per organisation, and has safe defaults. `locale.config` sets the display time zone used by every screen and by PDF reports (timestamps are stored in UTC).

## Frontend structure (`frontend/src`)

| Folder | Purpose |
|---|---|
| `api/client.ts` | Axios instance; access token kept in memory only; single-flight refresh on 401 |
| `services/*.service.ts` | One module per backend area; components never call Axios directly |
| `contexts/` | `AuthContext` (session, `can()`, profile re-read every minute and on tab focus so role changes apply without reload; sets the display time zone), `FilterContext` (global site/period selector, kept in the page link) |
| `routes/` | Router with lazy-loaded pages and UX guards (the API remains the authority) |
| `components/ui` | shadcn-style primitives (Radix) |
| `components/common` | Page header, states (loading/empty/error), confirm dialog with mandatory reasons, pagination, timeline, pickers |
| `components/*` | Domain components (dashboard charts, lifecycle stepper, evidence list, finding dialog) |
| `pages/` | Screens per module |

Server state uses TanStack Query; forms use React Hook Form with Zod schemas that mirror the backend rules.

### UI/UX

The visual language follows the approved reference screen: white canvas, hairline borders, an icon-rail sidebar with an indigo active marker (expandable), a top bar with page title and breadcrumbs, grey search pill, site and period selectors, notifications and profile; a single bordered KPI strip with dividers; indigo-on-lavender bar charts; tables with a grey header row. Status colours are reserved for meaning (green compliant, amber partial, red non-compliant).

**Dark mode:** all colours are semantic tokens (`src/index.css`). A `.dark` class on `<html>` remaps them (lifted indigo for contrast, dark surfaces, the same status meanings). `ThemeContext` offers Light / Dark / System (System follows the OS live). The choice is stored per browser, and an inline script in `index.html` applies it before first paint so there is no white flash. Charts use the same CSS variables, so they switch too.

## Security controls (summary)

bcrypt (cost 12) password hashing · 15-minute JWT access tokens (in memory) · rotating opaque refresh tokens stored hashed, with reuse detection that revokes the token family · account lock-out · login rate limiting · TOTP MFA (secrets encrypted with AES-256-GCM) · Helmet (CSP, HSTS in production) · strict CORS · CSRF header on cookie endpoints · Zod validation of every input · Prisma parameterised queries · CSV formula-injection neutralisation · server-side RBAC and scope checks · private storage and signed downloads · append-only, hash-chained audit log.
