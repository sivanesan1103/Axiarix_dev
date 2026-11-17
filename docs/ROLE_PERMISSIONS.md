# Roles & permissions

Source of truth: `backend/src/constants/permissions.ts`. Each organisation gets its own copy of the roles when it is created, so a change in one organisation never affects another. An organisation-wide System Administrator can adjust non-admin role permissions in **Users & Access Control → Roles & permissions**. Every change is audited (`PERMISSIONS_CHANGED`, with added and removed keys).

A separate **platform owner** account (outside every hospital organisation) creates, suspends and reactivates organisations. It has no access to any organisation's data.

Legend: C create · R read · U update · D delete · As assign · S submit · Rv review · Ap approve · E export · Ro reopen

| Resource | System Administrator | Hospital ISMS / Compliance Owner | IT Department Owner | IT Control Owner / Contributor | Auditor | Management Viewer |
|---|---|---|---|---|---|---|
| organisation | C R U D As S Rv Ap E Ro | R | R | — | R | R |
| user | C R U D As S Rv Ap E Ro | R | R | — | R | — |
| role | C R U D As S Rv Ap E Ro | R | — | — | — | — |
| checklist | C R U D As S Rv Ap E Ro | C R U D Rv Ap E | R | R | R | — |
| assessment | C R U D As S Rv Ap E Ro | C R U As Ap E Ro | R As S E | R | R Rv E | R |
| response | C R U D As S Rv Ap E Ro | R E | R U E | R U | R E | — |
| evidence | C R U D As S Rv Ap E Ro | R E | C R U | C R | R Rv | — |
| finding | C R U D As S Rv Ap E Ro | R U As E | R U As | R | C R U Rv E | R |
| corrective_action | C R U D As S Rv Ap E Ro | R E | C R U As S | R U S | R Rv | R |
| report | C R U D As S Rv Ap E Ro | C R Ap E | R | — | R E | R E |
| audit_log | C R U D As S Rv Ap E Ro | R E | — | — | — | — |
| settings | C R U D As S Rv Ap E Ro | R U Ap | — | — | — | — |
| dashboard | C R U D As S Rv Ap E Ro | R E | R | R | R | R E |


## Scope (organisation / branch / department boundaries)

Each role is granted inside a scope stored on `UserRole`:

| Scope | Meaning |
|---|---|
| `siteId = null` | Organisation-wide (all branches) |
| `siteId` set, `departmentId = null` | One branch, all departments |
| `siteId` + `departmentId` | One department of one branch |

The backend applies the scope to every list (`unitWhere`) and every record (`assertUnitAccess`). Out-of-scope access returns **403** and writes an `ACCESS_DENIED` audit event (AT-10). Evidence inherits its unit from the record it is attached to, so a branch's evidence can never be filed under another branch.

## Per-user restrictions

An administrator can remove chosen permissions from one person without changing their role (Users → ⋯ → **Restrict permissions**), with a reason and an optional end date. The server subtracts restricted permissions from every role the person holds, and the screens hide the matching buttons (upload, raise finding, change answers and so on). Administrators cannot restrict themselves.

## Separation of duties

| Rule | Enforcement |
|---|---|
| A checklist is published by its named reviewer, never by its author | `submit-review` requires a reviewer; `publish` checks the caller |
| Whoever prepared an assessment (owner, anyone who answered, the submitter) cannot audit it | `sodBlockReason` / `assertSod` |
| Preparers and the auditor cannot approve it | same |
| The owner or submitter of a corrective action cannot verify it | `verifyAction` |
| Nobody changes their own roles, scope or restrictions | users routes |

Blocked people see a *Separation of duties* note, and their Pending tasks leave out the work they cannot do.

## Record-level rules beyond permissions

| Rule | Enforcement |
|---|---|
| Assignees and owners (questions, assessment owner, finding owner, corrective action owner) must work in the record's branch and department | `assertUserCoversUnit` |
| An open assessment's owner can be changed by an ISMS owner or administrator, with a reason | `changeOwner` |
| Contributors answer only questions assigned to them | `assertCanEditItem` |
| Only the department owner (or IT owner/admin) submits | `submitAssessment` |
| Submitted assessments are read-only; changes need a reopen with reason | `ASSESSMENT_LOCKED` (409), audited `RESPONSE_EDIT_BLOCKED` |
| During clarification only flagged questions are editable | `openClarificationItemIds` |
| The finding owner (any role, including a contributor) can plan its corrective action | `createAction` |
| Corrective actions are edited by their owner (or IT owner) | `assertActionEditor` |
| An audit review can be submitted only when every answer and every evidence file has a decision; accepting a file does not accept the answer | `reviewCoverage` |
| Checklist review comments are resolved only by their author or the named reviewer | `resolveReviewComment` |
| Findings close only when every action is verified (or with an override reason when none exist) | `closeFinding` |
| A deletion request cannot be approved by its requester | `decideDeletion` |
| System Administrator permissions cannot be reduced; admins cannot remove their own admin role or deactivate themselves | users and roles routes |

## Assumptions

- A user's permissions are the union of their roles, and their scope is the union of their role scopes. A user holding different roles in different branches therefore receives the combined permissions in all their branches. For the single-department pilot this is acceptable; a per-scope permission model can be introduced if multi-role users become common.
- MFA is available to all users. When **Security policy → Enforce MFA for privileged roles** is on, administrators, ISMS owners and auditors can use nothing but the MFA set-up (plus profile, password change and sign-out) until they enrol, and cannot switch MFA off. An administrator must have MFA before switching enforcement on.
