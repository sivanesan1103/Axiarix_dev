# API documentation (`/api/v1`)

- JSON envelope: success `{ "data": …, "meta"?: { page, pageSize, total, totalPages } }`; error `{ "error": { "code", "message", "details"? } }`.
- Auth: `Authorization: Bearer <accessToken>` (15 min). Refresh uses the HTTP-only cookie `axr_rt` plus the header `X-Requested-With: axiarix`.
- Lists accept `page` and `pageSize` (≤200) plus filters. Validation errors return **422** with Zod details; lifecycle conflicts return **409** (`INVALID_STATE`, `ASSESSMENT_LOCKED`, `IMMUTABLE`); scope or permission denials return **403** and are audited.
- Permission keys are `resource:action` (see ROLE_PERMISSIONS.md).
- While enforced MFA applies to a privileged user who has not enrolled, every endpoint except `/auth/me`, `/auth/mfa/setup`, `/auth/mfa/enable`, `/auth/change-password` and `/auth/logout` returns **403** `MFA_ENROLMENT_REQUIRED`; `/auth/me` then has `mfaEnrolmentRequired: true`.

## Health & auth

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | DB and storage status (no auth) |
| POST | `/auth/login` | `{ email, password, mfaCode? }` → `{ accessToken, user }` or `{ mfaRequired: true }`; sets refresh cookie |
| POST | `/auth/refresh` | Rotates the refresh token; reuse revokes the family |
| POST | `/auth/logout` | Revokes the token family |
| POST | `/auth/forgot-password` · `/auth/reset-password` | 30-minute single-use reset token by e-mail |
| GET | `/auth/me` | Profile, roles, permissions, scopes, active restrictions and the organisation's display `timeZone` (also returned by login and refresh) |
| POST | `/auth/change-password` | |
| POST | `/auth/mfa/setup` · `/auth/mfa/enable` · `/auth/mfa/disable` | TOTP |

## Platform (platform owner only)

| Method | Path | Notes |
|---|---|---|
| GET | `/platform/organisations` | All organisations with user and branch counts |
| POST | `/platform/organisations/parse-setup` | multipart `file`: reads the setup workbook into wizard data |
| POST | `/platform/organisations/validate` | Checks the wizard data without saving (duplicate e-mails, codes, owners) |
| POST | `/platform/organisations` | Creates the organisation, roles, branches, departments, users (invited), restrictions and default policies |
| PATCH | `/platform/organisations/:id` | `{ name?, legalEntity?, status?, reason }` – suspend (`INACTIVE`) or reactivate; suspension blocks sign-in |
| POST | `/platform/organisations/:id/checklists` | multipart `file`: imports checklist worksheets as drafts |

## Organisation, users, roles

| Method | Path | Permission |
|---|---|---|
| GET | `/organisations/current` | organisation:read / dashboard:read |
| PATCH | `/organisations/:id` | organisation:update |
| POST/PATCH | `/organisations/sites[/:id]` | organisation:create / update |
| POST/PATCH | `/organisations/departments[/:id]` | organisation:create / update |
| GET | `/users?search&role&status&siteId` | user:read |
| GET | `/users/directory?role=` | any authenticated user (pickers) |
| POST | `/users` | user:create (invite e-mail or initial password) |
| PATCH | `/users/:id` | user:update |
| POST | `/users/:id/status` | user:update – `{ status, reason }`, revokes sessions on deactivation |
| PUT | `/users/:id/roles` | role:assign – role and scope assignments (branch administrators only inside their branch; nobody changes their own access) |
| PUT | `/users/:id/restrictions` | role:assign / user:assign – `{ restrictions: [{ permission, reason, expiresAt? }] }` removes permissions from this person only |
| GET | `/roles` · `/roles/permissions` | role:read |
| PUT | `/roles/:id/permissions` | role:update (System Administrator is protected) |

## Checklists & import

