import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface SshKey {
  id: string;
  name: string;
}

interface KeyStore {
  keys: SshKey[];
  loaded: boolean;
  loadKeys: () => Promise<void>;
  addKey: (name: string, pem: string, passphrase?: string) => Promise<SshKey>;
  removeKey: (id: string) => Promise<void>;
  updateKey: (id: string, name: string) => Promise<void>;
}

export const useKeyStore = create<KeyStore>((set, get) => ({
  keys: [],
  loaded: false,

  loadKeys: async () => {
    if (get().loaded) return;
    try {
      const keys = await invoke<SshKey[]>("list_keys");
      set({ keys, loaded: true });
    } catch (e) {
      console.error("Failed to load keys:", e);
    }
  },

  addKey: async (name: string, pem: string, passphrase?: string): Promise<SshKey> => {
    const key: SshKey = await invoke("create_key", { name, pem, passphrase: passphrase ?? null });
    set((s) => ({ keys: [...s.keys, key] }));
    return key;
  },

  removeKey: async (id) => {
    await invoke("delete_key", { id });
    set((s) => ({ keys: s.keys.filter((k) => k.id !== id) }));
  },

  updateKey: async (id: string, name: string) => {
    const updated = await invoke<SshKey>("update_key", { id, name });
    set((s) => ({
      keys: s.keys.map((k) => (k.id === id ? updated : k)),
    }));
  },
}));
