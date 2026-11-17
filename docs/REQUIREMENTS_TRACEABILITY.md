# Requirements traceability – BRD and SRS v1.0

Checked on 17 November 2026 against `Axiarix_ISO27001_2022_BRD_Hospital_IT_Pilot.docx` and `Axiarix_ISO27001_2022_SRS_Hospital_IT_Pilot.docx` (both Version 1.0 – Draft for stakeholder review). SRS §14 asks for a matrix linking BRD ID → SRS ID → design component → test case → acceptance result; this is that matrix.

**How each item was checked**

- **Test:** an automated test in `backend/tests/*.test.ts` (69 tests), `frontend/tests/unit` (11) or the Playwright browser test `frontend/tests/e2e/workflow.spec.ts` (2). All pass.
- **Live:** done by hand in the running app in Chrome with the Meridian Diagnostics users, or by calling the running API.
- **Deployment:** met by how the system is hosted; `docs/DEPLOYMENT.md` gives the steps. It can't be shown on a developer laptop.

**Status:** ✅ met · 🟡 met with a limitation noted · ⚙️ deployment responsibility · ⏳ open stakeholder decision (SRS §13).

**Fixed during this check:** search did not cover checklist questions (FR-027). The dashboard had no department filter or per-department view (FR-021, BRD §9). Dates had no configurable time zone, and PDF reports printed UTC (SRS 2.3, NFR-10). All three are now implemented and tested.

## 1. BRD business requirements

| BRD | Requirement | Met by (SRS) | Where in the app | Verified | Status |
| --- | --- | --- | --- | --- | --- |
| BR-01 | Centralised checklist library | FR-005, FR-006 | Checklist Library, Excel import | `workflow.test › imports both worksheets`; E2E | ✅ |
| BR-02 | Versioned questions; submitted assessments never change silently | FR-007 | Published versions are immutable (service rule and database trigger); assessments pin their version | `workflow.test › AT-02`, immutability checks | ✅ |
| BR-03 | Configurable periodic (quarterly) assessments | FR-008 | Period pickers (quarter, half or financial year), deadline reminders | `governance.test › parses Indian financial-year periods` | ✅ |
| BR-04 | Evidence per checklist item in a central repository | FR-010, FR-011 | Workspace **Upload evidence**, Evidence Repository | `workflow.test › AT-03` | ✅ |
| BR-05 | Auditors verify evidence, comment, request clarification, record findings | FR-014, FR-015 | Auditor Workspace | `workflow.test › AT-06, AT-07`; live run 16 Nov | ✅ |
| BR-06 | Corrective actions with owners, due dates and closure evidence | FR-016, FR-017 | Findings → **Plan corrective action**; Corrective Actions | `workflow.test › AT-08`; live run | ✅ |
| BR-07 | Final PDF only after the review/approval workflow | FR-022 | Generated on approval (or on finalise when approval is off) | `workflow.test › AT-09` (409 before approval); E2E | ✅ |
| BR-08 | Dashboards: compliance, evidence coverage, open findings, overdue actions | FR-020 | Dashboard KPIs and charts | `workflow.test › AT-12` | ✅ |
| BR-09 | Consolidated and branch-wise views | FR-021 | Scope button (all branches / one branch); Branch comparison | `workflow.test › AT-12` | ✅ |
| BR-10 | Auditable history of key actions | FR-018, FR-025 | Audit Trail (append-only, hash-chained), record histories | `auth.test › audit trail integrity`; `workflow.test › audit hash chain` | ✅ |
| BR-11 | Export of reports and assessment data | FR-023, FR-024 | Reports & Analytics; CSV/XLSX exports | `workflow.test › exports responses as CSV` | ✅ |

## 2. BRD business rules (§8)

