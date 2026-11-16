import { api, get, getPage, openSignedUrl, patch, post } from '@/api/client';
import type { EvidenceRow, EvidenceVersion, Review } from '@/types/api';

export interface UploadMeta {
  title?: string;
  description?: string;
  classification?: string;
  assessmentId?: string;
  itemId?: string;
  findingId?: string;
  correctiveActionId?: string;
}

export type EvidenceDetail = EvidenceRow & {
  versions: EvidenceVersion[];
  department: { id: string; name: string };
  reviews: Review[];
  history: { id: string; action: string; actorEmail: string | null; createdAt: string; outcome: string }[];
};

export const evidenceService = {
  list: (params: Record<string, unknown>) => getPage<EvidenceRow>('/evidence', params),
  get: (id: string) => get<EvidenceDetail>(`/evidence/${id}`),
  async upload(file: File, meta: UploadMeta, onProgress?: (pct: number) => void) {
    const fd = new FormData();
    Object.entries(meta).forEach(([k, v]) => v && fd.append(k, v));
    fd.append('file', file);
    const r = await api.post<{ data: EvidenceRow }>('/evidence', fd, { onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)) });
    return r.data.data;
  },
  async uploadVersion(id: string, file: File, note?: string, onProgress?: (pct: number) => void) {
    const fd = new FormData();
    if (note) fd.append('note', note);
    fd.append('file', file);
    const r = await api.post<{ data: EvidenceVersion }>(`/evidence/${id}/versions`, fd, { onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)) });
    return r.data.data;
  },
  update: (id: string, body: { title?: string; description?: string | null; classification?: string }) => patch(`/evidence/${id}`, body),
  remove: (id: string, reason: string) => post(`/evidence/${id}/remove`, { reason }),
  /** Requests a 5-minute signed URL and opens it (download or inline preview). */
  async open(id: string, opts: { version?: number; inline?: boolean } = {}) {
    const r = await post<{ url: string }>(`/evidence/${id}/download-url`, opts);
    openSignedUrl(r.url, opts.inline);
  },
  /** Fetches the file through a signed URL and returns a same-origin blob: URL for inline preview. */
  async previewUrl(id: string, version?: number) {
    const { url } = await post<{ url: string }>(`/evidence/${id}/download-url`, { version, inline: true });
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Preview is not available');
    return URL.createObjectURL(await res.blob());
  },
  rescan: (versionId: string) => post(`/evidence/versions/${versionId}/rescan`),
};
