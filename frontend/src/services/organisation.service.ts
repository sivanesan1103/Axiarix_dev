import { get, patch, post } from '@/api/client';
import type { Department, Organisation, Site } from '@/types/api';

export const organisationService = {
  current: () => get<Organisation>('/organisations/current'),
  update: (id: string, body: Partial<Pick<Organisation, 'name' | 'legalEntity' | 'status'>>) => patch<Organisation>(`/organisations/${id}`, body),
  createSite: (body: { name: string; code: string; address?: string | null }) => post<Site>('/organisations/sites', body),
  updateSite: (id: string, body: Partial<{ name: string; code: string; address: string | null; status: 'ACTIVE' | 'INACTIVE' }>) => patch<Site>(`/organisations/sites/${id}`, body),
  createDepartment: (body: { siteId: string; name: string; ownerId?: string | null }) => post<Department>('/organisations/departments', body),
  updateDepartment: (id: string, body: Partial<{ name: string; ownerId: string | null; status: 'ACTIVE' | 'INACTIVE' }>) => patch<Department>(`/organisations/departments/${id}`, body),
};
