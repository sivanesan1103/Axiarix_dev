import { downloadFile, get, getPage, openSignedUrl, post } from '@/api/client';
import type { AuditEventRow, DashboardSummary, ReportRow } from '@/types/api';

export const reportsService = {
  list: (params: Record<string, unknown>) => getPage<ReportRow>('/reports', params),
  get: (id: string) => get<ReportRow & { versions: { id: string; code: string; version: number; generatedAt: string }[] }>(`/reports/${id}`),
  async open(id: string, inline = false) {
    const r = await post<{ url: string }>(`/reports/${id}/download-url`, { inline });
    openSignedUrl(r.url, inline);
  },
  generate: (assessmentId: string) => post<ReportRow>('/reports/generate', { assessmentId }),
};

export const dashboardService = {
  summary: (params: Record<string, unknown>) => get<DashboardSummary>('/dashboard/summary', { params }),
  tasks: () =>
    get<{
      openAssignments: number;
      toSubmit: { id: string; code: string; title: string; status: string; dueDate: string }[];
      toReview: { id: string; code: string; title: string; status: string; dueDate: string }[];
      toApprove: { id: string; code: string; title: string; status: string; dueDate: string }[];
      myActions: { id: string; code: string; correctiveAction: string; targetDate: string; status: string; overdue: boolean }[];
      toVerify: { id: string; code: string; correctiveAction: string; targetDate: string; status: string }[];
    }>('/dashboard/tasks'),
};

export const auditService = {
  list: (params: Record<string, unknown>) => getPage<AuditEventRow>('/audit-logs', params),
  actions: () => get<string[]>('/audit-logs/actions'),
  verify: () => get<{ valid: boolean; checked: number; brokenAtSeq: number | null }>('/audit-logs/verify'),
  export: (params: Record<string, unknown>, format: 'csv' | 'xlsx') => downloadFile('/audit-logs', { ...params, format }, `audit-trail.${format}`),
};
