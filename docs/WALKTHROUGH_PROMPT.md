# Axiarix – full walkthrough (prompt)

Copy everything below the line into a tester's brief, or give it to an AI agent that can drive a browser.
It walks through every feature in order, using the real accounts and record IDs on this machine as of 16 Nov 2026.

---

You are testing **Axiarix**, an ISO/IEC 27001:2022 compliance app, running locally. Follow each part in order. At every
"Expect" line, check the result and note PASS or FAIL with a one-line reason. Do not skip steps; later parts depend on
earlier ones. Sign out (account menu, top right → **Sign out**) before every "Sign in as".

## Addresses

| What | URL |
| --- | --- |
| App | http://localhost:5174 |
| Mail inbox (Mailpit) | http://localhost:8025 |
| Evidence file to upload | `axiarix_demo/sample-org/sample-evidence.pdf` |
| Setup workbook | `axiarix_demo/sample-org/01-organisation-setup.xlsx` |
| Checklist workbook | `axiarix_demo/sample-org/02-checklist-internal-audit.xlsx` |

## Accounts

| Login ID | Password | Organisation | Role · scope |
| --- | --- | --- | --- |
| platform@axiarix.local | Axiarix@Dev2026 | Axiarix Platform | Platform owner |
| admin@axiarix.local | Axiarix@Dev2026 | Kauvery | System Administrator · organisation |
| isms@axiarix.local | Axiarix@Dev2026 | Kauvery | ISMS / Compliance Owner · organisation |
| itowner@axiarix.local | Axiarix@Dev2026 | Kauvery | IT Department Owner · Vadapalani (KVP) / IT & IT Data Centre |
| contributor@axiarix.local | Axiarix@Dev2026 | Kauvery | Contributor · Vadapalani / IT & IT Data Centre |
| auditor@axiarix.local | Axiarix@Dev2026 | Kauvery | Auditor · organisation |
| management@axiarix.local | Axiarix@Dev2026 | Kauvery | Management Viewer · organisation |
| itowner.alwarpet@axiarix.local | Axiarix@Dev2026 | Kauvery | IT Department Owner · Alwarpet (KAL-DEMO) / IT |
| admin@sunrise-sample.example.org | Sunrise@Demo2026 | Sunrise Care (Sample) | System Administrator · organisation |
| branchadmin.north@sunrise-sample.example.org | Sunrise@Demo2026 | Sunrise Care (Sample) | System Administrator · Sunrise North (SCH-NOR) only |
| auditor.trainee@sunrise-sample.example.org | Sunrise@Demo2026 | Sunrise Care (Sample) | Auditor · restricted: no `finding:create`, no `corrective_action:review` |

## Records that already exist

| ID / name | Where | State |
| --- | --- | --- |
| ASM-2026-0001 "IT & IT Data Centre – Quarterly Internal Assessment" | Kauvery · Vadapalani · Q3 FY2026-27 | Assigned (0/75 answered) |
| ASM-2026-0002, ASM-2026-0003 "E2E Quarterly IA …" | Kauvery · Vadapalani | Approved (test data) |
| "Kauvery Vadapalani IT – Internal Audit Checklist" v1 | Kauvery | Published, 75 questions |
| "Kauvery Vadapalani IT – IA Checklist (Last Year)" v1 | Kauvery | Under review, reviewer Arjun Mehta, 27 questions with flagged mappings, 2 open review comments |
| "IT - IA Checklist" v1 (28 q) and "Biomedical - IA Checklist" v1 (8 q) | Sunrise | Draft |
| FND-2026-0001, FND-2026-0002 | Kauvery | Closed |
| CA-2026-0001, CA-2026-0002 | Kauvery | Verified |
| RPT-2026-0001-v1, RPT-2026-0002-v1 | Kauvery | Final PDF reports |
| Sites KVP, KAL-DEMO (Kauvery) · SCH-CEN, SCH-NOR, SCH-SOU (Sunrise) | | Active |

