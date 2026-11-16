import { api, downloadFile, get, getPage, patch, post, put } from '@/api/client';
import type { ImportRecord, ImportRow } from '@/types/api';

export const importsService = {
  list: (params: Record<string, unknown>) => getPage<ImportRecord>('/imports', params),
  get: (id: string) => get<ImportRecord>(`/imports/${id}`),
  async upload(file: File, onProgress?: (pct: number) => void) {
    const fd = new FormData();
    fd.append('file', file);
    const r = await api.post<{ data: ImportRecord }>('/imports', fd, { onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)) });
    return r.data.data;
  },
  rows: (id: string, params: Record<string, unknown>) => getPage<ImportRow>(`/imports/${id}/rows`, params),
  setMapping: (id: string, sheetName: string, columnMap: Record<string, string | null>) => put<ImportRecord>(`/imports/${id}/mapping`, { sheetName, columnMap }),
  setRowIncluded: (id: string, rowId: string, included: boolean) => patch(`/imports/${id}/rows/${rowId}`, { included }),
  confirm: (id: string, sheets: { sheetName: string; templateTitle: string }[], allowDuplicateFile: boolean) =>
    post<{ templateId: string; versionId: string; sheetName: string; items: number }[]>(`/imports/${id}/confirm`, { sheets, allowDuplicateFile }),
  discard: (id: string) => post(`/imports/${id}/discard`),
  errorReport: (id: string) => downloadFile(`/imports/${id}/error-report`, undefined, 'import-issues.xlsx'),
};
