# Database

PostgreSQL 16, managed with Prisma 6 (`backend/prisma/schema.prisma`). All timestamps are stored in UTC.

## Entities

| Area | Models |
|---|---|
| Organisation | `Organisation` (`isPlatform` marks the platform owner's own organisation), `Site`, `Department` |
| Identity & access | `User` (`isPlatformOwner`), `Role` (one set per organisation: unique `organisationId + key`), `Permission`, `RolePermission`, `UserRole` (role + organisation/site/department scope), `UserPermissionRestriction` (permission removed from one person, with reason and optional end date), `RefreshToken` |
| Reference | `IsoReference` (clauses 4–10, Annex A 5.1–8.34) |
| Checklists | `ChecklistTemplate`, `ChecklistVersion` (DRAFT → UNDER_REVIEW → PUBLISHED → ARCHIVED; `submittedById` and named `reviewerId`), `ChecklistItem`, `ControlMapping` (ISO_CLAUSE / ANNEX_A / INTERNAL_POLICY / RISK, `needsReview`), `ChecklistReviewComment` (reviewer comments per version or question, resolved by author or reviewer) |
| Excel import | `ImportedChecklist` (file checksum, per-sheet summary and column map), `ImportedChecklistRow` (every original cell in `rawData`, plus worksheet and row number) |
| Assessments | `Assessment` (pinned checklist version and scoring policy, lifecycle, round, reopen count), `AssessmentAssignment`, `AssessmentResponse`, `AssessmentSubmission` (immutable snapshot per submission round), `StatusHistory` |
| Evidence | `Evidence` (links to response/item, finding, corrective action; classification; verification), `EvidenceVersion` (storage key, MIME type, size, SHA-256 checksum, scan status) |
| Review | `AuditorReview` (item/evidence decisions and the overall opinion), `ReviewComment` (clarification threads) |
| Findings | `Finding`, `CorrectiveAction`, `CorrectiveActionUpdate` |
| Approval & reports | `Approval`, `Report` (versioned, frozen `summary`, storage key, checksum) |
| Governance | `AuditEvent` (append-only, hash-chained), `Notification`, `ScoringPolicy` (versioned), `RetentionPolicy`, `DeletionRequest` (two-person rule), `AssessmentSchedule`, `SystemSetting` (stored per organisation under `org:<id>:<key>`, e.g. `locale.config` for the display time zone) |

Indexes cover scope columns (`organisationId, siteId, departmentId`), status fields, foreign keys used in lists, and audit queries (`entityType+entityId`, `actorId`, `createdAt`, `action`). Unique constraints include site code per organisation, question code per version, one response per (assessment, item), and report version per assessment.

## Integrity triggers (migration `integrity_triggers`)

| Trigger | Effect |
|---|---|
| `audit_event_no_update`, `audit_event_no_delete` | `AuditEvent` rows can never be updated or deleted (NFR-SEC-06) |
| `checklist_item_immutable`, `control_mapping_immutable` | Items and mappings of PUBLISHED/ARCHIVED versions cannot be inserted, changed or deleted (FR-007) |
| `report_immutable` | Report content (storage key, checksum, summary, version) cannot change; deletion only via the secure-deletion workflow |

Tamper evidence: each `AuditEvent` stores `prevHash` and `hash = SHA-256(canonical event + prevHash)`. Writers are serialised with a transaction-scoped advisory lock. `GET /api/v1/audit-logs/verify` recomputes the chain.

## Migrations

```bash
npx prisma migrate deploy      # apply (production and CI)
npx prisma migrate status      # check
npx prisma validate            # schema check
npx prisma migrate dev         # create a new migration (development)
```

Migrations: `init` · `integrity_triggers` · `iso_reference_id` · `multi_org_restrictions_review` (per-organisation roles, platform owner, per-user restrictions, named checklist reviewer and review comments).

## Seeding

`npm run db:seed` (refuses to run when `NODE_ENV=production`):

1. ISO reference catalogue and the RBAC matrix (idempotent).
2. Organisation *Kauvery Hospitals Group*, site *Vadapalani* (KVP) and department *IT & IT Data Centre*; a demo branch *Alwarpet (demo branch)* to exercise multi-site reporting and cross-branch denial.
3. Seven fictitious development users (see README).
4. Scoring policy v1 (SRS §9 proposal) and 7-year retention placeholders.
5. Imports `source-data/kauvery-vadapalani-it-ia-checklist.xlsx` through the real import service: both worksheets become draft checklists (75 items each). The current checklist is published; 29 import-flagged mappings are acknowledged with a recorded reason (development only).
6. Demo assessment ASM-2026-0001 (Q3 FY2026-27), released, with 12 questions assigned.

## Test database

Integration tests use the separate database `axiarix_test` (created by `prisma/init-test-db.sql` when the container first starts). The suite applies migrations and truncates tables between files; TRUNCATE does not fire the row-level append-only triggers.
