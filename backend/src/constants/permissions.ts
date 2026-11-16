/**
 * Role-based access control matrix.
 *
 * Permissions are `resource:action` keys. The backend is the authority: every
 * protected route declares the permission it requires, and services additionally
 * enforce organisation / site / department scope and record-level ownership.
 * The frontend only uses these keys to hide actions the user cannot perform.
 */
export const ACTIONS = [
  'create',
  'read',
  'update',
  'delete',
  'assign',
  'submit',
  'review',
  'approve',
  'export',
  'reopen',
] as const;

export const RESOURCES = [
  'organisation',
  'user',
  'role',
  'checklist',
  'assessment',
  'response',
  'evidence',
  'finding',
  'corrective_action',
  'report',
  'audit_log',
  'settings',
  'dashboard',
] as const;

export type Action = (typeof ACTIONS)[number];
export type Resource = (typeof RESOURCES)[number];
export type PermissionKey = `${Resource}:${Action}` | typeof PLATFORM_PERMISSION;

/** Virtual permission held only by platform owners (never stored on a role). */
export const PLATFORM_PERMISSION = 'platform:manage' as const;

/** Permissions that let a user administer people or the organisation structure; these are scope-checked. */
export const ADMIN_PERMISSIONS = ['user:create', 'user:update', 'user:assign', 'role:assign', 'role:update', 'organisation:create', 'organisation:update'] as const;

export const ROLE_KEYS = {
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  ISMS_OWNER: 'ISMS_OWNER',
  IT_OWNER: 'IT_OWNER',
  CONTRIBUTOR: 'CONTRIBUTOR',
  AUDITOR: 'AUDITOR',
  MANAGEMENT: 'MANAGEMENT',
} as const;
export type RoleKey = keyof typeof ROLE_KEYS;

const all = (resource: Resource): PermissionKey[] => ACTIONS.map((a) => `${resource}:${a}` as PermissionKey);
const p = (resource: Resource, ...actions: Action[]): PermissionKey[] =>
  actions.map((a) => `${resource}:${a}` as PermissionKey);

export const ROLE_DEFINITIONS: Record<RoleKey, { name: string; description: string; permissions: PermissionKey[] }> = {
  SYSTEM_ADMIN: {
    name: 'System Administrator',
    description: 'Configures organisation, sites, departments, users, roles, checklists and schedules.',
    permissions: RESOURCES.flatMap(all),
  },
  ISMS_OWNER: {
    name: 'Hospital ISMS / Compliance Owner',
    description: 'Owns the ISMS programme: checklists, assessment periods, approvals and reports.',
    permissions: [
      ...p('organisation', 'read'),
      ...p('user', 'read'),
      ...p('role', 'read'),
      ...p('checklist', 'create', 'read', 'update', 'delete', 'review', 'approve', 'export'),
      ...p('assessment', 'create', 'read', 'update', 'assign', 'approve', 'reopen', 'export'),
      ...p('response', 'read', 'export'),
      ...p('evidence', 'read', 'export'),
      ...p('finding', 'read', 'update', 'assign', 'export'),
      ...p('corrective_action', 'read', 'export'),
      ...p('report', 'create', 'read', 'export', 'approve'),
      ...p('audit_log', 'read', 'export'),
      ...p('settings', 'read', 'update', 'approve'),
      ...p('dashboard', 'read', 'export'),
    ],
  },
  IT_OWNER: {
    name: 'IT Department Owner',
    description: 'Coordinates the IT self-assessment, distributes items and submits to audit.',
    permissions: [
      ...p('organisation', 'read'),
      ...p('user', 'read'),
      ...p('checklist', 'read'),
      ...p('assessment', 'read', 'assign', 'submit', 'export'),
      ...p('response', 'read', 'update', 'export'),
      ...p('evidence', 'create', 'read', 'update'),
      ...p('finding', 'read', 'update', 'assign'),
      ...p('corrective_action', 'create', 'read', 'update', 'submit', 'assign'),
      ...p('report', 'read'),
      ...p('dashboard', 'read'),
    ],
  },
  CONTRIBUTOR: {
    name: 'IT Control Owner / Contributor',
    description: 'Answers assigned control questions, uploads evidence and updates remediation.',
    permissions: [
      ...p('checklist', 'read'),
      ...p('assessment', 'read'),
      ...p('response', 'read', 'update'),
      ...p('evidence', 'create', 'read'),
      ...p('finding', 'read'),
      ...p('corrective_action', 'read', 'update', 'submit'),
      ...p('dashboard', 'read'),
    ],
  },
  AUDITOR: {
    name: 'Auditor',
    description: 'Reviews responses and evidence, raises findings and verifies corrective actions.',
    permissions: [
      ...p('organisation', 'read'),
      ...p('user', 'read'),
      ...p('checklist', 'read'),
      ...p('assessment', 'read', 'review', 'export'),
      ...p('response', 'read', 'export'),
      ...p('evidence', 'read', 'review'),
      ...p('finding', 'create', 'read', 'update', 'review', 'export'),
      ...p('corrective_action', 'read', 'review'),
      ...p('report', 'read', 'export'),
      ...p('dashboard', 'read'),
    ],
  },
  MANAGEMENT: {
    name: 'Management Viewer',
    description: 'Read-only access to dashboards, reports, trends and unresolved risks.',
    permissions: [
      ...p('organisation', 'read'),
      ...p('assessment', 'read'),
      ...p('finding', 'read'),
      ...p('corrective_action', 'read'),
      ...p('report', 'read', 'export'),
      ...p('dashboard', 'read', 'export'),
    ],
  },
};

/** Roles whose accounts must enrol in MFA (NFR-SEC-04). Enforced at login when the policy is on. */
export const PRIVILEGED_ROLES: RoleKey[] = ['SYSTEM_ADMIN', 'ISMS_OWNER', 'AUDITOR'];
