import { api, get, patch, post } from '@/api/client';

export interface PlatformOrg {
  id: string;
  name: string;
  legalEntity: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  _count: { sites: number; users: number; checklistTemplates: number; assessments: number };
  admins: { id: string; name: string; email: string; lastLoginAt: string | null }[];
}

export interface SetupUser {
  name: string;
  email: string;
  designation: string | null;
  roleKey: string;
  branchCode: string | null;
  department: string | null;
  restricted: string[];
}

export interface SetupDraft {
  organisation: { name: string; legalEntity: string | null };
  branches: { code: string; name: string; address: string | null }[];
  departments: { branchCode: string; name: string; ownerEmail: string | null }[];
  users: SetupUser[];
  warnings?: string[];
}

const upload = async <T,>(url: string, file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return (await api.post<{ data: T }>(url, fd)).data.data;
};

export const platformService = {
  organisations: () => get<PlatformOrg[]>('/platform/organisations'),
  parseSetup: (file: File) => upload<{ draft: SetupDraft; problems: string[] }>('/platform/organisations/parse-setup', file),
  validate: (draft: SetupDraft) => post<{ problems: string[] }>('/platform/organisations/validate', { ...draft, sendInvites: false }),
  create: (draft: SetupDraft, sendInvites: boolean) =>
    post<{ organisation: { id: string; name: string }; users: number; invited: number; firstAdmin: string }>('/platform/organisations', { ...draft, sendInvites }),
  importChecklists: (orgId: string, file: File) => upload<{ importId: string; checklists: { sheetName: string; items: number; versionId: string }[] }>(`/platform/organisations/${orgId}/checklists`, file),
  update: (id: string, body: { status?: 'ACTIVE' | 'INACTIVE'; name?: string; reason: string }) => patch(`/platform/organisations/${id}`, body),
};
