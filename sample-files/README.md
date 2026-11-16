# Axiarix sample files

Fictitious business documents and Excel workbooks for testing Axiarix. Every file belongs to the invented organisations **Sunrise Care Hospitals (Sample)** or **Meridian Diagnostics (Sample)**; no real organisation, person or record is represented. E-mails use the reserved `example.org` domain.

All files were checked on 16 Nov 2026 with the app's own code: every evidence file passes the upload check and malware scan, the three files in folder 5 are refused, all checklists import with 0 errors, and the Meridian setup workbook validates with 0 problems.

| Type | Count |
| --- | --- |
| XLSX | 21 |
| PDF | 11 |
| CSV | 4 |
| DOCX | 3 |
| PNG | 1 |
| TXT | 1 |

## 1. Organisation setup (Excel)

| File | What it is | Where to use it |
| --- | --- | --- |
| `sunrise-care-organisation-setup.xlsx` | Sunrise Care (Sample): 3 branches, 5 departments, 14 users, 3 restricted users | Organisations → New organisation → Load setup workbook (already created on this machine, so the wizard will report it as a duplicate) |
| `meridian-diagnostics-organisation-setup.xlsx` | Second fictitious organisation: 2 branches, 4 departments, 9 users (1 restricted) | Organisations → New organisation → Load setup workbook → creates a fresh organisation |
| `blank-organisation-setup-template.xlsx` | Empty template with the four sheets and headers | Fill in for a real onboarding |

## 2. Checklists (Excel, importer layout)

| File | What it is | Where to use it |
| --- | --- | --- |
| `it-and-biomedical-ia-checklist.xlsx` | Two sheets: IT – IA Checklist (28 questions) and Biomedical – IA Checklist (8) | Checklist Library → Import from Excel (question 4 is flagged on purpose) |
| `hr-information-security-checklist.xlsx` | HR checklist, 12 questions (Annex A people controls 6.1–6.8) | Checklist Library → Import from Excel |
| `physical-environmental-security-checklist.xlsx` | Physical & environmental checklist, 10 questions (Annex A 7.x) | Checklist Library → Import from Excel |
| `blank-checklist-template.xlsx` | Empty checklist in the importer layout (title rows 2–4, headers on row 6) | Copy, add questions from row 7, import |

## 3. Evidence – one file per IT checklist question

