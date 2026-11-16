import { get, getPage, post, put, patch } from '@/api/client';
import type { DirectoryUser, RoleRow, UserRow } from '@/types/api';

export interface RoleAssignment {
  roleKey: string;
  siteId?: string | null;
  departmentId?: string | null;
}

export const usersService = {
  list: (params: Record<string, unknown>) => getPage<UserRow>('/users', params),
  directory: (role?: string) => get<DirectoryUser[]>('/users/directory', { params: role ? { role } : undefined }),
  create: (body: { name: string; email: string; designation?: string | null; password?: string; sendInvite: boolean; roles: RoleAssignment[] }) => post<UserRow>('/users', body),
  update: (id: string, body: { name?: string; designation?: string | null }) => patch<UserRow>(`/users/${id}`, body),
  setStatus: (id: string, status: 'ACTIVE' | 'INACTIVE', reason: string) => post<UserRow>(`/users/${id}/status`, { status, reason }),
  setRoles: (id: string, roles: RoleAssignment[]) => put<UserRow>(`/users/${id}/roles`, { roles }),
  /** Replaces the permissions removed from this one user (their role is unchanged). */
  setRestrictions: (id: string, restrictions: { permission: string; expiresAt?: string | null }[], reason: string) => put<UserRow>(`/users/${id}/restrictions`, { restrictions, reason }),
  roles: () => get<RoleRow[]>('/roles'),
  permissions: () => get<{ id: string; key: string; resource: string; action: string }[]>('/roles/permissions'),
  setRolePermissions: (roleId: string, permissions: string[]) => put(`/roles/${roleId}/permissions`, { permissions }),
};