| Rule | Where | Verified | Status |
| --- | --- | --- | --- |
| Assessment tied to hospital, department, period and checklist version | Assessment model; New assessment form requires all four | `workflow.test › AT-02` | ✅ |
| Every response has a defined status (C, PC, NC, N/A, Not assessed) | Response status enum | `unit.test › compliance scoring` | ✅ |
| N/A needs a justification and, where configured, auditor acceptance | Response validation; Settings → *Auditor acceptance of N/A* | `workflow.test › AT-09` (N/A acceptance enforced) | ✅ |
| Evidence linked to an item or finding, with uploader and time | Evidence model; also corrective actions | `workflow.test › AT-03` | ✅ |
| Submitted assessments read-only; changes need reopen or clarification | `ASSESSMENT_LOCKED` (409); Reopen with reason | `workflow.test › AT-05, AT-11` | ✅ |
| Only authorised roles approve or publish a final report | `assessment:approve`; separation of duties | `governance.test › preparers cannot audit, auditors and preparers cannot approve` | ✅ |
| Annex A controls are not automatically mandatory; the SoA decides | N/A with SoA justification; the PDF and dashboard state this | PDF text checked live | ✅ |
| Branch reporting keeps branch identity; evidence never mixed | Evidence inherits the record's branch; scope on every query | `workflow.test › AT-10` | ✅ |

## 3. BRD reporting and dashboard requirements (§9)

| Requirement | Where | Verified | Status |
| --- | --- | --- | --- |
| Overall compliance % and status distribution | Dashboard KPIs, Status distribution | `workflow.test › AT-12` | ✅ |
| Compliance by clause, Annex A control, department and branch | By ISO clause / Annex A chart; *Compliance by Annex A control*; Branch **and Department** comparison; department filter (added 17 Nov) | `requirements.test › FR-021`; live in Ishita's tab | ✅ |
| Checklist completion and evidence coverage | *Assessment completion*, *Evidence coverage* | `unit.test › evidence coverage` | ✅ |
| Open, overdue, high-priority and closed findings and actions | Findings by severity, Corrective action progress, Overdue actions | `workflow.test › AT-07` | ✅ |
| Assessment history and period-on-period trend | Quarterly trend; assessment History tab | Live | ✅ |
| Auditor review status, pending clarifications, approval status | Auditor Workspace tiles; Pending approvals KPI | Live | ✅ |
| Final PDF with organisation, department, period, version, scope, results, findings, approval | `reports.service.ts` | Live: PDF of ASM-2026-0022 had every field | ✅ |

## 4. SRS functional requirements

