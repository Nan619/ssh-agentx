import { create } from "zustand";

export interface SshAuthPrompt {
  type: "host_key" | "passphrase" | "auth";
  tabId: string;
  banner?: string;
  isMismatch?: boolean;
  prompt?: string;
  name?: string;
  instructions?: string;
  prompts?: Array<{ prompt: string; echo: boolean }>;
}

interface SshAuthStore {
  currentPrompt: SshAuthPrompt | null;
  setPrompt: (prompt: SshAuthPrompt) => void;
  clearPrompt: () => void;
}

export const useSshAuthStore = create<SshAuthStore>((set) => ({
  currentPrompt: null,
  setPrompt: (prompt) => set({ currentPrompt: prompt }),
  clearPrompt: () => set({ currentPrompt: null }),
}));
