import { del, downloadFile, get, getPage, patch, post, put } from '@/api/client';
import type { ChecklistItem, ChecklistTemplate, ChecklistVersion, ControlMapping, HistoryEntry, IsoReference } from '@/types/api';

export type ItemPayload = Partial<Omit<ChecklistItem, 'id' | 'versionId' | 'questionCode' | 'sequence' | 'mappings' | 'defaultOwner' | 'sourceRowId'>>;
export type MappingPayload = Pick<ControlMapping, 'type' | 'reference'> & { title?: string | null };

type Person = { id: string; name: string } | null;

/** Four-eyes review state for a checklist version, computed by the server for the current user. */
export interface VersionReview {
  author: Person;
  submittedBy: Person;
  reviewer: Person;
  publishedBy: Person;
  openComments: number;
  canPublish: boolean;
  canReturn: boolean;
  canConfirmMappings: boolean;
  blocked: string | null;
}

export interface ReviewCommentRow {
  id: string;
  versionId: string;
  itemId: string | null;
  item: { id: string; questionCode: string } | null;
  body: string;
  createdAt: string;
  resolvedAt: string | null;
  author: Person;
  resolvedBy: Person;
  canResolve: boolean;
}

export const checklistsService = {
  list: (params: Record<string, unknown>) => getPage<ChecklistTemplate>('/checklists', params),
  get: (id: string) => get<ChecklistTemplate & { history: HistoryEntry[] }>(`/checklists/${id}`),
  create: (body: { title: string; description?: string | null; category?: string | null }) => post<ChecklistTemplate>('/checklists', body),
  update: (id: string, body: { title?: string; description?: string | null; category?: string | null }) => patch(`/checklists/${id}`, body),
  newVersion: (id: string, changeSummary: string, fromVersionId?: string) => post<ChecklistVersion>(`/checklists/${id}/versions`, { changeSummary, fromVersionId }),
  publishedVersions: () => get<(ChecklistVersion & { template: { id: string; title: string } })[]>('/checklists/published-versions'),
  version: (versionId: string, params?: Record<string, unknown>) =>
    get<ChecklistVersion & { template: ChecklistTemplate; items: ChecklistItem[]; flaggedCount: number; review: VersionReview }>(`/checklists/versions/${versionId}`, { params }),
  eligibleReviewers: (versionId: string) => get<{ id: string; name: string; email: string; designation: string | null; roles: string[] }[]>(`/checklists/versions/${versionId}/eligible-reviewers`),
  reviewComments: (versionId: string) => get<ReviewCommentRow[]>(`/checklists/versions/${versionId}/review-comments`),
  addReviewComment: (versionId: string, body: string, itemId?: string | null) => post<ReviewCommentRow>(`/checklists/versions/${versionId}/review-comments`, { body, itemId: itemId ?? null }),
  resolveReviewComment: (commentId: string) => post(`/checklists/review-comments/${commentId}/resolve`),
  confirmMappings: (itemId: string, note?: string) => post<ChecklistItem>(`/checklists/items/${itemId}/mappings/confirm`, { note: note || null }),
  addItem: (versionId: string, body: ItemPayload & { mappings: MappingPayload[] }) => post<ChecklistItem>(`/checklists/versions/${versionId}/items`, body),
  updateItem: (itemId: string, body: ItemPayload) => patch<ChecklistItem>(`/checklists/items/${itemId}`, body),
  deleteItem: (itemId: string) => del(`/checklists/items/${itemId}`),
  setMappings: (itemId: string, mappings: MappingPayload[]) => put<ChecklistItem>(`/checklists/items/${itemId}/mappings`, { mappings }),
  reorder: (versionId: string, itemIds: string[]) => post(`/checklists/versions/${versionId}/reorder`, { itemIds }),
  transition: (versionId: string, op: 'submit-review' | 'return-to-draft' | 'publish' | 'archive', body: { reason?: string; reviewerId?: string } = {}) =>
    post<ChecklistVersion>(`/checklists/versions/${versionId}/${op}`, body),
  isoReferences: () => get<IsoReference[]>('/checklists/iso-references'),
  exportVersion: (versionId: string) => downloadFile(`/checklists/versions/${versionId}/export`, undefined, 'checklist.xlsx'),
};
