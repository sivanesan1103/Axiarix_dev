import { downloadFile, get, getPage, patch, post, put } from '@/api/client';
import type { AssessmentDetail, AssessmentRow, Comment, HistoryEntry, ItemDetail, Review, ResponseStatus, WorkspaceItem } from '@/types/api';

export interface CreateAssessment {
  title: string;
  siteId: string;
  departmentId: string;
  checklistVersionId: string;
  periodLabel: string;
  /** Derived by the server from the period label; optional. */
  periodStart?: string;
  periodEnd?: string;
  startDate: string;
  dueDate: string;
  ownerId: string;
  scope?: string | null;
  approvalRequired?: boolean;
  assignDefaultOwners?: boolean;
}

export interface MissingItem {
  itemId: string;
  questionCode: string;
  question: string;
  problems: string[];
}

export const assessmentsService = {
  list: (params: Record<string, unknown>) => getPage<AssessmentRow>('/assessments', params),
  periods: () => get<{ periodLabel: string; periodStart: string }[]>('/assessments/periods'),
  myAssignments: (params?: Record<string, unknown>) =>
    get<{ id: string; assessmentId: string; itemId: string; dueDate: string | null; responseStatus: ResponseStatus; completed: boolean; overdue: boolean; item: { questionCode: string; question: string; priority: string }; assessment: { id: string; code: string; title: string; dueDate: string; status: string } }[]>(
      '/assessments/my-assignments',
      { params },
    ),
  get: (id: string) => get<AssessmentDetail>(`/assessments/${id}`),
  create: (body: CreateAssessment) => post<AssessmentRow>('/assessments', body),
  update: (id: string, body: Partial<CreateAssessment>) => patch<AssessmentRow>(`/assessments/${id}`, body),
  items: (id: string, params?: Record<string, unknown>) => get<WorkspaceItem[]>(`/assessments/${id}/items`, { params }),
  item: (id: string, itemId: string) => get<ItemDetail>(`/assessments/${id}/items/${itemId}`),
  saveResponse: (id: string, itemId: string, body: { status: ResponseStatus; comment?: string | null; justification?: string | null }) => put(`/assessments/${id}/responses/${itemId}`, body),
  release: (id: string) => post(`/assessments/${id}/release`),
  assign: (id: string, itemIds: string[], assigneeId: string, dueDate?: string | null) => post(`/assessments/${id}/assign`, { itemIds, assigneeId, dueDate: dueDate || null }),
  unassign: (id: string, itemIds: string[]) => post(`/assessments/${id}/unassign`, { itemIds }),
  validation: (id: string) => get<{ ready: boolean; missing: MissingItem[] }>(`/assessments/${id}/validation`),
  submit: (id: string) => post(`/assessments/${id}/submit`),
  startReview: (id: string) => post(`/assessments/${id}/start-review`),
  submitReview: (id: string, opinion: string) => post(`/assessments/${id}/review/submit`, { opinion }),
  reviewItem: (id: string, itemId: string, body: { decision: Review['decision']; evidenceId?: string | null; reason?: string | null; comments?: string | null }) =>
    post<Review>(`/assessments/${id}/items/${itemId}/review`, body),
  comment: (id: string, itemId: string | null, body: string) => post<Comment>(`/assessments/${id}/comments`, { itemId, body }),
  approval: (id: string, decision: 'APPROVED' | 'REJECTED', comments?: string) => post(`/assessments/${id}/approval`, { decision, comments }),
  finalise: (id: string) => post(`/assessments/${id}/finalise`),
  changeOwner: (id: string, ownerId: string, reason: string) => post(`/assessments/${id}/owner`, { ownerId, reason }),
  reopen: (id: string, reason: string) => post(`/assessments/${id}/reopen`, { reason }),
  history: (id: string) => get<HistoryEntry[]>(`/assessments/${id}/history`),
  export: (id: string, format: 'csv' | 'xlsx') => downloadFile(`/assessments/${id}/export`, { format }, `assessment.${format}`),
};