| Method | Path | Permission |
|---|---|---|
| GET | `/checklists/iso-references?type=` | authenticated |
| GET/POST | `/checklists` | checklist:read / create |
| GET/PATCH | `/checklists/:id` | checklist:read / update (includes version history) |
| POST | `/checklists/:id/versions` | create new DRAFT version (copies items) |
| GET | `/checklists/published-versions` | |
| GET | `/checklists/versions/:versionId?search&priority&clause&control&needsReview` | checklist:read |
| GET | `/checklists/versions/:versionId/export` | XLSX |
| POST | `/checklists/versions/:versionId/items` | checklist:update (DRAFT only) |
| PATCH/DELETE | `/checklists/items/:itemId` | DRAFT only |
| PUT | `/checklists/items/:itemId/mappings` | replaces mappings and confirms review |
| POST | `/checklists/items/:itemId/mappings/confirm` | the named reviewer confirms a flagged mapping as correct `{ note? }` |
| POST | `/checklists/versions/:versionId/reorder` | `{ itemIds }` |
| POST | `/checklists/versions/:versionId/submit-review` | `{ reviewerId }` – the named reviewer must have checklist:approve and must not be the author |
| POST | `/checklists/versions/:versionId/return-to-draft` · `publish` · `archive` | only the named reviewer publishes, after every flagged mapping is confirmed and every review comment resolved |
| GET | `/checklists/versions/:versionId/eligible-reviewers` | people with checklist:approve, excluding the author, the caller and restricted users |
| GET/POST | `/checklists/versions/:versionId/review-comments` | review comments (per question or general); each row has `canResolve` |
| POST | `/checklists/review-comments/:id/resolve` | only the comment's author or the named reviewer |
| GET/POST | `/imports` | upload `.xlsx` (multipart `file`) → PREVIEW |
| GET | `/imports/:id` · `/imports/:id/rows?sheetName&filter=all\|errors\|warnings\|review\|duplicates\|excluded` | |
| PUT | `/imports/:id/mapping` | `{ sheetName, columnMap }` re-maps rows from preserved raw data |
| PATCH | `/imports/:id/rows/:rowId` | `{ included }` |
| POST | `/imports/:id/confirm` | `{ sheets: [{ sheetName, templateTitle }], allowDuplicateFile }` |
| POST | `/imports/:id/discard` · GET `/imports/:id/error-report` | |

## Assessments & review

| Method | Path | Permission / rule |
|---|---|---|
| GET | `/assessments?status=a,b&siteId&departmentId&periodLabel&search&mine` | assessment:read (scoped) |
| GET | `/assessments/periods` · `/assessments/my-assignments` | |
| POST | `/assessments` | assessment:create – published version only |
| GET/PATCH | `/assessments/:id` | detail includes live metrics, allowed actions, `ownerHasAccess`, and `reviewProgress` `{ reviewable, decided, pending }` during audit. PATCH only while Draft/Assigned; the owner must work in the assessment's department |
| POST | `/assessments/:id/owner` | assessment:update – `{ ownerId, reason }` hands an open assessment to another owner in the same department; audited and notified |
| GET | `/assessments/:id/items` · `/assessments/:id/items/:itemId` | workspace data, previous source observations |
| PUT | `/assessments/:id/responses/:itemId` | response:update – editable statuses only; N/A needs justification |
| POST | `/assessments/:id/release` | DRAFT → ASSIGNED |
| POST | `/assessments/:id/assign` · `/unassign` | assessment:assign – the assignee must work in the assessment's branch and department |
| GET | `/assessments/:id/validation` | submission readiness |
| POST | `/assessments/:id/submit` | assessment:submit – validates and snapshots |
| POST | `/assessments/:id/start-review` · `/review/submit` | assessment:review; preparers cannot audit. `review/submit` needs `{ opinion }` (≥ 20 characters) and returns 422 with `details.pendingReview` while any answer or evidence file lacks a decision. Accepting a file does not accept the answer |
| POST | `/assessments/:id/items/:itemId/review` | `{ decision: ACCEPTED\|REJECTED\|CLARIFICATION_REQUESTED\|COMMENT, evidenceId?, reason?, comments? }` |
| POST | `/assessments/:id/comments` | clarification thread |
| POST | `/assessments/:id/approval` | assessment:approve – APPROVED generates the PDF report |
| POST | `/assessments/:id/finalise` | when no approval step is configured |
| POST | `/assessments/:id/reopen` | assessment:reopen – `{ reason }` (≥10 characters) |
| GET | `/assessments/:id/history` · `/submissions/:round` | |
| GET | `/assessments/:id/export?format=csv\|xlsx` | assessment:export |

