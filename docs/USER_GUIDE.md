# User guide

Sign in at the Axiarix address with your hospital account. The left icon rail shows only the modules your role can use (hover an icon for its name, or use the panel button in the top bar to expand labels). The top bar holds the page title and breadcrumbs, global search, the **site** and **assessment period** selectors (they filter dashboards and lists), notifications and your profile.

## Everyone

- **Dashboard** – compliance score, questions, evidence coverage, completion, open findings, overdue actions, pending approvals; charts by ISO clause / Annex A theme, status distribution, findings by severity, corrective-action progress, quarterly trend, branch comparison, recent activity and your pending tasks.
- **Light / dark mode** – the sun/moon button in the top bar switches theme; **Settings → Profile & security → Appearance** offers Light, Dark or System (follow your computer). The choice is remembered in this browser.
- **Settings → Profile & security** – change your password; set up two-step verification (MFA) with an authenticator app.
- **Notifications** (bell) – assignments, clarifications, rejections, findings, approvals and deadlines. The same messages are e-mailed when e-mail is enabled.

## System Administrator

- **Hospitals & Branches** – edit the organisation, add branches (sites) and departments, set department owners, activate or deactivate.
- **Users & Access Control** – invite users (they receive a set-password link), assign roles with an organisation, branch or department scope, deactivate with a reason (sessions end immediately). On the *Roles & permissions* tab, adjust the permission matrix for non-admin roles.
- **Settings** – workflow (approval step, clarification, N/A acceptance), security (MFA enforcement, lock-out), uploads (formats, size), scoring policy versions, retention and secure-deletion requests, notifications (SMTP test, reminders), report configuration, assessment schedules.
- **Audit Trail** – filter and export events; *Verify integrity* checks the hash chain.

## ISMS / Compliance Owner

1. **Checklist Library → Import from Excel** – upload the workbook, review detected worksheets and column mapping, preview rows (errors, warnings, mapping reviews, duplicates), choose rows, then confirm. Each worksheet becomes a Draft checklist. *Import history* lists uploads and lets you download an error report.
2. **Edit the draft** – add, edit, reorder and delete questions; map ISO clauses, Annex A controls, internal policies and risks; set owner, priority and evidence rules. Questions marked ⚠ came from an ambiguous source column: open them, correct the mapping if needed, and save to confirm.
3. **Submit for review → Publish.** Published versions are locked; use *New version* to change them. Assessments keep the version they were created from.
4. **Assessment Periods → New assessment** – choose site, department, period (defaults to the current FY quarter), published checklist version, owner and dates; then *Assign to department*.
5. **Approve** – when the auditor has reviewed, open the assessment and choose *Approve & issue report* (or *Reject* with a reason). The final PDF is generated and stored under **Reports & Analytics**.
6. **Reopen** – if a submitted or closed assessment must change, choose *Reopen* and give a reason. Earlier submissions and reports are kept.

## IT Department Owner

- **My Assessments** – open the assessment workspace. Assign questions to control owners from the assessment page (*Questions & assignments*, select rows, *Assign / reassign*).
- Answer questions, attach evidence, and when everything is complete choose **Submit for audit**. The submit dialog lists any incomplete questions; click one to jump to it.
- If the auditor requests clarification, only the flagged questions reopen. Update the answer or upload a new evidence version, reply in the thread, then **Re-submit**.
- **Findings** – plan corrective actions (root cause, immediate correction, corrective action, owner, target date).

## IT Control Owner / Contributor

- **My Assessments** lists your assessments and open question assignments (overdue ones in red).
- In the workspace: pick a status (Compliant, Partially compliant, Non-compliant, Not applicable, Not assessed), add comments, and give a justification for Not applicable (required). Use **Upload evidence** (PDF, DOCX, XLSX, CSV, PNG, JPG). Files are scanned for malware; do not upload patient-identifiable data.
- The panel also shows **Previous audit observations** from the source workbook (strengths, opportunities for improvement, observations, remarks).
- **Corrective Actions** – post progress updates, upload closure evidence, and *Submit for verification*.

## Auditor

- **Auditor Workspace** – queue of submitted assessments, evidence awaiting verification, clarifications, open and high-severity findings, actions awaiting verification, completed reviews.
- Open an assessment and choose **Start review**. For each question: preview or download evidence; **Accept** or **Reject** (reason required); **Accept answer** (needed for N/A answers when that rule is on); **Request clarification**; **Add comment**; **Raise finding** (category, severity, owner, due date).
- **Submit review** with your overall opinion. Open rejections or clarifications send the assessment back to IT; otherwise it moves to *Pending approval* (or *Reviewed*, then *Finalise*, when no approval step is configured).
- **Corrective Actions** – *Verify closure* or *Return* with a comment. Then **Findings → Verify & close**.

## Management Viewer

Read-only dashboards, findings and corrective-action status, and **Reports & Analytics** (view or download final PDFs, export findings and actions). Use the site and period selectors for consolidated or branch-wise views.

## Reports

Final PDF reports include hospital, branch, department, period, assessment ID, checklist version, scope, executive summary, compliance score, clause-wise and Annex A results, evidence coverage and register, findings, corrective-action status, auditor opinion, approval details, timestamp, report version and sign-off lines. Each re-approval creates a new version; earlier versions are never changed.