| SRS | BRD | Requirement | Where | Verified | Status |
| --- | --- | --- | --- | --- | --- |
| FR-001 | BR-10 | Authenticate before protected functions | JWT access token + HTTP-only refresh cookie | `auth.test › rejects unauthenticated API requests` | ✅ |
| FR-002 | BR-09 | Permissions by role and organisation/branch/department scope | `requirePermission`, `unitWhere`, `assertUnitAccess`; per-user restrictions | `auth.test › RBAC`; `governance.test`; `workflow.test › AT-10` | ✅ |
| FR-003 | — | Create, invite, deactivate users and assign roles | Users & Access Control | `auth.test › blocks deactivated users immediately`; `governance.test` | ✅ |
| FR-004 | BR-09 | Configure hospital, branches and departments | Hospitals & Branches; platform wizard | `workflow.test › AT-01`; `governance.test › creates the organisation` | ✅ |
| FR-005 | BR-01 | Maintain checklist templates and questions | Checklist editor, Excel import | `workflow.test › AT-02`; E2E | ✅ |
| FR-006 | BR-01 | Map questions to clause, Annex A control, policy or risk | Mappings per question; flagged mappings confirmed before publish | `unit.test › ISO mapping parser`; `governance.test › checklists` | ✅ |
| FR-007 | BR-02 | Publishing creates an immutable version | Status trigger; new version to change | `workflow.test › AT-02` | ✅ |
| FR-008 | BR-03 | Create periods and assign a checklist to a department | New assessment → **Assign to department** | `workflow.test › AT-02` | ✅ |
| FR-009 | BR-04 | Save responses with status, comments, justifications | Workspace **Save answer** | `workflow.test › AT-03` | ✅ |
| FR-010 | BR-04 | Upload allowed file types to an item or finding | Upload dialog; allow-list in Settings | `workflow.test › rejects malware, executables and disguised files` | ✅ |
| FR-011 | BR-04 | Record name, type, size, uploader, time, version, link | `Evidence`, `EvidenceVersion` (with SHA-256) | `workflow.test › AT-03` | ✅ |
| FR-012 | BR-04 | Validate mandatory answers, evidence and justifications before submit | Submit dialog lists gaps | `workflow.test › AT-04` | ✅ |
| FR-013 | BR-05 | Department owner submits for audit | **Submit for audit** | `workflow.test › AT-05` | ✅ |
| FR-014 | BR-05 | Auditor accepts evidence, rejects or asks for clarification, comments | Auditor actions; every answer and file needs a decision | `workflow.test › AT-06`; E2E | ✅ |
| FR-015 | BR-05 | Findings with category, severity, description, owner, due date | **Raise finding** | `workflow.test › AT-07` | ✅ |
| FR-016 | BR-06 | Root cause, correction, corrective action, target date, progress | **Plan corrective action**, **Update progress** | `workflow.test › AT-07, AT-08` | ✅ |
| FR-017 | BR-06 | Reviewer accepts or returns the action | **Verify closure** / **Return** | `workflow.test › AT-08` | ✅ |
| FR-018 | BR-10 | Lifecycle statuses with time and actor | `StatusTransition` table; History tabs | `workflow.test` | ✅ |
| FR-019 | — | Notify about assignment, due date, clarification, finding, approval | In-app notifications and e-mail (Mailpit locally); deadline reminders every 6 hours | `workflow.test › AT-06` (owner notified); live notifications in the Meridian run | ✅ |
| FR-020 | BR-08 | Dashboard: progress, compliance, coverage, findings | Dashboard | `workflow.test › AT-12` | ✅ |
| FR-021 | BR-09 | Filter by period, site, department, clause/control and status | Scope button (branch, period), **department filter (added)**, clause/Annex A switch, status filter | `requirements.test › FR-021`; live | ✅ |
| FR-022 | BR-07 | Final PDF after required review/approval | `generateFinalReport` | `workflow.test › AT-09` | ✅ |
| FR-023 | BR-07 | Central report store; view and download | Reports & Analytics, 5-minute signed links | `workflow.test › AT-09`; E2E | ✅ |
| FR-024 | BR-11 | Export tables to CSV/XLSX | Export buttons on lists and assessments | `workflow.test › exports responses as CSV` | ✅ |
| FR-025 | BR-10 | Log logins, permission changes, evidence changes, submissions, approvals | Audit events for each | `auth.test`; `workflow.test` | ✅ |
| FR-026 | — | Only authorised users reopen, with reason and log | **Reopen** (`assessment:reopen`) | `workflow.test › AT-11` | ✅ |
| FR-027 | — | Search checklist items, assessments, findings, reports | Top-bar search; **checklist questions added** | `requirements.test › FR-027`; live ("awareness induction" → IA-003) | ✅ |
| FR-028 | — | Configurable retention and archival | Settings → Retention; archive or deletion request (second person approves) | Code: `applyRetention`, `decideDeletion` | ✅ |

## 5. Workflow and states (SRS §4)

| Requirement | Verified | Status |
| --- | --- | --- |
| Assessment: Draft → Assigned → In Progress → Submitted for Audit → Under Review → Clarification Required → Reviewed → Pending Approval → Approved/Closed; privileged reopen with reason; history kept | `workflow.test` AT-02 … AT-11; live run 16 Nov | ✅ |
| Finding: Open → Assigned → Action In Progress → Ready for Verification → Verified/Closed; auditor can return; overdue derived from due date | `workflow.test › AT-07, AT-08`; live run | ✅ |

## 6. Data requirements (SRS §5)

Every entity and key attribute listed in SRS §5 exists in `backend/prisma/schema.prisma`, including organisation legal entity, site address, department owner, template owner, version effective date, evidence checksum and classification, report version and storage key, and audit event outcome. ✅

## 7. Interfaces (SRS §6)

| Requirement | Where | Status |
| --- | --- | --- |
| Responsive screens for every module; status labels, required-field markers, validation messages, history | All pages; page-by-page check on desktop and phone (16 Nov) | ✅ |
| Show only permitted data and actions | Server-computed actions; restricted buttons hidden (17 Nov) | ✅ |
| Allow-listed formats, size limit, malware scan before access | Settings → Evidence uploads; scan status gate | ✅ |
| Private storage, no public file links | MinIO private bucket; signed short-lived download links | ✅ |
| PDF with report ID, period, checklist version, generation time, approval | Live check of the PDF | ✅ |
| SMTP e-mail (optional) | Nodemailer; Mailpit locally | ✅ |
| SSO (optional) | Not built; SRS lists it as optional and an open decision | ⏳ |
| GRC/ITSM integration (future phase) | Out of scope for the pilot | ⏳ |

## 8. Security and privacy (SRS §7)

