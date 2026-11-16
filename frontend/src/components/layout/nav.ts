import {
  BarChart3,
  Building2,
  CalendarRange,
  ClipboardCheck,
  FileBarChart2,
  FolderLock,
  Globe2,
  LayoutGrid,
  ListChecks,
  ScrollText,
  Settings,
  ShieldCheck,
  Siren,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Visible when the user holds any of these permissions (empty = everyone). Matches the route guard. */
  any: string[];
  group: 'platform' | 'programme' | 'audit' | 'admin' | 'account';
}

export const GROUP_LABEL: Record<NavItem['group'], string> = {
  platform: 'Platform',
  programme: 'Programme',
  audit: 'Audit',
  admin: 'Administration',
  account: '',
};

/**
 * Sidebar items. Each item's `any` is the same permission list as its route guard in
 * routes/router.tsx, so a person sees a menu item exactly when they can open the page.
 * Visibility is a convenience; the API enforces access.
 */
export const NAV: NavItem[] = [
  { to: '/platform', label: 'Organisations', icon: Globe2, any: ['platform:manage'], group: 'platform' },
  { to: '/', label: 'Dashboard', icon: BarChart3, any: ['dashboard:read'], group: 'programme' },
  { to: '/checklists', label: 'Checklist Library', icon: ListChecks, any: ['checklist:read'], group: 'programme' },
  { to: '/assessments', label: 'Assessment Periods', icon: CalendarRange, any: ['assessment:read'], group: 'programme' },
  { to: '/my-assessments', label: 'My Assessments', icon: ClipboardCheck, any: ['response:update'], group: 'programme' },
  { to: '/evidence', label: 'Evidence Repository', icon: FolderLock, any: ['evidence:read'], group: 'programme' },
  { to: '/auditor', label: 'Auditor Workspace', icon: ShieldCheck, any: ['assessment:review'], group: 'audit' },
  { to: '/findings', label: 'Findings', icon: Siren, any: ['finding:read'], group: 'audit' },
  { to: '/corrective-actions', label: 'Corrective Actions', icon: Wrench, any: ['corrective_action:read'], group: 'audit' },
  { to: '/reports', label: 'Reports & Analytics', icon: FileBarChart2, any: ['report:read'], group: 'audit' },
  { to: '/admin', label: 'Admin Home', icon: LayoutGrid, any: ['organisation:update', 'organisation:create', 'user:create'], group: 'admin' },
  { to: '/organisation', label: 'Hospitals & Branches', icon: Building2, any: ['organisation:read'], group: 'admin' },
  { to: '/users', label: 'Users & Access Control', icon: Users, any: ['user:read'], group: 'admin' },
  { to: '/audit-trail', label: 'Audit Trail', icon: ScrollText, any: ['audit_log:read'], group: 'admin' },
  { to: '/settings', label: 'Settings', icon: Settings, any: [], group: 'account' },
];

/** Breadcrumb labels for path segments. */
export const SEGMENT_LABEL: Record<string, string> = Object.fromEntries(NAV.map((n) => [n.to.replace('/', ''), n.label]));
Object.assign(SEGMENT_LABEL, { '': 'Dashboard', new: 'New', import: 'Import from Excel', versions: 'Version', notifications: 'Notifications', platform: 'Organisations' });
