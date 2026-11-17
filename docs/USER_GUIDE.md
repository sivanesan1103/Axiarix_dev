# User guide

This is the short, role-by-role reference. The full tutorial with screenshots is [USER_GUIDE_AND_WORKFLOW.md](USER_GUIDE_AND_WORKFLOW.md), and every BRD/SRS requirement is traced in [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md).

Sign in at the Axiarix address with your hospital account. The left icon rail shows only the modules your role can use (hover an icon for its name, or use the panel button in the top bar to expand labels). The top bar holds the page title and breadcrumbs, global search, the **site** and **assessment period** selectors (they filter dashboards and lists), notifications and your profile.

## Everyone

- **Dashboard** – compliance score, questions, evidence coverage, completion, open findings, overdue actions, pending approvals; charts by ISO clause / Annex A theme, status distribution, findings by severity, corrective-action progress, quarterly trend, branch or department comparison, recent activity and your **Pending tasks** (everything given to you). A department filter sits next to the welcome line.
- **Search** (top bar) – assessments, findings, checklists, checklist questions, reports and evidence you can access.
- **Light / dark mode** – the sun/moon button in the top bar switches theme; **Settings → Profile & security → Appearance** offers Light, Dark or System (follow your computer). The choice is remembered in this browser.
- **Settings → Profile & security** – change your password; set up two-step verification (MFA) with an authenticator app.
- **Notifications** (bell) – assignments, clarifications, rejections, findings, approvals and deadlines. The same messages are e-mailed when e-mail is enabled.

## Platform owner

- **Organisations** – create an organisation with the 5-step wizard (or load the setup workbook), import its checklists as drafts, suspend or reactivate it. The platform owner sees no hospital data.

## System Administrator

- **Hospitals & Branches** – edit the organisation, add branches (sites) and departments, set department owners, activate or deactivate.
- **Users & Access Control** – invite users (they receive a set-password link), assign roles with an organisation, branch or department scope, deactivate with a reason (sessions end immediately), and **Restrict permissions** to take chosen permissions away from one person (with a reason and optional end date). On the *Roles & permissions* tab, adjust the permission matrix for non-admin roles. Branch administrators manage only their branch; nobody changes their own access.
- **Settings** – workflow (approval step, clarification, N/A acceptance), security (MFA enforcement, lock-out), uploads (formats, size), scoring policy versions, retention and secure-deletion requests, notifications (SMTP test, reminders), report configuration, assessment schedules, and **Regional settings** (time zone used on every screen and in reports; default Asia/Kolkata).
- **Audit Trail** – filter and export events; *Verify integrity* checks the hash chain.

## ISMS / Compliance Owner

1. **Checklist Library → Import from Excel** – upload the workbook, review detected worksheets and column mapping, preview rows (errors, warnings, mapping reviews, duplicates), choose rows, then confirm. Each worksheet becomes a Draft checklist. *Import history* lists uploads and lets you download an error report.
2. **Edit the draft** – add, edit, reorder and delete questions; map ISO clauses, Annex A controls, internal policies and risks; set owner, priority and evidence rules. Questions marked ⚠ came from an ambiguous source column: open them, correct the mapping if needed, and save to confirm.
3. **Submit for review**, naming a reviewer who can approve checklists. The reviewer comments, confirms each flagged mapping and **Publishes**; the author cannot publish their own checklist. Published versions are locked; use *New version* to change them. Assessments keep the version they were created from.
4. **Assessment Periods → New assessment** – choose site, department, period (defaults to the current FY quarter), published checklist version and dates. The department's owner is filled in; only IT Department Owners of that department are offered. Then *Assign to department*. If the owner must change later, use **Change owner** (with a reason).
5. **Approve** – when the auditor has reviewed (you cannot approve an assessment you prepared or audited), open the assessment and choose *Approve & issue report* (or *Reject* with a reason). The final PDF is generated and stored under **Reports & Analytics**.
6. **Reopen** – if a submitted or closed assessment must change, choose *Reopen* and give a reason. Earlier submissions and reports are kept.

## IT Department Owner

- **My Assessments** – open the assessment workspace. Assign questions to control owners from the assessment page (*Questions & assignments*, select rows, *Assign / reassign*). Only people from the assessment's department are offered; they see the work in their Pending tasks.
- Answer questions, attach evidence, and when everything is complete choose **Submit for audit**. The submit dialog lists any incomplete questions; click one to jump to it.
- If the auditor requests clarification, only the flagged questions reopen. Update the answer or upload a new evidence version, reply in the thread, then **Re-submit**.
- **Findings** – plan corrective actions (root cause, immediate correction, corrective action, owner, target date). If a team member cannot upload evidence, attach the files for them.

## IT Control Owner / Contributor

- **My Assessments** lists your assessments and open question assignments (overdue ones in red).
- In the workspace: pick a status (Compliant, Partially compliant, Non-compliant, Not applicable, Not assessed), add comments, and give a justification for Not applicable (required). Use **Upload evidence** (PDF, DOCX, XLSX, CSV, PNG, JPG). Files are scanned for malware; do not upload patient-identifiable data.
- The panel also shows **Previous audit observations** from the source workbook (strengths, opportunities for improvement, observations, remarks).
- **Findings** you own – click **Plan corrective action** to propose the fix; the auditor verifies it.
- **Corrective Actions** – post progress updates, upload closure evidence, and *Submit for verification*.
- If an administrator restricted your uploads, you can still answer and update actions; a note asks the department owner to attach the files.

## Auditor

- **Auditor Workspace** – queue of submitted assessments, evidence awaiting verification, clarifications, open and high-severity findings, actions awaiting verification, completed reviews.
- Open an assessment and choose **Start review**. For each question: preview or download evidence; **Accept** or **Reject** each file (reason required); **Accept answer** for the answer itself (accepting a file does not accept the answer); **Request clarification**; **Add comment**; **Raise finding** (category, severity, owner, due date).
- **Submit review** with your overall opinion (at least 20 characters). It is available once every answer and file has a decision; *Reviewed X of Y* shows progress. You cannot audit an assessment you helped prepare. Open rejections or clarifications send the assessment back to IT; otherwise it moves to *Pending approval* (or *Reviewed*, then *Finalise*, when no approval step is configured).
- **Corrective Actions** – *Verify closure* or *Return* with a comment. Then **Findings → Verify & close**.

## Management Viewer

Read-only dashboards, findings and corrective-action status, and **Reports & Analytics** (view or download final PDFs, export findings and actions). Use the site and period selectors for consolidated or branch-wise views.

## Reports

Final PDF reports include hospital, branch, department, period, assessment ID, checklist version, scope, executive summary, compliance score, clause-wise and Annex A results, evidence coverage and register, findings, corrective-action status, auditor opinion, approval details, timestamp, report version and sign-off lines. Each re-approval creates a new version; earlier versions are never changed.