Records you will create get the next numbers. Expected: **ASM-2026-0004**, **FND-2026-0003**, **CA-2026-0003**,
**RPT-2026-0003-v1**. Write down the actual numbers if they differ.

---

## Part 1 – Platform owner: organisations

1. Sign in as **platform@axiarix.local**.
   Expect: you land on **Organisations** (not a dashboard). Two rows: *Kauvery Hospitals Group* and *Sunrise Care Hospitals (Sample)*, both *Active*, each with branch / user / checklist / assessment counts and administrators.
2. Click **New organisation** → **Load setup workbook** → choose `01-organisation-setup.xlsx`.
   Expect: message *Loaded 3 branches, 5 departments and 14 users*.
3. Click **Next** through *Branches & departments*, *Users*, *Checklist* to *Review & create*.
   Expect on Users: 14 rows; Neha Pillai's *Restricted* shows `assessment:approve, report:approve, settings:update`.
   Expect on Review: a red problem list, including that *Sunrise Care Hospitals (Sample)* already exists and the e-mails already have accounts. **Create organisation** is disabled. (Duplicates are refused.)
4. Go back to **Organisations**. On *Sunrise Care Hospitals (Sample)* click **Suspend**, reason `Walkthrough test`, confirm.
   Expect: status *Suspended*.
5. Open a private window and try to sign in as **admin@sunrise-sample.example.org**.
   Expect: *Invalid e-mail or password* (suspended organisations cannot sign in).
6. Back as platform owner, click **Reactivate**, reason `Walkthrough done`.
   Expect: status *Active*; the Sunrise admin can sign in again.

## Part 2 – Sunrise: Admin Home, branch admin limits, restricted user

7. Sign in as **admin@sunrise-sample.example.org**. Click **Admin Home**.
   Expect: *Setup · 4 of 6 done*; *Published checklist* open with *0 published · 0 in review · 2 draft* and a warning *1 ISO mapping(s) still to resolve in drafts*; *First assessment* open.
8. Open **Users & Access Control**.
   Expect: 14+ users; Neha Pillai, Lata Singh and Meena Iyer show a *restricted* badge; your own row shows *You* (no ⋯ menu).
9. Sign in as **branchadmin.north@sunrise-sample.example.org**. Open **Users & Access Control**.
   Expect: only people with a role in Sunrise North are listed (e.g. Arun Das, Kavya Bose).
10. Click **Invite user**: name `Walkthrough Central`, e-mail `walk.central@sunrise-sample.example.org`, role *IT Control Owner / Contributor*, site **Sunrise Central**. Click **Create user**.
    Expect: refused – *You can only grant roles inside the branch or department you administer*.
11. Change the site to **Sunrise North**, e-mail `walk.north@sunrise-sample.example.org`, **Create user**.
    Expect: created; the new user appears with a ⋯ menu.
12. Open **Hospitals & Branches**.
    Expect: only Sunrise North is shown. Try **Add branch** if visible.
    Expect: refused – only an organisation-wide administrator can add branches.
13. Sign in as **auditor.trainee@sunrise-sample.example.org**. Open the account menu (top right).
    Expect: *2 permission(s) restricted by an administrator*.

## Part 3 – Kauvery: build and publish a checklist with a named reviewer

14. Sign in as **isms@axiarix.local**. Open **Checklist Library** → **New checklist**. Title `Walkthrough Backup Controls`, **Create**.
    Expect: you are on *Version 1 · Draft*.
15. **Add question**: question `Backup restoration is tested every quarter`, description `Restore test record with sign-off`. Under *ISO / control mapping* pick *Annex A control* → `8.13 – Information backup` → **Add** → **Add question**.
    Expect: question Q-001 listed with chip *A.8.13*.
16. Click **Submit for review**. In *Reviewer* choose **Arjun Mehta — System Administrator**. **Submit**.
    Expect: status *Under review*; panel shows Author *Lakshmi Iyer*, Named reviewer *Arjun Mehta*; blue note *You wrote this version, so the named reviewer must publish or return it*; no **Publish** button for you.
