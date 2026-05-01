import { create } from 'zustand';
import type { User } from '../types/domain';

interface AppState {
  user: User | null;
  wsConnected: boolean;
  language: 'zh' | 'en';
  setUser: (user: User | null) => void;
  setWsConnected: (connected: boolean) => void;
  setLanguage: (language: 'zh' | 'en') => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  wsConnected: false,
  language: localStorage.getItem('language') === 'zh' ? 'zh' : 'en',
  setUser: (user) => set({ user }),
  setWsConnected: (wsConnected) => set({ wsConnected }),
  setLanguage: (language) => {
    localStorage.setItem('language', language);
    set({ language });
  },
}));
