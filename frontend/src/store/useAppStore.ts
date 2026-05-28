import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface DbCredentials {
  db_type: 'postgresql' | 'mysql';
  host?: string;
  port?: string;
  database?: string;
  username?: string;
  password?: string;
}

interface AppState {
  credentials: DbCredentials;
  setCredentials: (creds: Partial<DbCredentials>) => void;
  
  rawSchema: string;
  parsedNodes: any[];
  setRawSchema: (schema: string) => void;
  setParsedNodes: (nodes: any[]) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      credentials: {
        db_type: 'postgresql',
      },
      setCredentials: (creds) => set((state) => {
        const updates = { ...creds };
        if (creds.db_type && creds.db_type !== state.credentials.db_type) {
          const isMySql = creds.db_type === 'mysql';
          const isPostgres = creds.db_type === 'postgresql';
          
          if (isMySql && (!state.credentials.port || state.credentials.port === '5432')) {
            updates.port = '3306';
          } else if (isPostgres && (!state.credentials.port || state.credentials.port === '3306')) {
            updates.port = '5432';
          }
          
          if (isMySql && (!state.credentials.username || state.credentials.username === 'postgres')) {
            updates.username = 'root';
          } else if (isPostgres && (!state.credentials.username || state.credentials.username === 'root')) {
            updates.username = 'postgres';
          }
        }
        return { credentials: { ...state.credentials, ...updates } };
      }),
      
      rawSchema: '',
      parsedNodes: [],
      setRawSchema: (rawSchema) => set({ rawSchema }),
      setParsedNodes: (parsedNodes) => set({ parsedNodes }),
    }),
    {
      name: 'querysage-app-storage', // name of the item in the storage (must be unique)
      partialize: (state) => ({ credentials: state.credentials }), // Only persist credentials, not the huge parsed nodes array
    }
  )
);