| SRS | Requirement | How | Status |
| --- | --- | --- | --- |
| NFR-SEC-01 | HTTPS with current TLS | TLS at the load balancer; HSTS in production mode | ⚙️ |
| NFR-SEC-02 | No plaintext passwords or secrets | bcrypt password hashing; MFA secrets AES-GCM encrypted; refresh tokens stored as hashes | ✅ |
| NFR-SEC-03 | Server-side least-privilege checks on every operation and file | `requirePermission`, scope checks, signed file links | ✅ |
| NFR-SEC-04 | MFA for privileged and auditor accounts | TOTP for every user; Settings → *Enforce MFA for privileged roles* prompts enrolment at sign-in. Limitation: it prompts, it does not block until enrolled | 🟡 |
| NFR-SEC-05 | Encryption at rest for evidence and database | Encrypted database storage and bucket SSE in the hosting | ⚙️ |
| NFR-SEC-06 | Tamper-resistant logs | Database trigger blocks UPDATE/DELETE on audit events; SHA-256 hash chain with a verify endpoint | ✅ |
| NFR-SEC-07 | Validate and scan uploads | Signature, double-extension and allow-list checks; ClamAV (EICAR test refused) | ✅ |
| NFR-SEC-08 | Sessions, CSRF, input validation, output encoding | SameSite=Strict cookies, CSRF header on cookie endpoints, zod validation, CSV formula-injection protection, React escaping | ✅ |
| NFR-SEC-09 | Backups and restore tests | Procedure in `docs/DEPLOYMENT.md` | ⚙️ |
| NFR-SEC-10 | Restrict and record production data access | Hosting control; checklist item in `docs/DEPLOYMENT.md` | ⚙️ |
| NFR-SEC-11 | Retention, archival, secure deletion | Retention policies; deletion needs a second approver | ✅ |
| NFR-SEC-12 | No patient-identifiable data as evidence | Warning in the upload dialog; hospital policy | ✅ |

## 9. Non-functional requirements (SRS §8)

| SRS | Requirement | Evidence | Status |
| --- | --- | --- | --- |
| NFR-01 | 95 % of page requests under 3 s | 12,133 API reads on the local server: median 12 ms, 95th percentile 49 ms, slowest 753 ms, 100 % under 3 s. Needs repeating under agreed load in UAT | 🟡 |
| NFR-02 | Availability target | Hosting decision | ⏳ |
| NFR-03 | Add departments, sites, users, periods without redesign | Multi-organisation, multi-branch model; several organisations run side by side | ✅ |
| NFR-04 | A trained user can answer an item and attach evidence | Walkthrough and user guide; Meridian users did it in the live run | ✅ |
| NFR-05 | Chrome, Edge, Firefox | Tested in Chrome and Chromium (Playwright); Edge uses the same engine; Firefox not yet tested | 🟡 |
| NFR-06 | Documented components; separate environments | `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`; separate dev and test databases | ✅ |
| NFR-07 | Agreed RPO/RTO, restore tests | Hosting decision; procedure documented | ⏳ |
| NFR-08 | Every critical action tied to a user and time | Audit events carry actor and timestamp | ✅ |
| NFR-09 | Contrast, keyboard use, clear labels | Labelled controls, focus styles, light and dark themes | ✅ |
| NFR-10 | English; configurable time zone and dates | **Settings → Regional settings → Time zone (added 17 Nov)**; screens and PDF follow it; default Asia/Kolkata | ✅ |

## 10. Business logic and validation (SRS §9, §10)

| Requirement | Where | Verified | Status |
| --- | --- | --- | --- |
| Configurable scoring: C = 1, PC = 0.5, NC = 0; N/A and Not assessed excluded only by rule | Scoring policies (versioned) | `unit.test › compliance scoring` | ✅ |
| Not assessed and N/A shown separately | Dashboard status counts | Live | ✅ |
| Evidence coverage = items with required evidence attached ÷ items requiring evidence | `metrics` service | `unit.test › evidence coverage` | ✅ |
| Overdue = target date passed and not closed | Findings and actions lists, dashboard | `workflow.test` | ✅ |
| Scoring changes versioned; issued reports unchanged | Policy pinned per assessment; reports immutable | `workflow.test › report immutability` | ✅ |
| Block submission with missing mandatory answers | Submit validation | `workflow.test › AT-04` | ✅ |
| Reasons for N/A, evidence rejection, reopen, closure override | Each requires text | `workflow.test › AT-06`; `closeFinding` | ✅ |
| Clear errors for file type, size, upload failure, expired session, permission | Error messages and toasts | `unit.test › evidence file validation` | ✅ |
| No duplicate submission from repeated clicks | Conditional status update; buttons show loading | `requirements.test › SRS §10` (two parallel submits → one accepted) | ✅ |
| Preserve unsaved work and warn before leaving | Workspace warns on page leave | Code: `WorkspacePage` | ✅ |