## Evidence

| Method | Path | Notes |
|---|---|---|
| GET | `/evidence?search&siteId&assessmentId&findingId&verificationStatus&classification&link` | scoped |
| GET | `/evidence/:id` | metadata, versions, reviews, access log |
| POST | `/evidence` | multipart `file` plus `assessmentId+itemId` or `findingId` or `correctiveActionId` |
| POST | `/evidence/:id/versions` | new version (verification resets to Pending) |
| PATCH | `/evidence/:id` | metadata |
| POST | `/evidence/:id/remove` | soft delete (not for accepted evidence) |
| POST | `/evidence/:id/download-url` | `{ version?, inline? }` → 5-minute signed URL |
| GET | `/evidence/download/:token` | redeem signed URL (re-checks user and scope; CLEAN files only) |
| POST | `/evidence/versions/:versionId/rescan` | evidence:update |

## Findings & corrective actions

| Method | Path | Permission |
|---|---|---|
| GET | `/findings?status&severity&siteId&assessmentId&ownerId=me&overdue&format=csv\|xlsx` | finding:read / export |
| POST | `/findings` | finding:create – the owner must work in the assessment's branch and department |
| GET/PATCH | `/findings/:id` | |
| POST | `/findings/:id/assign` · `/actions` · `/close` · `/comments` | `actions`: the finding owner (any role) or corrective_action:create; the action owner must work in that department. close needs finding:review; all actions verified, or an override reason when there are none |
| GET | `/corrective-actions?status&ownerId&overdue&format=` | corrective_action:read |
| GET/PATCH | `/corrective-actions/:id` | |
| POST | `/corrective-actions/:id/updates` · `/submit` · `/verify` | submit requires clean closure evidence; verify needs corrective_action:review |

## Reports, dashboard, audit, admin

| Method | Path | Notes |
|---|---|---|
| GET | `/reports?search&siteId&periodLabel&includeArchived` · `/reports/:id` | report:read |
| POST | `/reports/:id/download-url` · GET `/reports/download/:token` | signed PDF download |
| POST | `/reports/generate` | new version for an APPROVED assessment |
| GET | `/dashboard/summary?siteId&departmentId&periodLabel&assessmentId` | live KPIs and charts, `branchComparison` and `departmentComparison` |
| GET | `/dashboard/tasks` | personal pending work: drafts to release, assessments to submit, questions to answer, reviews and approvals (filtered by separation of duties), checklist reviews, findings to fix, actions to verify |
| GET | `/audit-logs?…&format=csv\|xlsx` · `/audit-logs/actions` · `/audit-logs/verify` | audit_log:read / export |
| GET | `/notifications` · POST `/notifications/:id/read` · `/notifications/read-all` | |
| GET | `/search?q=` | global search within scope: assessments, findings, checklists, checklist questions, reports, evidence |
| GET/PUT | `/admin/settings[/:key]` | per organisation: `upload.policy`, `workflow.policy`, `security.policy`, `notification.policy`, `report.config`, `locale.config` (`{ timeZone }`, IANA name) |
| GET | `/admin/setup-status` | Admin Home checklist: branches, departments with owners, users, published checklist, assessments |
| POST | `/admin/settings/test-email` · `/admin/reminders/run` | |
| GET/POST | `/admin/scoring-policies` · POST `/:id/activate` | versioned, settings:approve |
| GET/PUT | `/admin/retention-policies[/:entityType]` · POST `/admin/retention/run` | |
| GET/POST | `/admin/deletion-requests` · POST `/:id/decision` · `/:id/execute` | two-person rule; only the caller's organisation |
| GET/POST/PATCH | `/admin/schedules[/:id]` · POST `/:id/run` | periodic assessments |
