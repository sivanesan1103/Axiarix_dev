import { downloadFile, get, getPage, patch, post } from '@/api/client';
import type { ActionRow, Comment, EvidenceRow, FindingRow, HistoryEntry } from '@/types/api';

export interface FindingPayload {
  assessmentId: string;
  itemId?: string | null;
  category: string;
  severity: string;
  title: string;
  description: string;
  auditorComments?: string | null;
  ownerId?: string | null;
  dueDate: string;
}

export interface ActionPayload {
  rootCause?: string | null;
  immediateCorrection?: string | null;
  correctiveAction: string;
  ownerId: string;
  targetDate: string;
}

export type FindingDetail = FindingRow & {
  actions: (ActionRow & { owner: { id: string; name: string } })[];
  evidence: EvidenceRow[];
  comments: Comment[];
  history: HistoryEntry[];
  actionsAllowed: { edit: boolean; assign: boolean; planAction: boolean; close: boolean };
};

export type ActionDetail = ActionRow & {
  finding: FindingRow;
  updates: { id: string; note: string; progressPercent: number | null; createdAt: string; author: { id: string; name: string } }[];
  evidence: EvidenceRow[];
  history: HistoryEntry[];
  actionsAllowed: { edit: boolean; submit: boolean; verify: boolean };
  blocked?: { verify?: string };
};

export const findingsService = {
  list: (params: Record<string, unknown>) => getPage<FindingRow>('/findings', params),
  export: (params: Record<string, unknown>, format: 'csv' | 'xlsx') => downloadFile('/findings', { ...params, format }, `findings.${format}`),
  get: (id: string) => get<FindingDetail>(`/findings/${id}`),
  create: (body: FindingPayload) => post<FindingRow>('/findings', body),
  update: (id: string, body: Partial<FindingPayload>) => patch(`/findings/${id}`, body),
  assign: (id: string, ownerId: string, dueDate?: string | null) => post(`/findings/${id}/assign`, { ownerId, dueDate: dueDate || null }),
  createAction: (id: string, body: ActionPayload) => post<ActionRow>(`/findings/${id}/actions`, body),
  close: (id: string, closureRecommendation: string, overrideReason?: string | null) => post(`/findings/${id}/close`, { closureRecommendation, overrideReason: overrideReason || null }),
  comment: (id: string, body: string) => post(`/findings/${id}/comments`, { body }),
};

export const actionsService = {
  list: (params: Record<string, unknown>) => getPage<ActionRow>('/corrective-actions', params),
  export: (params: Record<string, unknown>, format: 'csv' | 'xlsx') => downloadFile('/corrective-actions', { ...params, format }, `corrective-actions.${format}`),
  get: (id: string) => get<ActionDetail>(`/corrective-actions/${id}`),
  update: (id: string, body: Partial<ActionPayload>) => patch(`/corrective-actions/${id}`, body),
  progress: (id: string, note: string, progressPercent?: number | null) => post(`/corrective-actions/${id}/updates`, { note, progressPercent }),
  submit: (id: string, closureNotes: string) => post(`/corrective-actions/${id}/submit`, { closureNotes }),
  verify: (id: string, decision: 'VERIFIED' | 'RETURNED', comment?: string) => post(`/corrective-actions/${id}/verify`, { decision, comment }),
};