17. Sign in as **admin@axiarix.local**. Open the bell → *Checklist review requested: Walkthrough Backup Controls* (or Checklist Library → the checklist → version 1).
    Expect: **Return with comments** and **Publish** are visible and enabled.
18. Click **Add review comment**: `Looks good`. Then **Resolve** it. Click **Publish** → confirm.
    Expect: status *Published*; *Published by Arjun Mehta*; the version is now read-only.
19. Still as admin, open **Kauvery Vadapalani IT – IA Checklist (Last Year)** → version 1.
    Expect: amber banner *27 question(s) have ISO mappings flagged*; **Publish** disabled; note *Publishing stays disabled until 27 flagged mapping(s) are confirmed and 2 open comment(s) are resolved*.
20. Click **Show flagged only**, then **Confirm as correct** under the first question's chips.
    Expect: toast *IA-…: mapping confirmed*; flagged count drops to 26. (Leave the rest.)

## Part 4 – Kauvery: run an assessment

21. Sign in as **isms@axiarix.local**. **Assessment Periods** → **New assessment**.
    - Title `Walkthrough Q3 Backup Assessment`
    - Hospital site **Vadapalani**, Department **IT & IT Data Centre**
    - Checklist version **Walkthrough Backup Controls · v1**
    - Period type **Quarter**, Quarter **Q3 (Oct–Dec)**, Financial year **FY2026-27**
    Expect: line *Period Q3 FY2026-27 · 01 Oct 2026 – 31 Dec 2026*; owner auto-filled *Karthik Raman*.
22. **Create assessment**.
    Expect: *ASM-2026-0004* created as *Draft*. Click **Assign to department** → **Assign**. Expect status *Assigned*.
23. Sign in as **admin@axiarix.local**. Open **Assessment Periods** → *Walkthrough Q3 Backup Assessment*.
    Expect: no **Open workspace** button and no *My Assessments* menu item — System Administrators oversee assessments (Change owner, Export, Reopen) but the department fills them in.
24. Sign in as **itowner@axiarix.local**. **My Assessments** → *ASM-2026-0004*. On Q-001 choose **Compliant**, comment `Restore drill done 02 Nov`, **Save answer**; then click **Upload evidence**, choose `sample-evidence.pdf`, **Upload**.
    Expect: status *In progress*; file listed, scan *Clean*.
25. Click **Submit for audit** → **Submit**.
    Expect: status *Submitted for audit*; workspace read-only.

## Part 5 – Separation of duties and audit review

26. Still as **itowner@axiarix.local**, open ASM-2026-0004 in **Assessment Periods**.
    Expect: read-only; no review buttons. (Whoever prepares an assessment can never audit or approve it: someone holding both an IT owner and an auditor role gets a blue *Separation of duties* note instead of **Start review**. This is covered by the automated test `governance.test › preparers cannot audit`.)
27. Sign in as **auditor@axiarix.local**. **Auditor Workspace** → *Walkthrough Q3 Backup Assessment* → **Start review**.
    Expect: status *Under review*.
28. On Q-001 click **Accept** for the evidence, then **Accept answer** for the answer. Repeat for every other answered question.
    Expect: the file shows *Accepted*, the button changes to *Answer accepted*, and the top shows *Reviewed X of Y* counting up. **Submit review** stays greyed out until every answered question is decided.
29. Click **Raise finding**: severity **Medium**, title `DR plan lacks file-server restore`, description `File-server restore steps are not in the DR plan`. **Raise finding**.
    Expect: *Finding FND-2026-0003* shown.
30. **Submit review**, opinion `Control effective; one observation raised`. **Submit review**.
    Expect: status *Pending approval*.

## Part 6 – Corrective action and verification

31. Sign in as **itowner@axiarix.local**. **Findings** → *DR plan lacks file-server restore* → **Plan corrective action**: root cause `DR template omitted file shares`, corrective action `Add file-server restore to DR plan`, owner **Divya Sundar**, **Save**.
    Expect: action *CA-2026-0003* listed.