| File | What it is | Where to use it |
| --- | --- | --- |
| `IA-001_Information-Security-Policy-v3.pdf` | Approved information security policy v3 | Evidence for IA-001 (A.5.1, clauses 5.2, 7.4) |
| `IA-002_ISMS-RACI-Matrix.xlsx` | RACI matrix showing segregation of duties | Evidence for IA-002 (A.5.2, A.5.3) |
| `IA-003_Risk-Register-and-Treatment-Plan-FY2026-27.xlsx` | Risk register with likelihood × impact scores and treatment | Evidence for IA-003 (clauses 6.1, 8.2, 8.3) |
| `IA-004_Statement-of-Applicability-v2.xlsx` | SoA extract with applicability and justifications | Evidence for IA-004 (clause 6.1) |
| `IA-005_IT-Asset-Inventory-Oct-2026.xlsx` | Asset inventory with owners and classification | Evidence for IA-005 (A.5.9, A.5.10) |
| `IA-006_Information-Classification-Procedure.docx` | Classification and labelling procedure (Word) | Evidence for IA-006 (A.5.12, A.5.13) |
| `IA-007_User-Access-Review-Q3-FY2026-27.xlsx` | Quarterly access review with decisions | Evidence for IA-007 (A.5.15, A.5.18, A.8.2) |
| `IA-008_Joiner-Mover-Leaver-Log-Q3.csv` | Joiner/mover/leaver log with SLA tracking (CSV) | Evidence for IA-008 (A.5.16, A.6.5) |
| `IA-009_MFA-Configuration-Report.pdf` | MFA and password settings report | Evidence for IA-009 (A.5.17, A.8.5) |
| `IA-010_Supplier-Security-Assessment-HIS-Vendor.pdf` | Vendor risk assessment | Evidence for IA-010 (A.5.19, A.5.20, A.5.22) |
| `IA-011_Cloud-Services-Register.xlsx` | Register of approved cloud services | Evidence for IA-011 (A.5.23) |
| `IA-012_Incident-Register-Q3-FY2026-27.xlsx` | Incident register with lessons learned | Evidence for IA-012 (A.5.24, A.5.26, A.5.27) |
| `IA-013_DR-Drill-Report-Sep-2026.pdf` | DR drill results against RTO/RPO | Evidence for IA-013 (A.5.29, A.5.30) |
| `IA-014_Legal-and-Regulatory-Register.xlsx` | Register of legal and regulatory obligations | Evidence for IA-014 (A.5.31, A.5.34) |
| `IA-015_Security-Awareness-Training-Records.csv` | Training completion records (CSV) | Evidence for IA-015 (A.6.3) |
| `IA-016_NDA-Register.xlsx` | NDA register | Evidence for IA-016 (A.6.6) |
| `IA-017_Data-Centre-Access-Log-Oct-2026.csv` | Data centre access log (CSV) | Evidence for IA-017 (A.7.1, A.7.2, A.7.4) |
| `IA-018_UPS-and-Cooling-Maintenance-Report.pdf` | Utilities and environmental maintenance report | Evidence for IA-018 (A.7.5, A.7.11, A.7.13) |
| `IA-019_Media-Disposal-Certificates.xlsx` | Media disposal register | Evidence for IA-019 (A.7.10, A.7.14) |
| `IA-020_Endpoint-Protection-Coverage-Report.pdf` | AV/EDR coverage report | Evidence for IA-020 (A.8.1, A.8.7) |
| `IA-021_Patch-Compliance-Report-Oct-2026.xlsx` | Patch compliance by device group | Evidence for IA-021 (A.8.8, A.8.19) |
| `IA-022_Backup-Restore-Test-Record-Q3.pdf` | Backup schedule and quarterly restore test sign-off | Evidence for IA-022 (A.8.13) – the walkthrough also uses sample-org/sample-evidence.pdf |
| `IA-023_SIEM-Log-Review-Oct-2026.pdf` | Monthly log review summary | Evidence for IA-023 (A.8.15, A.8.16, A.8.17) |
| `IA-024_Network-Diagram-v4.png` | Network diagram with VLAN segmentation (PNG) | Evidence for IA-024 (A.8.20, A.8.21, A.8.22) |
| `IA-025_Change-Register-Q3.xlsx` | Change register with CAB approvals | Evidence for IA-025 (A.8.32) |
| `IA-026_Internal-Audit-Programme-FY2026-27.docx` | Annual internal audit programme (Word) | Evidence for IA-026 (clause 9.2, A.5.35) |
| `IA-027_Management-Review-Minutes-Oct-2026.docx` | Management review minutes (Word) | Evidence for IA-027 (clause 9.3) |
| `IA-028_Nonconformity-and-Corrective-Action-Register.xlsx` | NC and corrective action register | Evidence for IA-028 (clause 10.2) |

## 4. Corrective-action closure evidence

| File | What it is | Where to use it |
| --- | --- | --- |
| `DR-Plan-v2-with-file-server-restore.pdf` | Updated DR plan closing the file-server observation | Closure evidence for a corrective action (e.g. CA from finding "DR plan lacks file-server restore") |
| `Access-Review-Remediation-Nov-2026.xlsx` | Remediation log after the Q3 access review | Closure evidence for an access-control corrective action |
| `Phishing-Simulation-Results-Nov-2026.pdf` | Phishing simulation report | Closure evidence for an awareness corrective action |

## 5. Files the app must refuse

| File | What it is | Where to use it |
| --- | --- | --- |
| `disguised-html-as.pdf` | HTML content with a .pdf name | Upload as evidence → expect refusal (file content does not match .pdf) |
| `notes-unsupported-type.txt` | Plain text file | Upload as evidence → expect refusal (type not allowed) |
| `empty-file.csv` | Zero-byte CSV | Upload as evidence → expect refusal (empty file) |

## Quick ways to use them

- **New organisation:** sign in as `platform@axiarix.local` → Organisations → New organisation → Load setup workbook → `meridian-diagnostics-organisation-setup.xlsx` → create.
- **Checklists:** Checklist Library → Import from Excel → any file in folder 2.
- **Evidence:** open an assessment built from the Sunrise *IT – IA Checklist*; on question IA-0NN upload the file starting with the same code from folder 3.
- **Corrective actions:** on a corrective action, Upload → a file from folder 4 → Submit for verification.
- **Rejection tests:** try uploading each file in folder 5 as evidence; each must be refused with the reason shown.

`manifest.json` lists the same information in machine-readable form.
