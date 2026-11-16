import { get, post, tokenStore } from '@/api/client';
import type { SessionUser } from '@/types/api';

export interface LoginResponse {
  mfaRequired: boolean;
  accessToken?: string;
  user?: SessionUser;
  mfaEnrolmentRequired?: boolean;
}

export const authService = {
  async login(email: string, password: string, mfaCode?: string) {
    const r = await post<LoginResponse>('/auth/login', { email, password, mfaCode });
    if (r.accessToken) tokenStore.set(r.accessToken);
    return r;
  },
  async logout() {
    try {
      await post('/auth/logout');
    } finally {
      tokenStore.set(null);
    }
  },
  me: () => get<SessionUser>('/auth/me'),
  forgotPassword: (email: string) => post<{ message: string }>('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) => post<{ message: string; email?: string }>('/auth/reset-password', { token, password }),
  changePassword: (currentPassword: string, newPassword: string) => post('/auth/change-password', { currentPassword, newPassword }),
  mfaSetup: () => post<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup'),
  mfaEnable: (code: string) => post('/auth/mfa/enable', { code }),
  mfaDisable: (password: string, code: string) => post('/auth/mfa/disable', { password, code }),
};
