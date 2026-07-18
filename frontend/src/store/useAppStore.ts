import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  clearChat: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      clearChat: () => set({}),
    }),
    {
      name: 'querysage-app-storage',
    }
  )
);