## 11. Acceptance scenarios (SRS §11)

| ID | Scenario | Test | Result |
| --- | --- | --- | --- |
| AT-01 | Admin creates hospital, site, IT department, user roles | `workflow.test › AT-01` | ✅ Pass |
| AT-02 | Publish checklist v1 and create assessment | `workflow.test › AT-02`; E2E | ✅ Pass |
| AT-03 | IT user answers and uploads evidence | `workflow.test › AT-03`; E2E | ✅ Pass |
| AT-04 | Submission with missing answers blocked | `workflow.test › AT-04` | ✅ Pass |
| AT-05 | Complete submission protected from editing | `workflow.test › AT-05`; E2E | ✅ Pass |
| AT-06 | Auditor rejects evidence, requests clarification, owner notified | `workflow.test › AT-06` | ✅ Pass |
| AT-07 | Finding with corrective action visible on dashboard | `workflow.test › AT-07`; E2E | ✅ Pass |
| AT-08 | Closure only after authorised verification | `workflow.test › AT-08`; E2E | ✅ Pass |
| AT-09 | Approval generates and stores the final PDF | `workflow.test › AT-09`; E2E | ✅ Pass |
| AT-10 | Other branch's evidence denied and logged | `workflow.test › AT-10`; E2E | ✅ Pass |
| AT-11 | Edits after submission blocked unless reopened | `workflow.test › AT-11` | ✅ Pass |
| AT-12 | Dashboard by period and site reconciles | `workflow.test › AT-12` | ✅ Pass |

## 12. BRD success criteria (§11)

| Criterion | Status |
| --- | --- |
| IT checklist published with an approved version and period | ✅ (named reviewer publishes; the author cannot) |
| Users can do only what their role allows | ✅ (roles, scope, per-user restrictions, separation of duties) |
| IT users complete, save, submit and answer clarifications | ✅ |
| Auditors review evidence, record findings, verify actions | ✅ |
| Final PDF only after review/approval, stored centrally | ✅ |
| Dashboard figures match the records | ✅ (AT-12) |
| Audit trail covers create, update, submit, review, approve, export | ✅ |
| Stakeholders sign off test scenarios | ⏳ Needs the hospital sign-off (BRD §13, SRS §15) |

## 13. Open decisions (SRS §13) and how the app is set today

| Decision | Current setting in the app |
| --- | --- |
| Hosting | Reference deployment in `docs/DEPLOYMENT.md`; local Docker for the pilot |
| Identity | Local accounts; TOTP MFA available; SSO not built |
| Assessment cycle | Quarterly by default (Indian financial year); reminders 3 days before due dates |
| Checklist source | Excel import; named reviewer approves before publishing |
| Evidence storage | Private S3-compatible bucket; 25 MB; PDF, DOCX, XLSX, CSV, PNG, JPG; retention configurable |
| Approval workflow | Separate ISMS approval on by default (Settings → *Separate approval step*) |
| Branches | Several branches and organisations supported from day one |
| Scoring | SRS §9 default (C = 1, PC = 0.5, NC = 0; N/A excluded) |
| Service levels | To be agreed |
| Report format | Header, footer and sign-off roles configurable in Settings |
| Time zone | Asia/Kolkata by default; change in Settings → Regional settings |

## Items to raise with the hospital

1. **MFA enforcement (NFR-SEC-04):** today privileged users are prompted to enrol; if the decision is "MFA mandatory", the next step is to block privileged accounts until they enrol.
2. **Firefox (NFR-05):** run the browser test suite in Firefox during UAT.
3. **Performance (NFR-01):** repeat the timing check under the agreed UAT load.
4. **Deployment items (NFR-SEC-01, 05, 09, 10, NFR-02, 07):** confirm hosting, encryption, backup and service-level choices.
5. **SSO:** optional in the SRS; decide whether the pilot needs it.