32. Sign in as **contributor@axiarix.local**. **Corrective Actions** → *CA-2026-0003* → **Upload** → `sample-evidence.pdf` → **Upload**. Then **Submit for verification**, notes `DR plan v2 approved`, **Submit**.
    Expect: status *Awaiting verification*.
33. Sign in as **auditor@axiarix.local**. Open *CA-2026-0003* → **Verify closure** → **Verify**.
    Expect: *Verified*. Open the linked finding → **Verify & close**, recommendation `Observation closed`, **Close finding**. Expect *Verified / closed*.

## Part 7 – Approval and final report

34. Sign in as **admin@axiarix.local**. Open ASM-2026-0004.
    Expect: *Separation of duties* note (*You prepared this assessment, so someone else must approve it*); no **Approve** button.
35. Sign in as **isms@axiarix.local**. Open ASM-2026-0004 → **Approve & issue report** → **Approve**.
    Expect: status *Approved / closed*.
36. Open **Reports & Analytics**.
    Expect: *RPT-2026-0003-v1* for *Walkthrough Q3 Backup Assessment*; the eye icon opens the PDF.

## Part 8 – Filters, scope, search, restrictions, audit trail

37. As **isms@axiarix.local**, click the **Scope** button (crosshair, top bar). Hospital/branch **Vadapalani**, period **Q3 FY2026-27**.
    Expect: button reads *Vadapalani · Q3 FY2026-27* and turns purple.
38. Open **Assessment Periods**, set status **Approved / closed**.
    Expect: *Filtered by* row with *Branch Vadapalani*, *Period Q3 FY2026-27*, *Status Approved / closed*; the page address contains `site=`, `period=` and `status=`. Press **Refresh**: the same filters remain. Click **Clear all**.
39. Press **⌘K** (Ctrl+K), type `Walkthrough`.
    Expect: the checklist *Walkthrough Backup Controls* and assessment *ASM-2026-0004 · Walkthrough Q3 Backup Assessment* appear; clicking one opens it. Then search `FND-2026-0003`: the finding appears.
40. Sign in as **admin@axiarix.local**. **Users** → ⋯ on *Rahul Varma* → **Restrict permissions**. Untick **Finding · Create**, reason `Walkthrough restriction`, **Save restrictions**.
    Expect: *1 restricted* badge on Rahul's row.
41. Sign in as **auditor@axiarix.local**. Open the account menu.
    Expect: *1 permission(s) restricted by an administrator*.
42. Sign in as **admin@axiarix.local**, open Rahul's **Restrict permissions** again, tick **Finding · Create** back, reason `Walkthrough over`, save.
    Expect: badge gone.
43. Try to edit your own roles: on your own row there is no ⋯ menu (*You*).
44. Open **Audit Trail**. Search `RESTRICTIONS`.
    Expect: two *USER_RESTRICTIONS_CHANGED* events with the reasons. Click **Verify integrity**. Expect: the chain is reported valid (green shield).
45. Sign in as **management@axiarix.local**.
    Expect: Dashboard, Assessment Periods, Findings, Corrective Actions, Reports & Analytics, Hospitals & Branches and Settings only; no create or edit buttons anywhere.
46. Sign in as **itowner.alwarpet@axiarix.local** and open `http://localhost:5174/my-assessments/<id of ASM-2026-0001>` (copy the id from the address bar while signed in as isms).
    Expect: *This record belongs to a site or department outside your access scope*.

## Part 9 – Phone width

47. Narrow the browser to about 390 px wide (or use device mode) and open the Dashboard as **isms@axiarix.local**.
    Expect: menu icon, search icon and Scope button in the top bar; no sideways scrolling; the sidebar opens from the menu icon.

## Report

Finish with a table: step number, PASS/FAIL, note. List every FAIL with what you saw and a screenshot.
Created during this walkthrough: checklist *Walkthrough Backup Controls*, user *walk.north@sunrise-sample.example.org*,
ASM-2026-0004, FND-2026-0003, CA-2026-0003, RPT-2026-0003-v1. They can be removed with a database reset
(see the user guide, *Resetting the demo data*).
