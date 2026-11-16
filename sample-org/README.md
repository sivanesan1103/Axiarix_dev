# Sample organisation – Sunrise Care Hospitals (Sample)

Fictitious data for demonstrating onboarding a **new organisation** in Axiarix.
No real people, hospitals or mailboxes: every e-mail uses the reserved `example.org` domain.

| File | What it is | Used by |
|---|---|---|
| `01-organisation-setup.xlsx` | Organisation details, 3 branches, 5 departments, 14 users with roles, scope and optional per-user restrictions | *New organisation* wizard (planned), or manual entry under Hospitals & Branches / Users |
| `02-checklist-internal-audit.xlsx` | Two checklist sheets in the same layout as the Kauvery workbook: **IT – IA Checklist** (28 questions) and **Biomedical – IA Checklist** (8 questions) | Checklist Library → *Import from Excel* (works today) |

## What the data exercises

- **Branch-scoped admin** – `branchadmin.north@…` is a System Administrator limited to *Sunrise North*; should not be able to manage other branches or create organisation-wide admins.
- **Limited power for selected users** – the *Restricted permissions* column removes specific permissions from one user without changing the role:
  - Deputy ISMS Manager: cannot approve assessments/reports or change settings.
  - Trainee Auditor: can review but cannot raise findings or verify corrective actions.
  - Systems Administrator (contributor): can answer but cannot upload evidence.
- **Checklist mapping review** – question 4 (*Statement of Applicability*) has clause `6.1` with an empty Controls cell. The importer flags it as ambiguous, so the review-before-publish step has something to resolve.
- **Multiple departments** – the Biomedical sheet is meant to be imported as a separate checklist and assessed by the Biomedical department.

## Verified

Both checklist sheets were parsed with the app's own importer (`backend/src/modules/imports/excel-parser.ts`):

| Sheet | Rows | Errors | Warnings / flagged |
|---|---|---|---|
| IT – IA Checklist | 28 | 0 | 1 (intentional, row 10) |
| Biomedical – IA Checklist | 8 | 0 | 0 |

The auditee/auditor columns (Evidence status, Strengths, Observations…) are intentionally blank – answers are entered in the app, not invented here.
