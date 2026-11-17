import { get, getPage, patch, post, put } from '@/api/client';
import type { NotificationRow } from '@/types/api';

export interface ScoringPolicy {
  id: string;
  version: number;
  name: string;
  weightCompliant: number;
  weightPartial: number;
  weightNonCompliant: number;
  excludeNotApplicable: boolean;
  excludeNotAssessed: boolean;
  isActive: boolean;
  approvedAt: string | null;
  notes: string | null;
  createdAt: string;
  _count: { assessments: number };
}

export interface RetentionPolicy {
  id: string;
  entityType: 'EVIDENCE' | 'REPORT';
  retentionDays: number;
  action: 'ARCHIVE' | 'REQUEST_DELETION';
  isActive: boolean;
  description: string | null;
}

export interface DeletionRequest {
  id: string;
  entityType: string;
  entityId: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED';
  createdAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  requestedById: string;
  requestedBy: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
}

export interface Schedule {
  id: string;
  siteId: string;
  departmentId: string;
  checklistTemplateId: string;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY';
  nextRunDate: string;
  durationDays: number;
  isActive: boolean;
  site: { id: string; name: string };
  department: { id: string; name: string };
  template: { id: string; title: string };
}

export interface Settings {
  'upload.policy': { maxFileSizeMb: number; allowedExtensions: string[] };
  'workflow.policy': { approvalRequiredByDefault: boolean; clarificationEnabled: boolean; requireAuditorAcceptanceForNA: boolean };
  'security.policy': { enforceMfaForPrivileged: boolean; maxFailedLogins: number; lockoutMinutes: number };
  'notification.policy': { emailEnabled: boolean; events: Record<string, boolean>; deadlineReminderDays: number };
  'locale.config': { timeZone: string };
  'report.config': { headerTitle: string; footerText: string; signOffRoles: string[]; includeEvidenceList: boolean };
}

export interface SetupStatus {
  organisation: { id: string; name: string; legalEntity: string | null };
  scope: 'organisation' | 'site';
  sites: number;
  siteNames: string[];
  departments: number;
  departmentsWithoutOwner: { id: string; name: string; siteId: string }[];
  users: number;
  usersNeverSignedIn: number;
  roleCounts: Record<string, number>;
  checklists: { draft: number; underReview: number; published: number };
  flaggedMappings: number;
  assessments: number;
  schedules: number;
}

export const adminService = {
  setupStatus: () => get<SetupStatus>('/admin/setup-status'),
  settings: () => get<Settings>('/admin/settings'),
  saveSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => put<Settings[K]>(`/admin/settings/${key}`, value),
  testEmail: (to: string) => post('/admin/settings/test-email', { to }),
  runReminders: () => post<{ sent: number }>('/admin/reminders/run'),
  scoringPolicies: () => get<ScoringPolicy[]>('/admin/scoring-policies'),
  createScoringPolicy: (body: Omit<ScoringPolicy, 'id' | 'version' | 'isActive' | 'approvedAt' | 'createdAt' | '_count'>) => post<ScoringPolicy>('/admin/scoring-policies', body),
  activateScoringPolicy: (id: string) => post(`/admin/scoring-policies/${id}/activate`),
  retentionPolicies: () => get<RetentionPolicy[]>('/admin/retention-policies'),
  saveRetention: (entityType: string, body: Omit<RetentionPolicy, 'id' | 'entityType'>) => put(`/admin/retention-policies/${entityType}`, body),
  runRetention: () => post<{ archived: number; deletionRequests: number }>('/admin/retention/run'),
  deletionRequests: () => get<DeletionRequest[]>('/admin/deletion-requests'),
  requestDeletion: (entityType: 'Evidence' | 'Report', entityId: string, reason: string) => post('/admin/deletion-requests', { entityType, entityId, reason }),
  decideDeletion: (id: string, decision: 'APPROVED' | 'REJECTED') => post(`/admin/deletion-requests/${id}/decision`, { decision }),
  executeDeletion: (id: string) => post(`/admin/deletion-requests/${id}/execute`),
  schedules: () => get<Schedule[]>('/admin/schedules'),
  createSchedule: (body: Omit<Schedule, 'id' | 'site' | 'department' | 'template'>) => post<Schedule>('/admin/schedules', body),
  updateSchedule: (id: string, body: Partial<Omit<Schedule, 'id' | 'site' | 'department' | 'template'>>) => patch(`/admin/schedules/${id}`, body),
  runSchedule: (id: string) => post<{ id: string; code: string }>(`/admin/schedules/${id}/run`),
};

export const notificationsService = {
  list: (params: Record<string, unknown>) => getPage<NotificationRow>('/notifications', params),
  read: (id: string) => post(`/notifications/${id}/read`),
  readAll: () => post('/notifications/read-all'),
};

export const searchService = {
  search: (q: string) =>
    get<{ type: 'assessment' | 'finding' | 'checklist' | 'report' | 'evidence' | 'question'; id: string; title: string; subtitle: string; link: string }[]>('/search', { params: { q } }),
};
