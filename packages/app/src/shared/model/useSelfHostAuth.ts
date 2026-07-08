import { create } from 'zustand';
import type { User } from '@shared/model/auth';

const STORAGE_KEY = 'self_host_auth_token';

type SelfHostAuthState = {
  token: string | null;
  profile: User | null;
  isAdmin: boolean;
  setSession: (payload: { token: string; user: User }) => void;
  clearSession: () => void;
  setProfile: (user: User | null) => void;
};

function readStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export const useSelfHostAuth = create<SelfHostAuthState>((set) => ({
  token: readStoredToken(),
  profile: null,
  isAdmin: false,
  setSession: ({ token, user }) => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY, token);
      } catch {
        /* no-op */
      }
    }
    set({ token, profile: user, isAdmin: Boolean(user?.is_admin) });
  },
  clearSession: () => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* no-op */
      }
    }
    set({ token: null, profile: null, isAdmin: false });
  },
  setProfile: (user) => set({ profile: user, isAdmin: Boolean(user?.is_admin) }),
}));
